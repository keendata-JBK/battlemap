const PROACTIVE_ENDPOINT = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend";

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1000) };
  }
}

function ensureSuccess(response, payload, operation) {
  if (response.ok) return payload;
  const message = payload?.message || payload?.errorMessage || payload?.code || `${response.status}`;
  throw new Error(`${operation}失败：${message}`);
}

export async function sendSessionText({
  sessionWebhook,
  accessToken,
  staffId,
  content,
  fetchImpl = fetch,
}) {
  if (!sessionWebhook?.startsWith("https://")) throw new Error("钉钉 sessionWebhook 无效");
  const response = await fetchImpl(sessionWebhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": accessToken,
    },
    body: JSON.stringify({
      at: { atUserIds: staffId ? [staffId] : [], isAtAll: false },
      text: { content },
      msgtype: "text",
    }),
  });
  return ensureSuccess(response, await parseResponse(response), "钉钉会话回复");
}

export async function sendProactiveMarkdown({
  accessToken,
  robotCode,
  staffId,
  title,
  content,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(PROACTIVE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": accessToken,
    },
    body: JSON.stringify({
      robotCode,
      userIds: [staffId],
      msgKey: "sampleMarkdown",
      msgParam: JSON.stringify({ title, text: content }),
    }),
  });
  const payload = ensureSuccess(response, await parseResponse(response), "钉钉主动通知");
  if (Array.isArray(payload.invalidStaffIdList) && payload.invalidStaffIdList.length) {
    throw new Error("钉钉主动通知失败：staffId 无效");
  }
  if (Array.isArray(payload.flowControlledStaffIdList) && payload.flowControlledStaffIdList.length) {
    throw new Error("钉钉主动通知被限流");
  }
  return payload;
}
