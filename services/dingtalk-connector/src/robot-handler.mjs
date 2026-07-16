import { sendSessionText } from "./dingtalk-api.mjs";

function incomingText(message) {
  return String(
    message?.text?.content
    ?? message?.content?.recognition
    ?? "",
  ).trim();
}

function safeLog(logger, level, message, details = {}) {
  const sanitized = Object.fromEntries(
    Object.entries(details).filter(([key]) => !/secret|token|webhook/i.test(key)),
  );
  logger[level]?.(message, sanitized);
}

export function createRobotHandler({
  client,
  agentClient,
  progressReply = true,
  fetchImpl = fetch,
  logger = console,
}) {
  return async function onRobotMessage(downstream) {
    const callbackMessageId = downstream?.headers?.messageId;
    if (callbackMessageId) {
      client.socketCallBackResponse(callbackMessageId, {});
    }
    let message;
    try {
      message = JSON.parse(downstream?.data ?? "{}");
    } catch {
      safeLog(logger, "warn", "忽略无法解析的钉钉消息");
      return;
    }
    const question = incomingText(message);
    const staffId = String(message.senderStaffId ?? "").trim();
    const sessionWebhook = String(message.sessionWebhook ?? "").trim();
    if (!question || !staffId || !sessionWebhook) {
      safeLog(logger, "warn", "忽略缺少文本、staffId 或 sessionWebhook 的钉钉消息", {
        messageId: message.msgId,
        staffId,
      });
      return;
    }

    safeLog(logger, "info", "收到钉钉机器人消息", {
      messageId: message.msgId,
      staffId,
      senderNick: message.senderNick,
    });
    let progressTimer;
    let progressSent = false;
    if (progressReply) {
      progressTimer = setTimeout(async () => {
        try {
          const accessToken = await client.getAccessToken();
          await sendSessionText({
            sessionWebhook,
            accessToken,
            staffId,
            content: "收到，我正在按你的数据权限分析实时销售数据，请稍候…",
            fetchImpl,
          });
          progressSent = true;
        } catch (error) {
          safeLog(logger, "warn", "钉钉进度提示发送失败", { error: error?.message });
        }
      }, 1500);
      progressTimer.unref?.();
    }

    let answer;
    try {
      const payload = await agentClient.answer({
        staffId,
        senderNick: String(message.senderNick ?? "").trim(),
        conversationId: String(message.conversationId ?? "").trim(),
        messageId: String(message.msgId ?? callbackMessageId ?? "").trim(),
        robotCode: String(message.robotCode ?? "").trim(),
        question,
      });
      answer = String(payload.answer ?? "").trim() || "这次没有生成有效回答，请稍后重试。";
    } catch (error) {
      safeLog(logger, "error", "Sales Agent 处理失败", {
        messageId: message.msgId,
        staffId,
        error: error?.message,
      });
      answer = "Sales Agent 暂时无法读取实时数据，请稍后再试。管理员可检查连接器健康状态和 Supabase Function 日志。";
    } finally {
      if (progressTimer) clearTimeout(progressTimer);
    }

    try {
      const accessToken = await client.getAccessToken();
      await sendSessionText({
        sessionWebhook,
        accessToken,
        staffId,
        content: answer,
        fetchImpl,
      });
      safeLog(logger, "info", "钉钉机器人回答已发送", {
        messageId: message.msgId,
        staffId,
        progressSent,
      });
    } catch (error) {
      safeLog(logger, "error", "钉钉最终回答发送失败", {
        messageId: message.msgId,
        staffId,
        error: error?.message,
      });
    }
  };
}
