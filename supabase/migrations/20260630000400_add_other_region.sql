begin;

alter table public.customers
  drop constraint if exists customers_region_check;
alter table public.customers
  add constraint customers_region_check
  check (region in ('华东区域', '西南区域', '北京区域', '其他区域'));

alter table public.projects
  drop constraint if exists projects_region_check;
alter table public.projects
  add constraint projects_region_check
  check (region in ('华东区域', '西南区域', '北京区域', '其他区域'));

commit;
