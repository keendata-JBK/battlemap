begin;

alter table public.projects
  add column decision_chain_description text,
  add column competitor_description text,
  add column referral_unit text;

comment on column public.projects.description is '项目需求描述';
comment on column public.projects.decision_chain_description is '项目决策链及关键角色描述';
comment on column public.projects.competitor_description is '竞争对手及竞争态势描述';
comment on column public.projects.referral_unit is '政府资源项目牵线单位';

alter table public.projects
  add constraint projects_government_referral_required
  check (category <> 'government' or nullif(btrim(referral_unit), '') is not null)
  not valid;

create index projects_referral_unit_idx
  on public.projects(referral_unit)
  where category = 'government' and deleted_at is null;

drop view public.project_dashboard;

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

grant select on public.project_dashboard to authenticated;

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
    if item ->> 'category' = 'government' and nullif(btrim(item ->> 'referralUnit'), '') is null then
      raise exception 'Government projects require a referral unit';
    end if;

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
      description, decision_chain_description, competitor_description, referral_unit,
      is_direct_contract, integrator, delivery_partners, created_by
    ) values (
      customer_uuid, item ->> 'name', item ->> 'category', item ->> 'region', item ->> 'province', item ->> 'city', item ->> 'district', item ->> 'adcode',
      ((item -> 'coordinates') ->> 0)::double precision, ((item -> 'coordinates') ->> 1)::double precision,
      coalesce((item ->> 'amount')::numeric, 0), stage_value,
      case stage_value when 'lead' then 5 when 'discovery' then 20 when 'solution' then 50 when 'negotiation' then 80 when 'contract' then 90 when 'won' then 100 when 'lost' then 0 else 5 end,
      owner_uuid, presales_uuid, coalesce(nullif(item ->> 'health', ''), 'green'), coalesce(nullif(item ->> 'priority', ''), 'P2'),
      nullif(item ->> 'nextAction', ''), nullif(item ->> 'nextActionDate', '')::date, nullif(item ->> 'expectedClose', '')::date,
      coalesce(nullif(item ->> 'source', ''), '批量导入'), coalesce(nullif(item ->> 'risk', ''), '暂无重大风险'),
      nullif(btrim(item ->> 'requirementDescription'), ''), nullif(btrim(item ->> 'decisionChainDescription'), ''),
      nullif(btrim(item ->> 'competitorDescription'), ''), nullif(btrim(item ->> 'referralUnit'), ''),
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
