begin;

create extension if not exists pgcrypto;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  region_scope text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'sales' check (role in ('admin', 'presales', 'sales')),
  team_id uuid references public.teams(id) on delete set null,
  region_scope text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  unified_credit_code text,
  customer_type text not null default 'government' check (customer_type in ('government', 'industry', 'platform', 'standalone', 'partner')),
  industry text,
  region text not null check (region in ('华东区域', '西南区域')),
  province text not null,
  city text not null,
  district text not null,
  adcode char(6) not null check (adcode ~ '^[0-9]{6}$'),
  address text,
  tags text[] not null default '{}',
  data_classification text not null default 'internal' check (data_classification in ('internal', 'confidential', 'restricted')),
  owner_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index customers_credit_code_unique on public.customers(unified_credit_code) where unified_credit_code is not null and deleted_at is null;
create index customers_owner_idx on public.customers(owner_id) where deleted_at is null;
create index customers_adcode_idx on public.customers(adcode) where deleted_at is null;
create index customers_name_idx on public.customers using gin (to_tsvector('simple', name)) where deleted_at is null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  department text,
  title text,
  mobile text,
  email text,
  wechat text,
  is_key_decision_maker boolean not null default false,
  notes text,
  data_classification text not null default 'confidential' check (data_classification in ('internal', 'confidential', 'restricted')),
  owner_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index contacts_customer_idx on public.contacts(customer_id) where deleted_at is null;
create index contacts_owner_idx on public.contacts(owner_id) where deleted_at is null;

create sequence public.project_code_seq start 1001;

create or replace function public.next_project_code()
returns text
language sql
volatile
set search_path = public
as $$
  select 'P' || to_char(current_date, 'YYYY') || lpad(nextval('public.project_code_seq')::text, 4, '0');
$$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique default public.next_project_code(),
  customer_id uuid not null references public.customers(id),
  name text not null,
  category text not null check (category in ('government', 'industry', 'platform', 'standalone', 'partner')),
  region text not null check (region in ('华东区域', '西南区域')),
  province text not null,
  city text not null,
  district text not null,
  adcode char(6) not null check (adcode ~ '^[0-9]{6}$'),
  longitude double precision not null check (longitude between 73 and 136),
  latitude double precision not null check (latitude between 3 and 54),
  amount numeric(16,2) not null default 0 check (amount >= 0),
  stage text not null default 'lead' check (stage in ('lead', 'discovery', 'solution', 'negotiation', 'contract', 'won')),
  probability smallint not null default 5 check (probability between 0 and 100),
  owner_id uuid not null references public.profiles(id),
  presales_id uuid references public.profiles(id),
  health text not null default 'green' check (health in ('green', 'yellow', 'red', 'gray')),
  priority text not null default 'P2' check (priority in ('P0', 'P1', 'P2', 'P3')),
  next_action text,
  next_action_date date,
  expected_close date,
  source text,
  risk text,
  description text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index projects_owner_idx on public.projects(owner_id) where deleted_at is null;
create index projects_presales_idx on public.projects(presales_id) where deleted_at is null;
create index projects_customer_idx on public.projects(customer_id) where deleted_at is null;
create index projects_adcode_idx on public.projects(adcode) where deleted_at is null;
create index projects_stage_idx on public.projects(stage) where deleted_at is null;
create index projects_close_idx on public.projects(expected_close) where deleted_at is null;

create table public.project_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  activity_type text not null check (activity_type in ('call', 'meeting', 'visit', 'proposal', 'task', 'note', 'stage_change')),
  content text not null,
  occurred_at timestamptz not null default now(),
  next_action text,
  next_action_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index project_activities_project_idx on public.project_activities(project_id, occurred_at desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  level text not null check (level in ('red', 'yellow', 'info')),
  alert_type text not null,
  title text not null,
  description text,
  status text not null default '待处理' check (status in ('待处理', '已确认', '已解决')),
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index alerts_owner_status_idx on public.alerts(owner_id, status);
create index alerts_project_idx on public.alerts(project_id);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text,
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'validating', 'completed', 'partial', 'failed')),
  error_report jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  actor_id uuid,
  request_id text,
  created_at timestamptz not null default now()
);

create index audit_logs_record_idx on public.audit_logs(table_name, record_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger contacts_set_updated_at before update on public.contacts for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger alerts_set_updated_at before update on public.alerts for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, '新用户'), '@', 1)),
    'sales'
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = (select auth.uid()) and active = true;
$$;

