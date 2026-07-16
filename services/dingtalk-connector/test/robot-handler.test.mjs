import assert from "node:assert/strict";
import test from "node:test";
import { createRobotHandler } from "../src/robot-handler.mjs";

function incoming(overrides = {}) {
  return {
    headers: { messageId: "callback-1" },
    data: JSON.stringify({
      msgId: "message-1",
      senderStaffId: "staff-1",
      senderNick: "张三",
      conversationId: "conversation-1",
      robotCode: "robot-code",
      sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=test",
      text: { content: " 今天先做什么？ " },
      ...overrides,
    }),
  };
}

test("robot handler acknowledges immediately and forwards identity context", async () => {
  const acknowledgements = [];
  const answerInputs = [];
  const replies = [];
  const client = {
    socketCallBackResponse(messageId, value) {
      acknowledgements.push({ messageId, value });
    },
    async getAccessToken() {
      return "access-token";
    },
  };
  const handler = createRobotHandler({
    client,
    progressReply: false,
    agentClient: {
      async answer(input) {
        answerInputs.push(input);
        return { answer: "先处理逾期项目。" };
      },
    },
    fetchImpl: async (url, init) => {
      replies.push({ url, body: JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  await handler(incoming());

  assert.deepEqual(acknowledgements, [{ messageId: "callback-1", value: {} }]);
  assert.deepEqual(answerInputs, [{
    staffId: "staff-1",
    senderNick: "张三",
    conversationId: "conversation-1",
    messageId: "message-1",
    robotCode: "robot-code",
    question: "今天先做什么？",
  }]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].body.text.content, "先处理逾期项目。");
});

test("robot handler does not call the agent for unsupported messages", async () => {
  let called = false;
  const acknowledgements = [];
  const handler = createRobotHandler({
    client: {
      socketCallBackResponse(messageId) {
        acknowledgements.push(messageId);
      },
      async getAccessToken() {
        return "access-token";
      },
    },
    progressReply: false,
    agentClient: {
      async answer() {
        called = true;
        return { answer: "unexpected" };
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  await handler(incoming({ text: null, content: null }));

  assert.deepEqual(acknowledgements, ["callback-1"]);
  assert.equal(called, false);
});
