import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { createAgentClient } from "./agent-client.mjs";
import { loadConfig } from "./config.mjs";
import { startHealthServer } from "./health-server.mjs";
import { startNotificationPoller } from "./notification-poller.mjs";
import { createRobotHandler } from "./robot-handler.mjs";

const config = loadConfig();
const state = {
  startedAt: new Date().toISOString(),
  streamConnected: false,
};
const client = new DWClient({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  debug: config.debug,
});
const agentClient = createAgentClient({
  endpoint: config.agentEndpoint,
  connectorToken: config.connectorToken,
});
const handler = createRobotHandler({
  client,
  agentClient,
  progressReply: config.progressReply,
});

client.registerCallbackListener(TOPIC_ROBOT, handler);
const healthServer = startHealthServer({ port: config.port, state });
const notificationPoller = startNotificationPoller({
  client,
  agentClient,
  enabled: config.notificationsEnabled,
  allowAll: config.notificationAllowAll,
  staffAllowlist: config.notificationStaffAllowlist,
  intervalMs: config.notificationPollMs,
});
const connectionStateTimer = setInterval(() => {
  const wasConnected = state.streamConnected;
  state.streamConnected = client.connected;
  if (!wasConnected && state.streamConnected) {
    console.info("钉钉 Stream 已连接，可以开始发送测试消息");
  }
  if (wasConnected && !state.streamConnected) {
    console.warn("钉钉 Stream 连接已断开，SDK 将自动重连");
  }
}, 3000);
connectionStateTimer.unref?.();

async function shutdown(signal) {
  console.info(`收到 ${signal}，正在停止钉钉连接器`);
  clearInterval(connectionStateTimer);
  notificationPoller.stop();
  client.disconnect();
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

try {
  await client.connect();
  state.streamConnected = client.connected;
  if (state.streamConnected) console.info("钉钉 Stream 已连接，可以开始发送测试消息");
  else console.warn("钉钉 Stream 尚未连接，SDK 正在后台重试");
} catch (error) {
  state.streamConnected = false;
  console.error("钉钉 Stream 首次连接失败，SDK 将继续重试", { error: error?.message });
}
