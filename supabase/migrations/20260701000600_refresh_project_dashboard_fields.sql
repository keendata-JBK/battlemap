begin;

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

commit;
