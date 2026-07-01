begin;

alter table public.projects drop constraint if exists projects_stage_check;
alter table public.projects
  add constraint projects_stage_check
  check (stage in ('lead', 'discovery', 'solution', 'negotiation', 'contract', 'won', 'lost'));

update public.projects set probability = 0 where stage = 'lost';

create or replace function public.sync_project_stage_probability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.probability := case new.stage
    when 'lead' then 5
    when 'discovery' then 20
    when 'solution' then 50
    when 'negotiation' then 80
    when 'contract' then 90
    when 'won' then 100
    when 'lost' then 0
    else 5
  end;
  return new;
end;
$$;

drop trigger if exists projects_sync_stage_probability on public.projects;
create trigger projects_sync_stage_probability
before insert or update of stage on public.projects
for each row execute function public.sync_project_stage_probability();

create table public.daily_report_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null check (char_length(btrim(raw_text)) between 1 and 30000),
  default_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  result jsonb,
  error_message text,
  model text not null default 'gpt-5.5',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index daily_report_analysis_jobs_requester_idx
  on public.daily_report_analysis_jobs(requester_id, created_at desc);

create trigger daily_report_analysis_jobs_updated_at
before update on public.daily_report_analysis_jobs
for each row execute function public.set_updated_at();

alter table public.daily_report_analysis_jobs enable row level security;

create policy daily_report_analysis_jobs_admin_read
on public.daily_report_analysis_jobs for select to authenticated
using ((select public.is_admin()) and requester_id = (select auth.uid()));

create policy daily_report_analysis_jobs_admin_insert
on public.daily_report_analysis_jobs for insert to authenticated
with check ((select public.is_admin()) and requester_id = (select auth.uid()));

grant select, insert on public.daily_report_analysis_jobs to authenticated;

