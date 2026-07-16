begin;

create table public.dingtalk_user_bindings (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null unique check (char_length(btrim(staff_id)) between 1 and 128),
  profile_id uuid unique references public.profiles(id) on delete set null,
  sender_nick text not null default '',
  robot_code text,
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  last_seen_at timestamptz not null default now(),
  bound_at timestamptz,
  bound_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and profile_id is not null)
    or status in ('pending', 'disabled')
  )
);

create index dingtalk_user_bindings_profile_idx
  on public.dingtalk_user_bindings(profile_id)
  where profile_id is not null;

create table public.dingtalk_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  staff_id text not null references public.dingtalk_user_bindings(staff_id) on delete cascade,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(conversation_id, staff_id)
);

create table public.dingtalk_message_log (
  id uuid primary key default gen_random_uuid(),
  message_key text not null unique,
  staff_id text not null,
  conversation_id text,
  profile_id uuid references public.profiles(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text not null default 'text',
  content text not null default '',
  status text not null default 'received' check (status in ('received', 'processing', 'completed', 'failed', 'sent')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index dingtalk_message_log_staff_idx
  on public.dingtalk_message_log(staff_id, created_at desc);

create table public.dingtalk_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  staff_id text not null,
  robot_code text not null,
  notification_type text not null default 'action_digest'
    check (notification_type in ('action_digest', 'manual_test', 'binding_confirmation')),
  title text not null,
  content text not null,
  dedupe_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dingtalk_notification_outbox_pending_idx
  on public.dingtalk_notification_outbox(available_at, created_at)
  where status = 'pending';

create trigger dingtalk_user_bindings_set_updated_at
before update on public.dingtalk_user_bindings
for each row execute function public.set_updated_at();

create trigger dingtalk_conversations_set_updated_at
before update on public.dingtalk_conversations
for each row execute function public.set_updated_at();

create trigger dingtalk_notification_outbox_set_updated_at
before update on public.dingtalk_notification_outbox
for each row execute function public.set_updated_at();

alter table public.dingtalk_user_bindings enable row level security;
alter table public.dingtalk_conversations enable row level security;
alter table public.dingtalk_message_log enable row level security;
alter table public.dingtalk_notification_outbox enable row level security;

create policy dingtalk_user_bindings_admin_read
on public.dingtalk_user_bindings for select to authenticated
using ((select public.is_admin()));

create policy dingtalk_user_bindings_admin_update
on public.dingtalk_user_bindings for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy dingtalk_message_log_admin_read
on public.dingtalk_message_log for select to authenticated
using ((select public.is_admin()));

create policy dingtalk_notification_outbox_admin_read
on public.dingtalk_notification_outbox for select to authenticated
using ((select public.is_admin()));

create policy dingtalk_notification_outbox_admin_insert
on public.dingtalk_notification_outbox for insert to authenticated
with check (
  (select public.is_admin())
  and created_by = (select auth.uid())
);

grant select, update on public.dingtalk_user_bindings to authenticated;
grant select on public.dingtalk_message_log to authenticated;
grant select, insert on public.dingtalk_notification_outbox to authenticated;

comment on table public.dingtalk_user_bindings is
  '钉钉 staffId 与营销作战地图账号的人工确认绑定；未绑定用户不得读取业务数据。';
comment on table public.dingtalk_notification_outbox is
  'AI 认知行动主动通知发件箱；由 Stream 连接器领取并通过钉钉应用机器人发送。';

commit;
