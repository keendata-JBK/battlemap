begin;

create or replace function public.refresh_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text;
  caller_can_view_all boolean := false;
  current_week date := date_trunc('week', current_date)::date;
  affected integer := 0;
  changed integer := 0;
begin
  if caller_uid is null then
    raise exception 'Authentication required';
  end if;

  select p.role into caller_role
  from public.profiles p
  where p.id = caller_uid and p.active = true;

  caller_can_view_all := caller_role in ('admin', 'presales');

  update public.alerts a
  set status = '已解决', resolved_at = now(), resolved_by = caller_uid
  where a.status in ('待处理', '已确认')
    and a.alert_type in ('next_action_overdue', 'next_action_due', 'expected_close_overdue', 'stale_project')
    and exists (
      select 1 from public.projects p
      where p.id = a.project_id
        and (caller_can_view_all or p.owner_id = caller_uid)
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
    and (caller_can_view_all or p.owner_id = caller_uid)
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
    and (caller_can_view_all or p.owner_id = caller_uid)
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
    and (caller_can_view_all or p.owner_id = caller_uid)
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
    and (caller_can_view_all or p.owner_id = caller_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  update public.alerts a
  set status = '已解决', resolved_at = now(), resolved_by = caller_uid
  where a.status in ('待处理', '已确认')
    and a.alert_type = 'weekly_update_missing'
    and (caller_can_view_all or a.owner_id = caller_uid)
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
    and (caller_can_view_all or p.id = caller_uid)
    and not exists (select 1 from public.weekly_updates w where w.owner_id = p.id and w.week_start = current_week and w.status = 'submitted')
    and not exists (select 1 from public.alerts a where a.project_id is null and a.owner_id = p.id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count;
  affected := affected + changed;

  return affected;
end;
$$;

grant execute on function public.refresh_alerts() to authenticated;

commit;
