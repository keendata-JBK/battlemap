function booleanValue(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function integerValue(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function listValue(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(environment = process.env) {
  const config = {
    clientId: String(environment.DINGTALK_CLIENT_ID ?? "").trim(),
    clientSecret: String(environment.DINGTALK_CLIENT_SECRET ?? "").trim(),
    agentEndpoint: String(environment.DINGTALK_AGENT_ENDPOINT ?? "").trim(),
    connectorToken: String(environment.DINGTALK_CONNECTOR_TOKEN ?? "").trim(),
    port: integerValue(environment.PORT, 8787, 1, 65535),
    debug: booleanValue(environment.DINGTALK_DEBUG),
    progressReply: booleanValue(environment.DINGTALK_PROGRESS_REPLY, true),
    notificationsEnabled: booleanValue(environment.DINGTALK_NOTIFICATIONS_ENABLED),
    notificationAllowAll: booleanValue(environment.DINGTALK_NOTIFICATION_ALLOW_ALL),
    notificationStaffAllowlist: listValue(environment.DINGTALK_NOTIFICATION_STAFF_ALLOWLIST),
    notificationPollMs: integerValue(environment.DINGTALK_NOTIFICATION_POLL_MS, 60000, 15000, 3600000),
  };
  const missing = [
    ["DINGTALK_CLIENT_ID", config.clientId],
    ["DINGTALK_CLIENT_SECRET", config.clientSecret],
    ["DINGTALK_AGENT_ENDPOINT", config.agentEndpoint],
    ["DINGTALK_CONNECTOR_TOKEN", config.connectorToken],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`缺少必填环境变量：${missing.join("、")}`);
  let endpoint;
  try {
    endpoint = new URL(config.agentEndpoint);
  } catch {
    throw new Error("DINGTALK_AGENT_ENDPOINT 不是有效 URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("DINGTALK_AGENT_ENDPOINT 仅支持 HTTP/HTTPS");
  }
  if (config.connectorToken.length < 32) {
    throw new Error("DINGTALK_CONNECTOR_TOKEN 至少需要 32 个字符");
  }
  if (
    config.notificationsEnabled
    && !config.notificationAllowAll
    && config.notificationStaffAllowlist.length === 0
  ) {
    throw new Error("试点主动通知已开启，但未设置 DINGTALK_NOTIFICATION_STAFF_ALLOWLIST");
  }
  return config;
}
