import { sendProactiveMarkdown } from "./dingtalk-api.mjs";

export function startNotificationPoller({
  client,
  agentClient,
  enabled,
  allowAll,
  staffAllowlist,
  intervalMs,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!enabled) {
    logger.info("主动通知处于关闭状态（试点默认）");
    return { stop() {}, runOnce: async () => ({ sent: 0, failed: 0 }) };
  }
  let running = false;
  let stopped = false;

  async function runOnce() {
    if (running || stopped) return { sent: 0, failed: 0, skipped: true };
    running = true;
    let sent = 0;
    let failed = 0;
    try {
      const payload = await agentClient.pullNotifications({
        prepare: true,
        staffAllowlist: allowAll ? [] : staffAllowlist,
      });
      for (const notification of payload.notifications ?? []) {
        try {
          const accessToken = await client.getAccessToken();
          await sendProactiveMarkdown({
            accessToken,
            robotCode: notification.robot_code,
            staffId: notification.staff_id,
            title: notification.title,
            content: notification.content,
            fetchImpl,
          });
          await agentClient.acknowledgeNotification(notification.id, true);
          sent += 1;
        } catch (error) {
          failed += 1;
          await agentClient.acknowledgeNotification(notification.id, false, error?.message ?? "发送失败")
            .catch((ackError) => logger.error("通知失败状态回写失败", { error: ackError?.message }));
          logger.error("主动通知发送失败", {
            notificationId: notification.id,
            staffId: notification.staff_id,
            error: error?.message,
          });
        }
      }
      if (sent || failed) logger.info("主动通知轮询完成", { sent, failed });
      return { sent, failed };
    } catch (error) {
      logger.error("主动通知轮询失败", { error: error?.message });
      return { sent, failed, error: error?.message };
    } finally {
      running = false;
    }
  }

  const timer = setInterval(runOnce, intervalMs);
  timer.unref?.();
  runOnce();
  return {
    runOnce,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
