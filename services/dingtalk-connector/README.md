# 军团作战助手 · 钉钉 Stream 连接器

连接器只负责两件事：

1. 通过钉钉 Stream 接收单聊/群聊 @ 消息，并把钉钉身份和问题交给 Supabase Edge Function。
2. 从通知发件箱领取已经过权限计算的 AI 行动摘要，主动发给绑定的销售。

数据库高权限密钥和模型密钥都不放在连接器中。连接器只持有钉钉应用凭证和一枚独立的连接口令。

## 本地试点

1. 复制 `.env.example` 为 `.env`，在本机填写真实值。不要把 `.env` 发到聊天或提交到 Git。
2. 安装依赖：`npm ci`
3. 启动：`npm run start:env`
4. 看到“钉钉 Stream 已连接”后，在钉钉里单聊“军团作战助手”。
5. 首次消息会生成待绑定身份。管理员在网页“系统管理 → 钉钉身份”确认后，再次提问即可读取对应权限范围的数据。

主动通知在试点阶段默认关闭。只有设置
`DINGTALK_NOTIFICATIONS_ENABLED=true`，并填写
`DINGTALK_NOTIFICATION_STAFF_ALLOWLIST` 后才会发送。

健康检查地址：`http://127.0.0.1:8787/health`

## 单独验证主动通知

在已填写 `.env` 的情况下执行：

`node --env-file=.env src/proactive-check.mjs --staff-id=测试人员staffId`

该命令只验证钉钉发送通道，不读取或修改销售数据。
