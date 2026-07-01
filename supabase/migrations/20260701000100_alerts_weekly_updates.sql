begin;

create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique,
  name text not null,
  description text not null,
  level text not null check (level in ('red', 'yellow', 'info')),
  threshold_days integer not null default 0 check (threshold_days between 0 and 365),
  enabled boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.alert_rules(rule_code, name, description, level, threshold_days, sort_order)
values
  ('next_action_overdue', '下一步动作逾期', '项目下一步动作日期早于今天时生成红色提醒。', 'red', 0, 10),
  ('next_action_due', '下一步动作临期', '项目下一步动作将在设定天数内到期时生成黄色提醒。', 'yellow', 3, 20),
  ('expected_close_overdue', '预计成交逾期', '未赢单项目的预计成交日期早于今天时生成红色提醒。', 'red', 0, 30),
  ('stale_project', '项目长期未更新', '项目超过设定天数未更新时生成黄色提醒。', 'yellow', 14, 40),
  ('weekly_update_missing', '本周周更新未提交', '销售本周尚未提交行动周更新时生成信息提醒。', 'info', 0, 50)
on conflict (rule_code) do nothing;

create trigger alert_rules_set_updated_at
before update on public.alert_rules
for each row execute function public.set_updated_at();

create table if not exists public.weekly_updates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  last_week_summary text not null default '',
  this_week_goal text not null default '',
  risks text not null default '',
  support_needed text not null default '',
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  created_by uuid not null references public.profiles(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, week_start)
);

create index if not exists weekly_updates_week_idx on public.weekly_updates(week_start desc, owner_id);

create trigger weekly_updates_set_updated_at
before update on public.weekly_updates
for each row execute function public.set_updated_at();

create trigger weekly_updates_audit
after insert or update or delete on public.weekly_updates
for each row execute function public.audit_row_change();

alter table public.alert_rules enable row level security;
alter table public.weekly_updates enable row level security;

create policy alert_rules_read on public.alert_rules
for select to authenticated using (true);

create policy alert_rules_admin_update on public.alert_rules
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy weekly_updates_read on public.weekly_updates
for select to authenticated
using ((select public.can_access_all_data()) or owner_id = (select auth.uid()));

create policy weekly_updates_insert on public.weekly_updates
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and ((select public.can_access_all_data()) or owner_id = (select auth.uid()))
);

create policy weekly_updates_update on public.weekly_updates
for update to authenticated
using ((select public.can_access_all_data()) or owner_id = (select auth.uid()))
with check ((select public.can_access_all_data()) or owner_id = (select auth.uid()));

create or replace function public.refresh_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_uid uuid := auth.uid();
  current_role text;
  can_view_all boolean := false;
  current_week date := date_trunc('week', current_date)::date;
  affected integer := 0;
  changed integer := 0;
begin
  if current_uid is null then
    raise exception 'Authentication required';
  end if;

  select role into current_role
  from public.profiles
  where id = current_uid and active = true;

  can_view_all := current_role in ('admin', 'presales');

  update public.alerts a
  set status = '已解决', resolved_at = now(), resolved_by = current_uid
  where a.status in ('待处理', '已确认')
    and a.alert_type in ('next_action_overdue', 'next_action_due', 'expected_close_overdue', 'stale_project')
    and exists (
      select 1 from public.projects p
      where p.id = a.project_id
        and (can_view_all or p.owner_id = current_uid)
        and (
          (a.alert_type = 'next_action_overdue' and (p.next_action_date is null or p.next_action_date >= current_date))
          or (a.alert_type = 'next_action_due' and (p.next_action_date is null or p.next_action_date < current_date or p.next_action_date > current_date + coalesce((select threshold_days from public.alert_rules where rule_code = 'next_action_due' and enabled), 3)))
          or (a.alert_type = 'expected_close_overdue' and (p.expected_close is null or p.expected_close >= current_date or p.stage = 'won'))
          or (a.alert_type = 'stale_project' and p.updated_at >= now() - make_interval(days => coalesce((select threshold_days from public.alert_rules where rule_code = 'stale_project' and enabled), 14)))
        )
    );
  get diagnostics changed = row_count;
  affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select p.id, p.owner_id, r.level, r.rule_code, '下一步动作已逾期',
    concat(p.name, '：', coalesce(p.next_action, '未填写下一步动作'), '，原计划 ', to_char(p.next_action_date, 'YYYY-MM-DD')),
    p.next_action_date::timestamptz
  from public.projects p
  join public.alert_rules r on r.rule_code = 'next_action_overdue' and r.enabled
  where p.deleted_at is null and p.stage <> 'won'
    and p.next_action_date < current_date
    and (can_view_all or p.owner_id = current_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select p.id, p.owner_id, r.level, r.rule_code, '下一步动作即将到期',
    concat(p.name, '：', coalesce(p.next_action, '未填写下一步动作'), '，计划 ', to_char(p.next_action_date, 'YYYY-MM-DD')),
    p.next_action_date::timestamptz
  from public.projects p
  join public.alert_rules r on r.rule_code = 'next_action_due' and r.enabled
  where p.deleted_at is null and p.stage <> 'won'
    and p.next_action_date between current_date and current_date + r.threshold_days
    and (can_view_all or p.owner_id = current_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select p.id, p.owner_id, r.level, r.rule_code, '预计成交日期已逾期',
    concat(p.name, '：预计成交日期 ', to_char(p.expected_close, 'YYYY-MM-DD'), '，当前阶段仍为 ', p.stage),
    p.expected_close::timestamptz
  from public.projects p
  join public.alert_rules r on r.rule_code = 'expected_close_overdue' and r.enabled
  where p.deleted_at is null and p.stage <> 'won'
    and p.expected_close < current_date
    and (can_view_all or p.owner_id = current_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description)
  select p.id, p.owner_id, r.level, r.rule_code, '项目长期未更新',
    concat(p.name, ' 已 ', floor(extract(epoch from (now() - p.updated_at)) / 86400)::integer, ' 天未更新，请补充推进情况。')
  from public.projects p
  join public.alert_rules r on r.rule_code = 'stale_project' and r.enabled
  where p.deleted_at is null and p.stage <> 'won'
    and p.updated_at < now() - make_interval(days => r.threshold_days)
    and (can_view_all or p.owner_id = current_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  update public.alerts a
  set status = '已解决', resolved_at = now(), resolved_by = current_uid
  where a.status in ('待处理', '已确认')
    and a.alert_type = 'weekly_update_missing'
    and (can_view_all or a.owner_id = current_uid)
    and exists (
      select 1 from public.weekly_updates w
      where w.owner_id = a.owner_id and w.week_start = current_week and w.status = 'submitted'
    );
  get diagnostics changed = row_count;
  affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select null, p.id, r.level, r.rule_code, '本周行动更新待提交',
    concat(p.display_name, ' 尚未提交 ', to_char(current_week, 'YYYY-MM-DD'), ' 当周的行动更新。'),
    (current_week + 4)::timestamptz + interval '17 hours'
  from public.profiles p
  join public.alert_rules r on r.rule_code = 'weekly_update_missing' and r.enabled
  where p.active and p.role = 'sales'
    and (can_view_all or p.id = current_uid)
    and not exists (select 1 from public.weekly_updates w where w.owner_id = p.id and w.week_start = current_week and w.status = 'submitted')
    and not exists (select 1 from public.alerts a where a.project_id is null and a.owner_id = p.id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  return affected;
end;
$$;

grant select on public.alert_rules to authenticated;
grant select, insert, update on public.weekly_updates to authenticated;
grant execute on function public.refresh_alerts() to authenticated;

commit;
