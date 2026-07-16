import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.mjs";

const base = {
  DINGTALK_CLIENT_ID: "ding-client",
  DINGTALK_CLIENT_SECRET: "secret",
  DINGTALK_AGENT_ENDPOINT: "https://example.supabase.co/functions/v1/dingtalk-agent",
  DINGTALK_CONNECTOR_TOKEN: "a".repeat(32),
};

test("loadConfig keeps proactive notifications off by default", () => {
  const config = loadConfig(base);
  assert.equal(config.notificationsEnabled, false);
  assert.deepEqual(config.notificationStaffAllowlist, []);
  assert.equal(config.progressReply, true);
});

test("loadConfig requires an allowlist when pilot notifications are enabled", () => {
  assert.throws(
    () => loadConfig({ ...base, DINGTALK_NOTIFICATIONS_ENABLED: "true" }),
    /STAFF_ALLOWLIST/,
  );
});

test("loadConfig accepts an explicit pilot allowlist", () => {
  const config = loadConfig({
    ...base,
    DINGTALK_NOTIFICATIONS_ENABLED: "true",
    DINGTALK_NOTIFICATION_STAFF_ALLOWLIST: "sales-1, sales-2",
  });
  assert.deepEqual(config.notificationStaffAllowlist, ["sales-1", "sales-2"]);
});

test("loadConfig rejects short connector tokens", () => {
  assert.throws(
    () => loadConfig({ ...base, DINGTALK_CONNECTOR_TOKEN: "short" }),
    /至少需要 32 个字符/,
  );
});
