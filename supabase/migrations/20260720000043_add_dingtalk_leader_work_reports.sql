begin;

create table public.dingtalk_binding_intents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expected_sender_nick text not null check (char_length(btrim(expected_sender_nick)) between 1 and 80),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_staff_id text,
  claimed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index dingtalk_binding_intents_pending_profile_idx
  on public.dingtalk_binding_intents(profile_id)
  where status = 'pending';

create index dingtalk_binding_intents_pending_nick_idx
  on public.dingtalk_binding_intents(expected_sender_nick, expires_at)
  where status = 'pending';

create trigger dingtalk_binding_intents_set_updated_at
before update on public.dingtalk_binding_intents
for each row execute function public.set_updated_at();

create table public.dingtalk_notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  daily_enabled boolean not null default false,
  daily_time time not null default '20:30',
  weekly_enabled boolean not null default false,
  weekly_day smallint not null default 5 check (weekly_day between 1 and 7),
  weekly_time time not null default '20:45',
  timezone text not null default 'Asia/Shanghai'
    check (timezone = 'Asia/Shanghai'),
  content_mode text not null default 'work_analysis'
    check (content_mode in ('work_analysis')),
  delivery_mode text not null default 'cloud_direct'
    check (delivery_mode in ('cloud_direct')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger dingtalk_notification_preferences_set_updated_at
before update on public.dingtalk_notification_preferences
for each row execute function public.set_updated_at();

alter table public.dingtalk_notification_outbox
  drop constraint if exists dingtalk_notification_outbox_notification_type_check;

alter table public.dingtalk_notification_outbox
  add constraint dingtalk_notification_outbox_notification_type_check
  check (
    notification_type in (
      'action_digest',
      'manual_test',
      'binding_confirmation',
      'daily_work_analysis',
      'weekly_work_analysis'
    )
  );

alter table public.dingtalk_binding_intents enable row level security;
alter table public.dingtalk_notification_preferences enable row level security;

create policy dingtalk_binding_intents_admin_read
on public.dingtalk_binding_intents for select to authenticated
using ((select public.is_admin()));

create policy dingtalk_binding_intents_admin_manage
on public.dingtalk_binding_intents for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy dingtalk_notification_preferences_admin_read
on public.dingtalk_notification_preferences for select to authenticated
using ((select public.is_admin()));

create policy dingtalk_notification_preferences_admin_manage
on public.dingtalk_notification_preferences for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

grant select, insert, update, delete on public.dingtalk_binding_intents to authenticated;
grant select, insert, update, delete on public.dingtalk_notification_preferences to authenticated;

comment on table public.dingtalk_binding_intents is
  '管理员预授权的一次性钉钉身份认领；只有真实入站消息携带的 staffId 才能完成绑定。';
comment on table public.dingtalk_notification_preferences is
  '钉钉领导工作日报和周报的云端直发时间与内容模式。';

insert into public.dingtalk_binding_intents(profile_id, expected_sender_nick)
select p.id, '朱建勇'
from public.profiles p
where p.display_name = '朱建勇'
  and p.role = 'admin'
  and p.active = true
  and not exists (
    select 1
    from public.dingtalk_user_bindings b
    where b.profile_id = p.id and b.status = 'active'
  )
on conflict do nothing;

insert into public.dingtalk_notification_preferences(
  profile_id,
  daily_enabled,
  daily_time,
  weekly_enabled,
  weekly_day,
  weekly_time,
  content_mode,
  delivery_mode
)
select
  p.id,
  true,
  '20:30'::time,
  true,
  5,
  '20:45'::time,
  'work_analysis',
  'cloud_direct'
from public.profiles p
where p.display_name = '朱建勇'
  and p.role = 'admin'
  and p.active = true
on conflict (profile_id) do update
set
  daily_enabled = excluded.daily_enabled,
  daily_time = excluded.daily_time,
  weekly_enabled = excluded.weekly_enabled,
  weekly_day = excluded.weekly_day,
  weekly_time = excluded.weekly_time,
  content_mode = excluded.content_mode,
  delivery_mode = excluded.delivery_mode;

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'dingtalk-scheduled-work-reports'
  ) then
    perform cron.unschedule('dingtalk-scheduled-work-reports');
  end if;
end;
$$;

select cron.schedule(
  'dingtalk-scheduled-work-reports',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://eqqjsprkqiiymvuwfojb.supabase.co/functions/v1/dingtalk-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-token', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'sales_reports_scheduler_token'
        limit 1
      )
    ),
    body := jsonb_build_object('action', 'scheduled_reports')
  );
  $cron$
);

commit;
