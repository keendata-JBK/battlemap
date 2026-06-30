begin;

alter table public.profiles
  add column if not exists password_change_required boolean not null default false;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set password_change_required = false
  where id = (select auth.uid());
end;
$$;

revoke all on function public.complete_password_change() from public;
grant execute on function public.complete_password_change() to authenticated;

commit;
