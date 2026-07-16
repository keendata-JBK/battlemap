import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppliedReply,
  buildProposalPreview,
  isCancelCommand,
  isConfirmCommand,
  normalizeWriteProposal,
  parseModelJson,
} from "../../../supabase/functions/dingtalk-agent/write-proposal.mjs";

const projects = [
  {
    id: "project-1",
    name: "杭州数据平台项目",
    owner_id: "sales-1",
    owner_name: "张三",
    amount: 1000,
    contract_signed_amount: null,
    stage: "discovery",
    health: "green",
    priority: "P2",
    next_action: "需求沟通",
    next_action_date: "2026-07-17",
    expected_close: "2026-09-30",
    risk: "",
    description: "",
    decision_chain_description: "",
    competitor_description: "",
    updated_at: "2026-07-16T12:00:00.000Z",
  },
  {
    id: "project-2",
    name: "成都可信数据空间项目",
    owner_id: "sales-2",
    owner_name: "李四",
    amount: 2000,
    stage: "solution",
    health: "yellow",
    priority: "P1",
    updated_at: "2026-07-16T12:05:00.000Z",
  },
];
const salespeople = [
  { id: "sales-1", display_name: "张三", role: "sales" },
  { id: "sales-2", display_name: "李四", role: "sales" },
];

test("requires an explicit confirmation or cancellation command", () => {
  assert.equal(isConfirmCommand("确认更新"), true);
  assert.equal(isConfirmCommand("确认更新。"), true);
  assert.equal(isConfirmCommand("我确认更新这个项目"), false);
  assert.equal(isCancelCommand("取消更新"), true);
});

test("parses fenced model JSON", () => {
  assert.deepEqual(
    parseModelJson('```json\n{"answer":"ok","proposal":null}\n```'),
    { answer: "ok", proposal: null },
  );
});

test("sales can draft project changes and a daily report only for themselves", () => {
  const result = normalizeWriteProposal({
    projectUpdates: [{
      projectId: "project-1",
      changes: {
        amount: 1800,
        stage: "solution",
        nextAction: "下周三提交方案",
        nextActionDate: "2026-07-22",
      },
    }],
    dailyReportEntries: [
      {
        projectId: "project-1",
        salespersonId: "sales-2",
        reportDate: "2026-07-16",
        activityType: "visit",
        content: "拜访客户并确认预算范围",
      },
      {
        projectId: "project-2",
        reportDate: "2026-07-16",
        activityType: "meeting",
        content: "参与需求会",
      },
    ],
  }, {
    profile: { id: "sales-1", display_name: "张三", role: "sales" },
    projects,
    salespeople: [salespeople[0]],
    today: "2026-07-16",
  });

  assert.equal(result.proposal.projectUpdates.length, 1);
  assert.deepEqual(result.proposal.projectUpdates[0].changes, {
    amount: 1800,
    stage: "solution",
    next_action: "下周三提交方案",
    next_action_date: "2026-07-22",
  });
  assert.equal(
    result.proposal.projectUpdates[0].expectedUpdatedAt,
    "2026-07-16T12:00:00.000Z",
  );
  assert.equal(result.proposal.dailyReportEntries.length, 1);
  assert.equal(
    result.proposal.dailyReportEntries[0].salespersonId,
    "sales-1",
  );
  assert.match(result.warnings.join("；"), /销售只能向本人负责的项目/);
});

test("admin can batch daily reports for multiple sales and dates", () => {
  const result = normalizeWriteProposal({
    projectUpdates: [],
    dailyReportEntries: [
      {
        projectId: "project-1",
        salespersonId: "sales-1",
        reportDate: "2026-07-15",
        activityType: "call",
        content: "电话确认客户预算",
      },
      {
        projectId: "project-2",
        salespersonId: "sales-2",
        reportDate: "2026-07-16",
        activityType: "proposal",
        content: "完成方案交流",
      },
    ],
  }, {
    profile: { id: "admin-1", display_name: "吴俞橙", role: "admin" },
    projects,
    salespeople,
    today: "2026-07-16",
  });

  assert.equal(result.proposal.dailyReportEntries.length, 2);
  assert.deepEqual(
    result.proposal.dailyReportEntries.map((entry) => entry.salespersonName),
    ["张三", "李四"],
  );
  assert.match(
    buildProposalPreview(result.proposal),
    /2026-07-15 · 张三 · 杭州数据平台项目/,
  );
});

test("future daily reports and unknown sales are not drafted", () => {
  const result = normalizeWriteProposal({
    dailyReportEntries: [
      {
        projectId: "project-1",
        salespersonId: "missing-sales",
        reportDate: "2026-07-17",
        activityType: "visit",
        content: "未来拜访",
      },
    ],
  }, {
    profile: { id: "admin-1", display_name: "吴俞橙", role: "admin" },
    projects,
    salespeople,
    today: "2026-07-16",
  });

  assert.equal(result.proposal, null);
  assert.match(result.warnings.join("；"), /未能准确匹配销售/);
});

test("applied reply reports writes and idempotency", () => {
  const reply = buildAppliedReply({
    status: "confirmed",
    projectUpdates: 1,
    dailyReportEntries: 2,
    alreadyApplied: true,
  });
  assert.match(reply, /已更新 1 个项目/);
  assert.match(reply, /已导入 2 条销售日报/);
  assert.match(reply, /没有重复写入/);
});