create or replace function public.can_access_all_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'presales'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id text;
begin
  row_id := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'));
  insert into public.audit_logs(table_name, record_id, action, old_data, new_data, actor_id)
  values (
    tg_table_name,
    row_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    (select auth.uid())
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger customers_audit after insert or update or delete on public.customers for each row execute function public.audit_row_change();
create trigger contacts_audit after insert or update or delete on public.contacts for each row execute function public.audit_row_change();
create trigger projects_audit after insert or update or delete on public.projects for each row execute function public.audit_row_change();
create trigger activities_audit after insert or update or delete on public.project_activities for each row execute function public.audit_row_change();
create trigger alerts_audit after insert or update or delete on public.alerts for each row execute function public.audit_row_change();

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.contacts enable row level security;
alter table public.projects enable row level security;
alter table public.project_activities enable row level security;
alter table public.alerts enable row level security;
alter table public.import_jobs enable row level security;
alter table public.audit_logs enable row level security;

create policy teams_read on public.teams for select to authenticated using (true);
create policy teams_admin_write on public.teams for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy profiles_read on public.profiles for select to authenticated using (active = true or id = (select auth.uid()) or (select public.can_access_all_data()));
create policy profiles_admin_write on public.profiles for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy customers_read on public.customers for select to authenticated using (
  deleted_at is null
  and (
    (select public.can_access_all_data())
    or owner_id = (select auth.uid())
    or exists (
      select 1
      from public.projects p
      where p.customer_id = customers.id
        and p.owner_id = (select auth.uid())
        and p.deleted_at is null
    )
  )
);
create policy customers_insert on public.customers for insert to authenticated with check (created_by = (select auth.uid()) and ((select public.can_access_all_data()) or owner_id = (select auth.uid())));
create policy customers_update on public.customers for update to authenticated using ((select public.can_access_all_data()) or owner_id = (select auth.uid())) with check ((select public.can_access_all_data()) or owner_id = (select auth.uid()));
create policy customers_delete on public.customers for delete to authenticated using ((select public.is_admin()));

create policy contacts_read on public.contacts for select to authenticated using (deleted_at is null and ((select public.can_access_all_data()) or owner_id = (select auth.uid())));
create policy contacts_insert on public.contacts for insert to authenticated with check (created_by = (select auth.uid()) and ((select public.can_access_all_data()) or owner_id = (select auth.uid())));
create policy contacts_update on public.contacts for update to authenticated using ((select public.can_access_all_data()) or owner_id = (select auth.uid())) with check ((select public.can_access_all_data()) or owner_id = (select auth.uid()));
create policy contacts_delete on public.contacts for delete to authenticated using ((select public.is_admin()));

create policy projects_read on public.projects for select to authenticated using (deleted_at is null and ((select public.can_access_all_data()) or owner_id = (select auth.uid())));
create policy projects_insert on public.projects for insert to authenticated with check (created_by = (select auth.uid()) and ((select public.can_access_all_data()) or owner_id = (select auth.uid())));
create policy projects_update on public.projects for update to authenticated using ((select public.can_access_all_data()) or owner_id = (select auth.uid())) with check ((select public.can_access_all_data()) or owner_id = (select auth.uid()));
create policy projects_delete on public.projects for delete to authenticated using ((select public.is_admin()));

create policy activities_read on public.project_activities for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id));
create policy activities_insert on public.project_activities for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id));
create policy activities_update on public.project_activities for update to authenticated using (created_by = (select auth.uid()) or (select public.can_access_all_data())) with check (created_by = (select auth.uid()) or (select public.can_access_all_data()));
create policy activities_delete on public.project_activities for delete to authenticated using (created_by = (select auth.uid()) or (select public.is_admin()));

create policy alerts_read on public.alerts for select to authenticated using ((select public.can_access_all_data()) or owner_id = (select auth.uid()));
create policy alerts_insert on public.alerts for insert to authenticated with check ((select public.can_access_all_data()) or owner_id = (select auth.uid()));
create policy alerts_update on public.alerts for update to authenticated using ((select public.can_access_all_data()) or owner_id = (select auth.uid())) with check ((select public.can_access_all_data()) or owner_id = (select auth.uid()));
create policy alerts_delete on public.alerts for delete to authenticated using ((select public.is_admin()));

create policy import_jobs_read on public.import_jobs for select to authenticated using ((select public.can_access_all_data()) or created_by = (select auth.uid()));
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check (created_by = (select auth.uid()));
create policy import_jobs_update on public.import_jobs for update to authenticated using ((select public.can_access_all_data()) or created_by = (select auth.uid())) with check ((select public.can_access_all_data()) or created_by = (select auth.uid()));

create policy audit_logs_admin_read on public.audit_logs for select to authenticated using ((select public.is_admin()));

