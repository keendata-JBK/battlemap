begin;

create table public.dingtalk_write_proposals (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.dingtalk_user_bindings(staff_id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id text not null,
  source_message_id text not null unique,
  confirmation_message_id text unique,
  original_text text not null check (char_length(btrim(original_text)) between 1 and 15000),
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'superseded', 'expired', 'failed')),
  model text not null default 'gpt-5.5',
  result jsonb,
  error_message text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dingtalk_write_proposals_pending_idx
  on public.dingtalk_write_proposals(staff_id, conversation_id, created_at desc)
  where status = 'pending';

create index dingtalk_write_proposals_profile_idx
  on public.dingtalk_write_proposals(profile_id, created_at desc);

create trigger dingtalk_write_proposals_set_updated_at
before update on public.dingtalk_write_proposals
for each row execute function public.set_updated_at();

create trigger dingtalk_write_proposals_audit
after insert or update or delete on public.dingtalk_write_proposals
for each row execute function public.audit_row_change();

alter table public.dingtalk_write_proposals enable row level security;

create policy dingtalk_write_proposals_read
on public.dingtalk_write_proposals for select to authenticated
using (
  profile_id = (select auth.uid())
  or (select public.can_access_all_data())
);

revoke all on public.dingtalk_write_proposals from public, anon;
grant select on public.dingtalk_write_proposals to authenticated;
grant select, insert, update on public.dingtalk_write_proposals to service_role;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id text;
  effective_actor uuid;
  effective_request_id text;
