begin;

create table public.daily_report_imports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null default current_date,
  raw_text text not null check (char_length(trim(raw_text)) > 0),
  status text not null default 'completed' check (status in ('completed', 'partial', 'failed')),
  entry_count integer not null default 0,
  model text not null default 'gpt-5.5',
  analysis_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.daily_report_entries (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.daily_report_imports(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  salesperson_id uuid not null references public.profiles(id),
  report_date date not null,
  activity_type text not null check (activity_type in ('call', 'meeting', 'visit', 'proposal', 'task', 'note')),
  content text not null check (char_length(trim(content)) > 0),
  customer_contact text,
  match_confidence numeric(4,3) not null default 1 check (match_confidence between 0 and 1),
  match_reason text,
  raw_segment text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index daily_report_imports_created_idx on public.daily_report_imports(created_at desc);
create index daily_report_entries_project_idx on public.daily_report_entries(project_id, report_date desc);
create index daily_report_entries_sales_idx on public.daily_report_entries(salesperson_id, report_date desc);
create index daily_report_entries_type_idx on public.daily_report_entries(activity_type, report_date desc);

alter table public.project_activities
  add column daily_report_entry_id uuid references public.daily_report_entries(id) on delete set null;

create unique index project_activities_daily_report_entry_idx
  on public.project_activities(daily_report_entry_id)
  where daily_report_entry_id is not null;

create trigger daily_report_imports_audit
after insert or update or delete on public.daily_report_imports
for each row execute function public.audit_row_change();

create trigger daily_report_entries_audit
after insert or update or delete on public.daily_report_entries
for each row execute function public.audit_row_change();

alter table public.daily_report_imports enable row level security;
alter table public.daily_report_entries enable row level security;

create policy daily_report_imports_admin_read
on public.daily_report_imports for select to authenticated
using ((select public.is_admin()));

create policy daily_report_imports_admin_insert
on public.daily_report_imports for insert to authenticated
with check ((select public.is_admin()) and created_by = (select auth.uid()));

create policy daily_report_entries_read
on public.daily_report_entries for select to authenticated
using (
  (select public.can_access_all_data())
  or salesperson_id = (select auth.uid())
  or exists (
    select 1 from public.projects p
    where p.id = project_id and p.owner_id = (select auth.uid()) and p.deleted_at is null
  )
);

create policy daily_report_entries_admin_insert
on public.daily_report_entries for insert to authenticated
with check ((select public.is_admin()) and created_by = (select auth.uid()));

create or replace function public.import_daily_report(
  raw_report_text text,
  default_report_date date,
  payload jsonb
)
returns table(import_id uuid, imported_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller_uuid uuid := auth.uid();
  batch_uuid uuid;
  item jsonb;
  project_uuid uuid;
  salesperson_uuid uuid;
  entry_uuid uuid;
  entry_date date;
  entry_type text;
  entry_content text;
  salesperson_name text;
  imported integer := 0;
begin
  if caller_uuid is null then raise exception 'Authentication required'; end if;
  if not public.is_admin() then raise exception 'Only administrators can import daily reports'; end if;
  if nullif(trim(raw_report_text), '') is null then raise exception 'Daily report text is required'; end if;
  if jsonb_typeof(payload) <> 'array' then raise exception 'Payload must be a JSON array'; end if;

  insert into public.daily_report_imports(report_date, raw_text, status, entry_count, analysis_snapshot, created_by)
  values (coalesce(default_report_date, current_date), raw_report_text, 'completed', 0, jsonb_build_object('entries', payload), caller_uuid)
  returning id into batch_uuid;

  for item in select value from jsonb_array_elements(payload)
  loop
    begin
      project_uuid := nullif(item ->> 'projectId', '')::uuid;
      salesperson_uuid := nullif(item ->> 'salespersonId', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid project or salesperson identifier';
    end;

    if not exists (select 1 from public.projects p where p.id = project_uuid and p.deleted_at is null) then
      raise exception 'Project not found: %', coalesce(item ->> 'projectName', item ->> 'projectId');
    end if;
    if not exists (select 1 from public.profiles p where p.id = salesperson_uuid and p.active and p.role = 'sales') then
      raise exception 'Salesperson not found: %', coalesce(item ->> 'salespersonName', item ->> 'salespersonId');
    end if;

    entry_date := coalesce(nullif(item ->> 'reportDate', '')::date, default_report_date, current_date);
    entry_type := case when item ->> 'activityType' in ('call', 'meeting', 'visit', 'proposal', 'task', 'note') then item ->> 'activityType' else 'note' end;
    entry_content := nullif(trim(item ->> 'content'), '');
    if entry_content is null then raise exception 'Daily report content is required'; end if;

    insert into public.daily_report_entries(
      import_id, project_id, salesperson_id, report_date, activity_type, content,
      customer_contact, match_confidence, match_reason, raw_segment, created_by
    ) values (
      batch_uuid, project_uuid, salesperson_uuid, entry_date, entry_type, entry_content,
      nullif(trim(item ->> 'customerContact'), ''),
      least(1, greatest(0, coalesce(nullif(item ->> 'matchConfidence', '')::numeric, 1))),
      nullif(trim(item ->> 'matchReason'), ''), nullif(trim(item ->> 'rawSegment'), ''), caller_uuid
    ) returning id into entry_uuid;

    select display_name into salesperson_name from public.profiles where id = salesperson_uuid;
    insert into public.project_activities(
      project_id, activity_type, content, occurred_at, created_by, daily_report_entry_id
    ) values (
      project_uuid,
      entry_type,
      concat('日报记录 · ', salesperson_name, '：', entry_content),
      (entry_date + time '12:00') at time zone 'Asia/Shanghai',
      caller_uuid,
      entry_uuid
    );

    imported := imported + 1;
  end loop;

  update public.daily_report_imports
  set entry_count = imported,
      status = case when imported = jsonb_array_length(payload) then 'completed' else 'partial' end
  where id = batch_uuid;

  import_id := batch_uuid;
  imported_count := imported;
  return next;
end;
$$;

grant select, insert on public.daily_report_imports to authenticated;
grant select, insert on public.daily_report_entries to authenticated;
grant execute on function public.import_daily_report(text, date, jsonb) to authenticated;

commit;
