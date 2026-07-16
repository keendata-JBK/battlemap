begin;

alter table public.projects
  add column if not exists decision_chain_description text,
  add column if not exists competitor_description text,
  add column if not exists referral_unit text;

comment on column public.projects.decision_chain_description is '项目决策链及关键角色描述';
comment on column public.projects.competitor_description is '竞争对手及竞争态势描述';
comment on column public.projects.referral_unit is '政府资源项目牵线单位';

create or replace view public.project_dashboard
with (security_invoker = true)
as
select
  p.id,
  p.project_code,
  p.customer_id,
  p.name,
  p.category,
  p.region,
  p.province,
  p.city,
  p.district,
  p.adcode,
  p.longitude,
  p.latitude,
  p.amount,
  p.stage,
  p.probability,
  p.owner_id,
  p.presales_id,
  p.health,
  p.priority,
  p.next_action,
  p.next_action_date,
  p.expected_close,
  p.source,
  p.risk,
  p.description,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  p.is_direct_contract,
  p.integrator,
  p.delivery_partners,
  c.name as customer_name,
  owner.display_name as owner_name,
  presales.display_name as presales_name,
  p.contract_signed_amount,
  p.decision_chain_description,
  p.competitor_description,
  p.referral_unit
from public.projects p
join public.customers c on c.id = p.customer_id
join public.profiles owner on owner.id = p.owner_id
left join public.profiles presales on presales.id = p.presales_id
where p.deleted_at is null and c.deleted_at is null;

grant select on public.project_dashboard to authenticated;

commit;
