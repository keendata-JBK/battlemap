begin;

do $test$
declare
  admin_binding record;
  target_project record;
  proposal_uuid uuid;
  applied jsonb;
  test_risk text;
begin
  select
    b.staff_id,
    b.profile_id
  into admin_binding
  from public.dingtalk_user_bindings b
  join public.profiles profile on profile.id = b.profile_id
  where b.status = 'active'
    and profile.active = true
    and profile.role = 'admin'
  order by b.bound_at
  limit 1;

  if admin_binding.staff_id is null then
    raise exception '测试需要一个已绑定的管理员钉钉身份';
  end if;

  select
    project.id,
    project.name,
    project.owner_id,
    project.updated_at,
    project.risk
  into target_project
  from public.projects project
  join public.profiles owner on owner.id = project.owner_id
  where project.deleted_at is null
    and owner.active = true
    and owner.role = 'sales'
  order by project.updated_at desc
  limit 1;

  if target_project.id is null then
    raise exception '测试需要一个由销售负责的有效项目';
  end if;

  test_risk := left(coalesce(target_project.risk, ''), 900)
    || ' [钉钉确认事务回滚测试]';

  insert into public.dingtalk_write_proposals(
    staff_id,
    profile_id,
    conversation_id,
    source_message_id,
    original_text,
    summary,
    payload,
    status,
    expires_at
  )
  values (
    admin_binding.staff_id,
    admin_binding.profile_id,
    'codex-transaction-test',
    'codex-source-' || gen_random_uuid()::text,
    '钉钉确认写入事务测试，事务结束后必须回滚',
    '事务内测试一个项目更新和一条管理员代录日报',
    jsonb_build_object(
      'version', 1,
      'projectUpdates', jsonb_build_array(jsonb_build_object(
        'projectId', target_project.id,
        'projectName', target_project.name,
        'expectedUpdatedAt', target_project.updated_at,
        'changes', jsonb_build_object('risk', test_risk),
        'before', jsonb_build_object('risk', target_project.risk),
        'activityContent', '事务回滚测试'
      )),
      'dailyReportEntries', jsonb_build_array(jsonb_build_object(
        'projectId', target_project.id,
        'projectName', target_project.name,
        'salespersonId', target_project.owner_id,
        'reportDate', current_date,
        'activityType', 'note',
        'content', '钉钉确认写入事务回滚测试',
        'customerContact', ''
      ))
    ),
    'pending',
    now() + interval '1 hour'
  )
  returning id into proposal_uuid;

  applied := public.apply_dingtalk_write_proposal(
    proposal_uuid,
    admin_binding.staff_id,
    'codex-confirm-' || gen_random_uuid()::text
  );

  if applied ->> 'status' <> 'confirmed'
    or (applied ->> 'projectUpdates')::integer <> 1
    or (applied ->> 'dailyReportEntries')::integer <> 1
  then
    raise exception '确认写入结果不符合预期：%', applied;
  end if;

  if not exists (
    select 1
    from public.projects
    where id = target_project.id
      and risk = test_risk
  ) then
    raise exception '项目更新没有在事务中生效';
  end if;

  if not exists (
    select 1
    from public.daily_report_imports
    where analysis_snapshot ->> 'proposalId' = proposal_uuid::text
      and entry_count = 1
  ) then
    raise exception '管理员代录日报没有在事务中生效';
  end if;
end;
$test$;

rollback;
