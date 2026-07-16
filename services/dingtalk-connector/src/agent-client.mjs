export class AgentRequestError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "AgentRequestError";
    this.status = status;
  }
}

async function parsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 1000) };
  }
}

export function createAgentClient({ endpoint, connectorToken, fetchImpl = fetch, timeoutMs = 60000 }) {
  async function request(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-dingtalk-connector-token": connectorToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await parsePayload(response);
      if (!response.ok) {
        throw new AgentRequestError(payload.error || `Sales Agent 请求失败（${response.status}）`, response.status);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new AgentRequestError("Sales Agent 响应超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    answer(input) {
      return request({ action: "message", ...input });
    },
    pullNotifications({ prepare, staffAllowlist }) {
      return request({ action: "pull_notifications", prepare, staffAllowlist });
    },
    acknowledgeNotification(notificationId, success, error = "") {
      return request({ action: "ack_notification", notificationId, success, error });
    },
  };
}
