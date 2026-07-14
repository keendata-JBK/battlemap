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
  p.contract_signed_amount
from public.projects p
join public.customers c on c.id = p.customer_id
join public.profiles owner on owner.id = p.owner_id
left join public.profiles presales on presales.id = p.presales_id
where p.deleted_at is null and c.deleted_at is null;

grant select on public.project_dashboard to authenticated;