create table public.sales_reports (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  report_type text not null check (report_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  title text not null,
  generation_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  content jsonb,
  markdown text,
  error_message text,
  model text not null default 'gpt-5.5',
  data_scope text,
  project_count integer,
  generated_automatically boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index sales_reports_requester_idx
  on public.sales_reports(requester_id, period_end desc, report_type);

create trigger sales_reports_updated_at
before update on public.sales_reports
for each row execute function public.set_updated_at();

alter table public.sales_reports enable row level security;

create policy sales_reports_read
on public.sales_reports for select to authenticated
using (requester_id = (select auth.uid()) or (select public.can_access_all_data()));

create policy sales_reports_insert_own
on public.sales_reports for insert to authenticated
with check (requester_id = (select auth.uid()));

grant select, insert on public.sales_reports to authenticated;

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
  if caller_uid is null then raise exception 'Authentication required'; end if;
  select p.role into caller_role from public.profiles p where p.id = caller_uid and p.active = true;
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
          p.stage in ('won', 'lost')
          or (a.alert_type = 'next_action_overdue' and (p.next_action_date is null or p.next_action_date >= current_date))
          or (a.alert_type = 'next_action_due' and (p.next_action_date is null or p.next_action_date < current_date or p.next_action_date > current_date + coalesce((select threshold_days from public.alert_rules where rule_code = 'next_action_due' and enabled), 3)))
          or (a.alert_type = 'expected_close_overdue' and (p.expected_close is null or p.expected_close >= current_date))
          or (a.alert_type = 'stale_project' and p.updated_at >= now() - make_interval(days => coalesce((select threshold_days from public.alert_rules where rule_code = 'stale_project' and enabled), 14)))
        )
    );
  get diagnostics changed = row_count; affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select p.id, p.owner_id, r.level, r.rule_code, '下一步动作已逾期', concat(p.name, '：', coalesce(p.next_action, '未填写下一步动作'), '，原计划 ', to_char(p.next_action_date, 'YYYY-MM-DD')), p.next_action_date::timestamptz
  from public.projects p join public.alert_rules r on r.rule_code = 'next_action_overdue' and r.enabled
  where p.deleted_at is null and p.stage not in ('won', 'lost') and p.next_action_date < current_date
    and (caller_can_view_all or p.owner_id = caller_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count; affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select p.id, p.owner_id, r.level, r.rule_code, '下一步动作即将到期', concat(p.name, '：', coalesce(p.next_action, '未填写下一步动作'), '，计划 ', to_char(p.next_action_date, 'YYYY-MM-DD')), p.next_action_date::timestamptz
  from public.projects p join public.alert_rules r on r.rule_code = 'next_action_due' and r.enabled
  where p.deleted_at is null and p.stage not in ('won', 'lost') and p.next_action_date between current_date and current_date + r.threshold_days
    and (caller_can_view_all or p.owner_id = caller_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count; affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select p.id, p.owner_id, r.level, r.rule_code, '预计成交日期已逾期', concat(p.name, '：预计成交日期 ', to_char(p.expected_close, 'YYYY-MM-DD'), '，当前阶段仍为 ', p.stage), p.expected_close::timestamptz
  from public.projects p join public.alert_rules r on r.rule_code = 'expected_close_overdue' and r.enabled
  where p.deleted_at is null and p.stage not in ('won', 'lost') and p.expected_close < current_date
    and (caller_can_view_all or p.owner_id = caller_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count; affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description)
  select p.id, p.owner_id, r.level, r.rule_code, '项目长期未更新', concat(p.name, ' 已 ', floor(extract(epoch from (now() - p.updated_at)) / 86400)::integer, ' 天未更新，请补充推进情况。')
  from public.projects p join public.alert_rules r on r.rule_code = 'stale_project' and r.enabled
  where p.deleted_at is null and p.stage not in ('won', 'lost') and p.updated_at < now() - make_interval(days => r.threshold_days)
    and (caller_can_view_all or p.owner_id = caller_uid)
    and not exists (select 1 from public.alerts a where a.project_id = p.id and a.owner_id = p.owner_id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count; affected := affected + changed;

  update public.alerts a set status = '已解决', resolved_at = now(), resolved_by = caller_uid
  where a.status in ('待处理', '已确认') and a.alert_type = 'weekly_update_missing'
    and (caller_can_view_all or a.owner_id = caller_uid)
    and exists (select 1 from public.weekly_updates w where w.owner_id = a.owner_id and w.week_start = current_week and w.status = 'submitted');
  get diagnostics changed = row_count; affected := affected + changed;

  insert into public.alerts(project_id, owner_id, level, alert_type, title, description, due_at)
  select null, p.id, r.level, r.rule_code, '本周行动更新待提交', concat(p.display_name, ' 尚未提交 ', to_char(current_week, 'YYYY-MM-DD'), ' 当周的行动更新。'), (current_week + 4)::timestamptz + interval '17 hours'
  from public.profiles p join public.alert_rules r on r.rule_code = 'weekly_update_missing' and r.enabled
  where p.active and p.role = 'sales' and (caller_can_view_all or p.id = caller_uid)
    and not exists (select 1 from public.weekly_updates w where w.owner_id = p.id and w.week_start = current_week and w.status = 'submitted')
    and not exists (select 1 from public.alerts a where a.project_id is null and a.owner_id = p.id and a.alert_type = r.rule_code and a.status in ('待处理', '已确认'));
  get diagnostics changed = row_count; affected := affected + changed;
  return affected;
end;
$$;

grant execute on function public.refresh_alerts() to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sales-agent-weekly-report') then
    perform cron.unschedule('sales-agent-weekly-report');
  end if;
  if exists (select 1 from cron.job where jobname = 'sales-agent-monthly-report') then
    perform cron.unschedule('sales-agent-monthly-report');
  end if;
end;
$$;

select cron.schedule(
  'sales-agent-weekly-report',
  '0 15 * * 0',
  $cron$
  select net.http_post(
    url := 'https://eqqjsprkqiiymvuwfojb.supabase.co/functions/v1/sales-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-token', (select decrypted_secret from vault.decrypted_secrets where name = 'sales_reports_scheduler_token' limit 1)
    ),
    body := jsonb_build_object('action', 'scheduled', 'reportType', 'weekly', 'requesterId', p.id)
  )
  from public.profiles p
  where p.active and p.role in ('admin', 'presales', 'sales');
  $cron$
);

select cron.schedule(
  'sales-agent-monthly-report',
  '10 15 * * *',
  $cron$
  select net.http_post(
    url := 'https://eqqjsprkqiiymvuwfojb.supabase.co/functions/v1/sales-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-token', (select decrypted_secret from vault.decrypted_secrets where name = 'sales_reports_scheduler_token' limit 1)
    ),
    body := jsonb_build_object('action', 'scheduled', 'reportType', 'monthly', 'requesterId', p.id)
  )
  from public.profiles p
  where p.active
    and p.role in ('admin', 'presales', 'sales')
    and extract(month from ((now() at time zone 'Asia/Shanghai')::date + 1)) <> extract(month from (now() at time zone 'Asia/Shanghai')::date);
  $cron$
);

commit;