begin
  row_id := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'));
  effective_actor := coalesce(
    (select auth.uid()),
    nullif(current_setting('app.actor_id', true), '')::uuid
  );
  effective_request_id := nullif(current_setting('app.request_id', true), '');

  insert into public.audit_logs(
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    actor_id,
    request_id
  )
  values (
    tg_table_name,
    row_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    effective_actor,
    effective_request_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_row_change()
  from public, anon, authenticated;

create or replace function public.apply_dingtalk_write_proposal(
  proposal_uuid uuid,
  caller_staff_id text,
  confirmation_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal_row public.dingtalk_write_proposals%rowtype;
  binding_row public.dingtalk_user_bindings%rowtype;
  profile_row public.profiles%rowtype;
  salesperson_row public.profiles%rowtype;
  project_row public.projects%rowtype;
  project_item jsonb;
  daily_item jsonb;
  changes jsonb;
  project_uuid uuid;
  salesperson_uuid uuid;
  report_import_uuid uuid;
  daily_entry_uuid uuid;
  report_date_value date;
  activity_type_value text;
  content_value text;
  project_updates_count integer := 0;
  daily_entries_count integer := 0;
  changed_projects jsonb := '[]'::jsonb;
  result_value jsonb;
  error_detail text;
begin
  select *
  into proposal_row
  from public.dingtalk_write_proposals
  where id = proposal_uuid
  for update;

  if proposal_row.id is null then
    raise exception '待确认更新不存在';
  end if;
  if proposal_row.staff_id <> caller_staff_id then
    raise exception '无权确认其他人员的更新';
  end if;
  if proposal_row.status = 'confirmed' then
    return coalesce(proposal_row.result, '{}'::jsonb)
      || jsonb_build_object('status', 'confirmed', 'alreadyApplied', true);
  end if;
  if proposal_row.status <> 'pending' then
    return jsonb_build_object(
      'status',
      proposal_row.status,
      'error',
      '这条待确认更新已失效或已处理'
    );
  end if;
  if proposal_row.expires_at <= now() then
    update public.dingtalk_write_proposals
    set status = 'expired', error_message = '超过24小时未确认'
    where id = proposal_row.id;
    return jsonb_build_object('status', 'expired', 'error', '待确认更新已超过24小时，请重新描述最新进展');
  end if;

  select *
  into binding_row
  from public.dingtalk_user_bindings
  where staff_id = caller_staff_id
    and status = 'active'
    and profile_id = proposal_row.profile_id;

  if binding_row.id is null then
    raise exception '钉钉身份绑定已失效，请联系管理员';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = proposal_row.profile_id
    and active = true;

  if profile_row.id is null then
    raise exception '销售系统账号不存在或已停用';
  end if;

  perform set_config('app.actor_id', profile_row.id::text, true);
  perform set_config('app.request_id', proposal_row.source_message_id, true);

  begin
    if jsonb_typeof(coalesce(proposal_row.payload -> 'projectUpdates', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(proposal_row.payload -> 'dailyReportEntries', '[]'::jsonb)) <> 'array'
    then
      raise exception '待确认更新的数据结构无效';
    end if;

    for project_item in
      select value
      from jsonb_array_elements(coalesce(proposal_row.payload -> 'projectUpdates', '[]'::jsonb))
    loop
      begin
        project_uuid := nullif(project_item ->> 'projectId', '')::uuid;
      exception when invalid_text_representation then
        raise exception '项目标识无效';
      end;

      select *
      into project_row
      from public.projects
      where id = project_uuid
        and deleted_at is null
      for update;

      if project_row.id is null then
        raise exception '待更新项目不存在';
      end if;
      if profile_row.role not in ('admin', 'presales')
        and project_row.owner_id <> profile_row.id
      then
        raise exception '销售只能更新本人负责的项目：%', project_row.name;
      end if;
      if nullif(project_item ->> 'expectedUpdatedAt', '') is null
        or project_row.updated_at <> (project_item ->> 'expectedUpdatedAt')::timestamptz
      then
        raise exception '项目“%”在等待确认期间已被其他人更新，请重新描述最新情况', project_row.name;
      end if;

      changes := coalesce(project_item -> 'changes', '{}'::jsonb);
      if jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
        raise exception '项目更新缺少有效字段';
      end if;
      if exists (
        select 1
        from jsonb_object_keys(changes) as field_name
        where field_name not in (
          'amount',
          'contract_signed_amount',
          'stage',
          'health',
          'priority',
          'next_action',
          'next_action_date',
          'expected_close',
          'risk',
          'description',
          'decision_chain_description',
          'competitor_description'
        )
      ) then
        raise exception '项目更新包含未授权字段';
      end if;

      update public.projects
      set
        amount = case when changes ? 'amount'
          then (changes ->> 'amount')::numeric else amount end,
        contract_signed_amount = case when changes ? 'contract_signed_amount'
          then (changes ->> 'contract_signed_amount')::numeric else contract_signed_amount end,
        stage = case when changes ? 'stage'
          then changes ->> 'stage' else stage end,
        health = case when changes ? 'health'
          then changes ->> 'health' else health end,
        priority = case when changes ? 'priority'
          then changes ->> 'priority' else priority end,
        next_action = case when changes ? 'next_action'
          then nullif(btrim(changes ->> 'next_action'), '') else next_action end,
        next_action_date = case when changes ? 'next_action_date'
          then (changes ->> 'next_action_date')::date else next_action_date end,
        expected_close = case when changes ? 'expected_close'
          then (changes ->> 'expected_close')::date else expected_close end,
        risk = case when changes ? 'risk'
          then nullif(btrim(changes ->> 'risk'), '') else risk end,
        description = case when changes ? 'description'
          then nullif(btrim(changes ->> 'description'), '') else description end,
        decision_chain_description = case when changes ? 'decision_chain_description'
          then nullif(btrim(changes ->> 'decision_chain_description'), '') else decision_chain_description end,
        competitor_description = case when changes ? 'competitor_description'
          then nullif(btrim(changes ->> 'competitor_description'), '') else competitor_description end
      where id = project_row.id;

      insert into public.project_activities(
        project_id,
        activity_type,
        content,
        next_action,
        next_action_date,
        created_by
      )
      values (
        project_row.id,
        case when changes ? 'stage' then 'stage_change' else 'note' end,
        concat(
          'AI 对话确认更新：',
          coalesce(nullif(btrim(project_item ->> 'activityContent'), ''), proposal_row.summary)
        ),
        case when changes ? 'next_action' then changes ->> 'next_action' else null end,
        case when changes ? 'next_action_date' then (changes ->> 'next_action_date')::date else null end,
        profile_row.id
      );

      update public.alerts a
      set
        status = '已解决',
        resolved_at = now(),
        resolved_by = profile_row.id
      where a.project_id = project_row.id
        and a.status in ('待处理', '已确认')
        and a.alert_type in ('next_action_overdue', 'next_action_due', 'expected_close_overdue', 'stale_project')
        and exists (
          select 1
          from public.projects p
          where p.id = project_row.id
            and (
              p.stage in ('won', 'lost')
              or (
                a.alert_type = 'next_action_overdue'
                and (p.next_action_date is null or p.next_action_date >= current_date)
              )
              or (
                a.alert_type = 'next_action_due'
                and (
                  p.next_action_date is null
                  or p.next_action_date < current_date
                  or p.next_action_date > current_date
                    + coalesce((
                      select threshold_days
                      from public.alert_rules
                      where rule_code = 'next_action_due' and enabled
                    ), 3)
                )
              )
              or (
                a.alert_type = 'expected_close_overdue'
                and (p.expected_close is null or p.expected_close >= current_date)
              )
              or (
                a.alert_type = 'stale_project'
                and p.updated_at >= now()
                  - make_interval(days => coalesce((
                    select threshold_days
                    from public.alert_rules
                    where rule_code = 'stale_project' and enabled
                  ), 14))
              )
            )
        );

      project_updates_count := project_updates_count + 1;
      changed_projects := changed_projects || jsonb_build_array(jsonb_build_object(
        'projectId', project_row.id,
        'projectName', project_row.name,
        'fields', (select jsonb_agg(field_name) from jsonb_object_keys(changes) as field_name)
      ));
    end loop;

    if jsonb_array_length(coalesce(proposal_row.payload -> 'dailyReportEntries', '[]'::jsonb)) > 0 then
      insert into public.daily_report_imports(
        report_date,
        raw_text,
        status,
        entry_count,
        model,
        analysis_snapshot,
        created_by
      )
      values (
        current_date,
        proposal_row.original_text,
        'completed',
        0,
        proposal_row.model,
        jsonb_build_object(
          'source', 'dingtalk_agent',
          'proposalId', proposal_row.id,
          'entries', proposal_row.payload -> 'dailyReportEntries'
        ),
        profile_row.id
      )
      returning id into report_import_uuid;

      for daily_item in
        select value
        from jsonb_array_elements(proposal_row.payload -> 'dailyReportEntries')
      loop
        begin
          project_uuid := nullif(daily_item ->> 'projectId', '')::uuid;
          report_date_value := (daily_item ->> 'reportDate')::date;
          salesperson_uuid := nullif(daily_item ->> 'salespersonId', '')::uuid;
        exception when invalid_text_representation then
          raise exception '日报中的销售、项目或日期无效';
        end;

        if profile_row.role = 'admin' then
          select *
          into salesperson_row
          from public.profiles
          where id = salesperson_uuid
            and active = true
            and role = 'sales';
          if salesperson_row.id is null then
            raise exception '管理员代录日报时必须匹配有效销售账号';
          end if;
        elsif profile_row.role = 'sales' then
          if salesperson_uuid is not null and salesperson_uuid <> profile_row.id then
            raise exception '销售只能录入本人的日报';
          end if;
          salesperson_uuid := profile_row.id;
          salesperson_row := profile_row;
        else
          raise exception '当前账号不支持日报代录，请由销售本人或管理员提交';
        end if;

        select *
        into project_row
        from public.projects
        where id = project_uuid
          and deleted_at is null
        for update;

        if project_row.id is null then
          raise exception '日报对应项目不存在';
        end if;
        if profile_row.role = 'sales'
          and project_row.owner_id <> profile_row.id
        then
          raise exception '销售只能向本人负责的项目录入日报：%', project_row.name;
        end if;
        if report_date_value > current_date
          or report_date_value < current_date - 31
        then
          raise exception '日报日期只能是今天或过去31天内';
        end if;

        activity_type_value := case
          when daily_item ->> 'activityType' in ('call', 'meeting', 'visit', 'proposal', 'task', 'note')
            then daily_item ->> 'activityType'
          else 'note'
        end;
        content_value := nullif(btrim(daily_item ->> 'content'), '');
        if content_value is null then
          raise exception '日报内容不能为空';
        end if;

        insert into public.daily_report_entries(
          import_id,
          project_id,
          salesperson_id,
          report_date,
          activity_type,
          content,
          customer_contact,
          match_confidence,
          match_reason,
          raw_segment,
          created_by
        )
        values (
          report_import_uuid,
          project_row.id,
          salesperson_uuid,
          report_date_value,
          activity_type_value,
          content_value,
          nullif(btrim(daily_item ->> 'customerContact'), ''),
          1,
          '钉钉绑定身份与本人可见项目确认匹配',
          proposal_row.original_text,
          profile_row.id
        )
        returning id into daily_entry_uuid;

        insert into public.project_activities(
          project_id,
          activity_type,
          content,
          occurred_at,
          created_by,
          daily_report_entry_id
        )
        values (
          project_row.id,
          activity_type_value,
          concat('日报记录 · ', salesperson_row.display_name, '：', content_value),
          (report_date_value + time '12:00') at time zone 'Asia/Shanghai',
          profile_row.id,
          daily_entry_uuid
        );

        daily_entries_count := daily_entries_count + 1;
      end loop;

      update public.daily_report_imports
      set
        report_date = coalesce((
          select min((entry ->> 'reportDate')::date)
          from jsonb_array_elements(proposal_row.payload -> 'dailyReportEntries') as entry
        ), current_date),
        entry_count = daily_entries_count
      where id = report_import_uuid;
    end if;

    if project_updates_count = 0 and daily_entries_count = 0 then
      raise exception '待确认更新中没有可写入的内容';
    end if;

    result_value := jsonb_build_object(
      'status', 'confirmed',
      'projectUpdates', project_updates_count,
      'dailyReportEntries', daily_entries_count,
      'projects', changed_projects,
      'dailyReportImportId', report_import_uuid
    );

    update public.dingtalk_write_proposals
    set
      status = 'confirmed',
      confirmation_message_id = confirmation_message,
      result = result_value,
      error_message = null,
      applied_at = now()
    where id = proposal_row.id;

    return result_value;
  exception when others then
    get stacked diagnostics error_detail = message_text;
    update public.dingtalk_write_proposals
    set
      status = 'failed',
      confirmation_message_id = confirmation_message,
      error_message = left(error_detail, 1000)
    where id = proposal_row.id;
    return jsonb_build_object('status', 'failed', 'error', error_detail);
  end;
end;
$$;

revoke all on function public.apply_dingtalk_write_proposal(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_dingtalk_write_proposal(uuid, text, text)
  to service_role;

comment on table public.dingtalk_write_proposals is
  '钉钉销售 Agent 从自然语言生成的待确认项目更新和日报；确认前不得写入业务表。';

comment on function public.apply_dingtalk_write_proposal(uuid, text, text) is
  '原子校验钉钉身份、数据权限和待确认状态后，写入项目、活动及日报。';

commit;
