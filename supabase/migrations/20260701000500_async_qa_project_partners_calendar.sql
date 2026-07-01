begin;

alter table public.projects
  add column is_direct_contract boolean not null default true,
  add column integrator text,
  add column delivery_partners text[] not null default '{}';

alter table public.projects
  add constraint projects_integrator_required_for_indirect
  check (is_direct_contract or nullif(btrim(integrator), '') is not null);

create table public.marketing_qa_jobs (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 1 and 4000),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  answer text,
  error_message text,
  model text not null default 'gpt-5.5',
  data_scope text,
  project_count integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_qa_jobs_requester_idx
  on public.marketing_qa_jobs(requester_id, created_at desc);

create trigger marketing_qa_jobs_updated_at
before update on public.marketing_qa_jobs
for each row execute function public.set_updated_at();

alter table public.marketing_qa_jobs enable row level security;

create policy marketing_qa_jobs_read_own
on public.marketing_qa_jobs for select to authenticated
using (requester_id = (select auth.uid()));

create policy marketing_qa_jobs_insert_own
on public.marketing_qa_jobs for insert to authenticated
with check (requester_id = (select auth.uid()));

grant select, insert on public.marketing_qa_jobs to authenticated;

drop policy if exists daily_report_entries_read on public.daily_report_entries;
create policy daily_report_entries_read
on public.daily_report_entries for select to authenticated
using (
  (select public.can_access_all_data())
  or (
    salesperson_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.owner_id = (select auth.uid())
        and p.deleted_at is null
    )
  )
);

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
  direct_contract_value boolean;
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
    direct_contract_value := coalesce(nullif(item ->> 'isDirectContract', '')::boolean, true);
    insert into public.projects(
      customer_id, name, category, region, province, city, district, adcode,
      longitude, latitude, amount, stage, probability, owner_id, presales_id,
      health, priority, next_action, next_action_date, expected_close, source, risk,
      is_direct_contract, integrator, delivery_partners, created_by
    ) values (
      customer_uuid, item ->> 'name', item ->> 'category', item ->> 'region', item ->> 'province', item ->> 'city', item ->> 'district', item ->> 'adcode',
      ((item -> 'coordinates') ->> 0)::double precision, ((item -> 'coordinates') ->> 1)::double precision,
      coalesce((item ->> 'amount')::numeric, 0), stage_value,
      case stage_value when 'lead' then 5 when 'discovery' then 20 when 'solution' then 50 when 'negotiation' then 80 when 'contract' then 90 when 'won' then 100 else 5 end,
      owner_uuid, presales_uuid, coalesce(nullif(item ->> 'health', ''), 'green'), coalesce(nullif(item ->> 'priority', ''), 'P2'),
      nullif(item ->> 'nextAction', ''), nullif(item ->> 'nextActionDate', '')::date, nullif(item ->> 'expectedClose', '')::date,
      coalesce(nullif(item ->> 'source', ''), '批量导入'), coalesce(nullif(item ->> 'risk', ''), '暂无重大风险'),
      direct_contract_value,
      case when direct_contract_value then null else nullif(btrim(item ->> 'integrator'), '') end,
      case
        when jsonb_typeof(item -> 'deliveryPartners') = 'array'
          then array(select jsonb_array_elements_text(item -> 'deliveryPartners'))
        else '{}'
      end,
      caller_uuid
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

commit;