create or replace function public.import_projects(payload jsonb)
returns table(project_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  owner_uuid uuid;
  presales_uuid uuid;
  customer_uuid uuid;
  created_project_id uuid;
  caller_uuid uuid := (select auth.uid());
  stage_value text;
begin
  if caller_uuid is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(payload) <> 'array' then raise exception 'Payload must be a JSON array'; end if;

  for item in select value from jsonb_array_elements(payload)
  loop
    select id into owner_uuid from public.profiles where display_name = item ->> 'owner' and active = true order by created_at limit 1;
    if owner_uuid is null then owner_uuid := caller_uuid; end if;
    select id into presales_uuid from public.profiles where display_name = item ->> 'presales' and active = true order by created_at limit 1;

    select id into customer_uuid
    from public.customers
    where name = item ->> 'account' and deleted_at is null
    order by created_at
    limit 1;

    if customer_uuid is null then
      insert into public.customers(name, customer_type, region, province, city, district, adcode, owner_id, created_by)
      values (item ->> 'account', item ->> 'category', item ->> 'region', item ->> 'province', item ->> 'city', item ->> 'district', item ->> 'adcode', owner_uuid, caller_uuid)
      returning id into customer_uuid;
    end if;

    stage_value := coalesce(nullif(item ->> 'stage', ''), 'lead');
    insert into public.projects(
      customer_id, name, category, region, province, city, district, adcode,
      longitude, latitude, amount, stage, probability, owner_id, presales_id,
      health, priority, next_action, next_action_date, expected_close, source, risk, created_by
    ) values (
      customer_uuid, item ->> 'name', item ->> 'category', item ->> 'region', item ->> 'province', item ->> 'city', item ->> 'district', item ->> 'adcode',
      ((item -> 'coordinates') ->> 0)::double precision, ((item -> 'coordinates') ->> 1)::double precision,
      coalesce((item ->> 'amount')::numeric, 0), stage_value,
      case stage_value when 'lead' then 5 when 'discovery' then 20 when 'solution' then 50 when 'negotiation' then 80 when 'contract' then 90 when 'won' then 100 else 5 end,
      owner_uuid, presales_uuid, coalesce(nullif(item ->> 'health', ''), 'green'), coalesce(nullif(item ->> 'priority', ''), 'P2'),
      nullif(item ->> 'nextAction', ''), nullif(item ->> 'nextActionDate', '')::date, nullif(item ->> 'expectedClose', '')::date,
      coalesce(nullif(item ->> 'source', ''), '批量导入'), coalesce(nullif(item ->> 'risk', ''), '暂无重大风险'), caller_uuid
    ) returning id into created_project_id;

    if nullif(item ->> 'contactName', '') is not null then
      insert into public.contacts(customer_id, name, mobile, email, is_key_decision_maker, data_classification, owner_id, created_by)
      select
        customer_uuid,
        item ->> 'contactName',
        nullif(item ->> 'contactMobile', ''),
        nullif(item ->> 'contactEmail', ''),
        true,
        'confidential',
        owner_uuid,
        caller_uuid
      where not exists (
        select 1 from public.contacts c where c.customer_id = customer_uuid and c.name = item ->> 'contactName' and c.deleted_at is null
      );
    end if;

    project_id := created_project_id;
    return next;
  end loop;
end;
$$;

create view public.project_dashboard
with (security_invoker = true)
as
select
  p.*,
  c.name as customer_name,
  owner.display_name as owner_name,
  presales.display_name as presales_name
from public.projects p
join public.customers c on c.id = p.customer_id
join public.profiles owner on owner.id = p.owner_id
left join public.profiles presales on presales.id = p.presales_id
where p.deleted_at is null and c.deleted_at is null;

grant usage on schema public to authenticated, service_role;
grant select on public.teams, public.profiles, public.project_dashboard to authenticated;
grant select, insert, update, delete on public.customers, public.contacts, public.projects, public.project_activities, public.alerts, public.import_jobs to authenticated;
grant select on public.audit_logs to authenticated;
grant usage, select on sequence public.project_code_seq to authenticated;
grant execute on function public.next_project_code() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.can_access_all_data() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.import_projects(jsonb) to authenticated;

revoke all on all tables in schema public from anon;

insert into public.teams(name, region_scope)
values
  ('华东一组', array['华东区域']),
  ('华东二组', array['华东区域']),
  ('西南一组', array['西南区域']),
  ('解决方案部', array['华东区域', '西南区域']),
  ('数字化运营部', array['华东区域', '西南区域'])
on conflict (name) do nothing;

commit;
