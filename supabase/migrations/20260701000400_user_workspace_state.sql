begin;

create table public.user_workspace_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  state_key text not null check (state_key in ('marketing_qa_history', 'daily_report_draft')),
  state_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, state_key)
);

create trigger user_workspace_state_updated_at
before update on public.user_workspace_state
for each row execute function public.set_updated_at();

alter table public.user_workspace_state enable row level security;

create policy user_workspace_state_read
on public.user_workspace_state for select to authenticated
using (user_id = (select auth.uid()));

create policy user_workspace_state_insert
on public.user_workspace_state for insert to authenticated
with check (user_id = (select auth.uid()));

create policy user_workspace_state_update
on public.user_workspace_state for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy user_workspace_state_delete
on public.user_workspace_state for delete to authenticated
using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_workspace_state to authenticated;

commit;
