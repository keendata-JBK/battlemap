import assert from "node:assert/strict";
import test from "node:test";
import { AgentRequestError, createAgentClient } from "../src/agent-client.mjs";

test("agent client sends connector token and message payload", async () => {
  let request;
  const client = createAgentClient({
    endpoint: "https://example.test/dingtalk-agent",
    connectorToken: "token-value",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ answer: "ok" }), { status: 200 });
    },
  });
  const result = await client.answer({ staffId: "staff-1", question: "今天做什么？" });
  assert.equal(result.answer, "ok");
  assert.equal(request.url, "https://example.test/dingtalk-agent");
  assert.equal(request.init.headers["x-dingtalk-connector-token"], "token-value");
  assert.deepEqual(JSON.parse(request.init.body), {
    action: "message",
    staffId: "staff-1",
    question: "今天做什么？",
  });
});

test("agent client exposes safe backend errors", async () => {
  const client = createAgentClient({
    endpoint: "https://example.test/dingtalk-agent",
    connectorToken: "token-value",
    fetchImpl: async () => new Response(JSON.stringify({ error: "身份未绑定" }), { status: 403 }),
  });
  await assert.rejects(
    () => client.answer({ staffId: "staff-1", question: "test" }),
    (error) => error instanceof AgentRequestError && error.status === 403 && error.message === "身份未绑定",
  );
});
