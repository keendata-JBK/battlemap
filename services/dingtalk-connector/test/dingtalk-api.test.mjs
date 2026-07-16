import assert from "node:assert/strict";
import test from "node:test";
import { sendProactiveMarkdown, sendSessionText } from "../src/dingtalk-api.mjs";

test("sendSessionText replies only to the current staff member", async () => {
  let request;
  await sendSessionText({
    sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=test",
    accessToken: "access-token",
    staffId: "staff-1",
    content: "回答",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response("{}", { status: 200 });
    },
  });
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.at.atUserIds, ["staff-1"]);
  assert.equal(body.text.content, "回答");
  assert.equal(request.init.headers["x-acs-dingtalk-access-token"], "access-token");
});

test("sendProactiveMarkdown uses the enterprise robot one-to-one API", async () => {
  let request;
  await sendProactiveMarkdown({
    accessToken: "access-token",
    robotCode: "robot-code",
    staffId: "staff-1",
    title: "今日待办",
    content: "1. 跟进客户",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ processQueryKey: "process-1" }), { status: 200 });
    },
  });
  const body = JSON.parse(request.init.body);
  assert.equal(request.url, "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend");
  assert.deepEqual(body.userIds, ["staff-1"]);
  assert.equal(body.robotCode, "robot-code");
  assert.equal(body.msgKey, "sampleMarkdown");
  assert.deepEqual(JSON.parse(body.msgParam), { title: "今日待办", text: "1. 跟进客户" });
});

test("sendProactiveMarkdown treats invalid staff IDs as failures", async () => {
  await assert.rejects(
    () => sendProactiveMarkdown({
      accessToken: "access-token",
      robotCode: "robot-code",
      staffId: "bad-staff",
      title: "test",
      content: "test",
      fetchImpl: async () => new Response(JSON.stringify({
        invalidStaffIdList: ["bad-staff"],
      }), { status: 200 }),
    }),
    /staffId 无效/,
  );
});
