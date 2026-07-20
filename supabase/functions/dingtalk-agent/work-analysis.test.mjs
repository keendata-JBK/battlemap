import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkAnalysisFallback,
  chinaClockParts,
  dueReportTypes,
  isoWeekStart,
} from "./work-analysis.mjs";

test("uses China time and ISO weekday", () => {
  assert.deepEqual(
    chinaClockParts(new Date("2026-07-17T12:45:00.000Z")),
    { date: "2026-07-17", time: "20:45", isoWeekday: 5 },
  );
  assert.equal(isoWeekStart("2026-07-17", 5), "2026-07-13");
});

test("daily and weekly reports become due at their configured times", () => {
  const preference = {
    daily_enabled: true,
    daily_time: "20:30:00",
    weekly_enabled: true,
    weekly_day: 5,
    weekly_time: "20:45:00",
  };
  assert.deepEqual(
    dueReportTypes(preference, {
      date: "2026-07-17",
      time: "20:29",
      isoWeekday: 5,
    }),
    [],
  );
  assert.deepEqual(
    dueReportTypes(preference, {
      date: "2026-07-17",
      time: "20:45",
      isoWeekday: 5,
    }),
    ["daily", "weekly"],
  );
});

test("fallback analyzes work without discussing data defects", () => {
  const result = buildWorkAnalysisFallback({
    displayName: "朱建勇",
    reportType: "daily",
    periodLabel: "2026-07-20",
    entries: [{
      salesperson_id: "sales-1",
      project_id: "project-1",
      activity_type: "visit",
      content: "与客户确认方案评审安排",
    }],
    projects: [{
      id: "project-1",
      name: "示例项目",
      next_action: "完成方案评审",
      next_action_date: "2026-07-21",
      risk: null,
    }],
    salespeople: [{ id: "sales-1", display_name: "销售甲" }],
  });
  assert.match(result.content, /管理结论/);
  assert.match(result.content, /销售甲/);
  assert.doesNotMatch(result.content, /缺失|缺数据|字段|录入质量/);
});
