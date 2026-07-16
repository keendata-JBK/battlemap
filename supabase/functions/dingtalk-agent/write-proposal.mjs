const ALLOWED_STAGES = new Set([
  "lead",
  "discovery",
  "solution",
  "negotiation",
  "contract",
  "won",
  "lost",
]);
const ALLOWED_HEALTH = new Set(["green", "yellow", "red", "gray"]);
const ALLOWED_PRIORITY = new Set(["P0", "P1", "P2", "P3"]);
const ALLOWED_ACTIVITY_TYPES = new Set([
  "call",
  "meeting",
  "visit",
  "proposal",
  "task",
  "note",
]);

const STAGE_LABELS = {
  lead: "线索",
  discovery: "需求发现",
  solution: "方案交流",
  negotiation: "商务谈判",
  contract: "合同签订",
  won: "已赢单",
  lost: "已丢单",
};
const HEALTH_LABELS = {
  green: "正常",
  yellow: "关注",
  red: "高风险",
  gray: "暂停",
};
const ACTIVITY_LABELS = {
  call: "电话",
  meeting: "会议",
  visit: "拜访",
  proposal: "方案",
  task: "任务推进",
  note: "普通跟进",
};
const FIELD_META = {
  amount: { label: "商机金额", source: "amount", type: "amount" },
  contract_signed_amount: {
    label: "合同签订金额",
    source: "contract_signed_amount",
    type: "amount",
  },
  stage: { label: "销售阶段", source: "stage", type: "stage" },
  health: { label: "健康度", source: "health", type: "health" },
  priority: { label: "优先级", source: "priority", type: "text" },
  next_action: { label: "下一步动作", source: "next_action", type: "text" },
  next_action_date: {
    label: "行动日期",
    source: "next_action_date",
    type: "date",
  },
  expected_close: {
    label: "预计成交日期",
    source: "expected_close",
    type: "date",
  },
  risk: { label: "风险", source: "risk", type: "text" },
  description: { label: "项目情况", source: "description", type: "text" },
  decision_chain_description: {
    label: "决策链",
    source: "decision_chain_description",
    type: "text",
  },
  competitor_description: {
    label: "竞争情况",
    source: "competitor_description",
    type: "text",
  },
};

function text(value, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function canonicalCommand(value) {
  return text(value, 50)
    .replace(/[\s，,。.!！?？；;：:、“”"'`]/g, "")
    .toLowerCase();
}

export function isConfirmCommand(value) {
  return new Set(["确认更新", "确认写入", "确认执行"]).has(
    canonicalCommand(value),
  );
}

export function isCancelCommand(value) {
  return new Set(["取消更新", "取消写入", "取消执行", "放弃更新"]).has(
    canonicalCommand(value),
  );
}

export function parseModelJson(value) {
  const raw = text(value, 30000);
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回有效 JSON");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function validDate(value) {
  const candidate = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T12:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : candidate;
}

function daysBetween(left, right) {
  return Math.round(
    (new Date(`${left}T12:00:00+08:00`).getTime() -
      new Date(`${right}T12:00:00+08:00`).getTime()) / 86400000,
  );
}

function finiteAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 9999999999) {
    return null;
  }
  return Math.round(number * 100) / 100;
}

function sourceValue(project, fieldName) {
  const source = FIELD_META[fieldName]?.source;
  if (!source) return undefined;
  if (Object.hasOwn(project, source)) return project[source];
  const camel = source.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return project[camel];
}

function normalizedFieldValue(fieldName, value) {
  if (["amount", "contract_signed_amount"].includes(fieldName)) {
    return finiteAmount(value);
  }
  if (["next_action_date", "expected_close"].includes(fieldName)) {
    return validDate(value);
  }
  if (fieldName === "stage") {
    const candidate = text(value, 30);
    return ALLOWED_STAGES.has(candidate) ? candidate : null;
  }
  if (fieldName === "health") {
    const candidate = text(value, 20);
    return ALLOWED_HEALTH.has(candidate) ? candidate : null;
  }
  if (fieldName === "priority") {
    const candidate = text(value, 10).toUpperCase();
    return ALLOWED_PRIORITY.has(candidate) ? candidate : null;
  }
  const limits = {
    next_action: 500,
    risk: 1000,
    description: 2000,
    decision_chain_description: 2000,
    competitor_description: 2000,
  };
  const candidate = text(value, limits[fieldName] ?? 1000);
  return candidate || null;
}

function sameValue(left, right, type) {
  if (type === "amount") {
    if (left == null && right == null) return true;
    return Number(left) === Number(right);
  }
  return String(left ?? "") === String(right ?? "");
}

function candidateChanges(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    amount: raw.amount,
    contract_signed_amount:
      raw.contract_signed_amount ?? raw.contractSignedAmount,
    stage: raw.stage,
    health: raw.health,
    priority: raw.priority,
    next_action: raw.next_action ?? raw.nextAction,
    next_action_date: raw.next_action_date ?? raw.nextActionDate,
    expected_close: raw.expected_close ?? raw.expectedClose,
    risk: raw.risk,
    description: raw.description,
    decision_chain_description:
      raw.decision_chain_description ?? raw.decisionChainDescription,
    competitor_description:
      raw.competitor_description ?? raw.competitorDescription,
  };
}

function normalizeProjectUpdates(rawUpdates, projectsById, warnings) {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawUpdates) ? rawUpdates.slice(0, 10) : []) {
    const project = projectsById.get(text(raw?.projectId, 80));
    if (!project) {
      warnings.push(
        `未能在当前权限范围内准确匹配项目“${text(raw?.projectName, 80) || "未命名项目"}”`,
      );
      continue;
    }
    const changes = {};
    const before = {};
    for (
      const [fieldName, candidate] of Object.entries(
        candidateChanges(raw?.changes),
      )
    ) {
      if (candidate == null || candidate === "") continue;
      const value = normalizedFieldValue(fieldName, candidate);
      if (value == null) {
        warnings.push(`${project.name} 的${FIELD_META[fieldName].label}取值无效`);
        continue;
      }
      const previous = sourceValue(project, fieldName);
      if (sameValue(previous, value, FIELD_META[fieldName].type)) continue;
      changes[fieldName] = value;
      before[fieldName] = previous ?? null;
    }
    if (!Object.keys(changes).length) continue;
    const dedupeKey = `${project.id}:${JSON.stringify(changes)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push({
      projectId: project.id,
      projectName: project.name,
      expectedUpdatedAt: project.updated_at ?? project.updatedAt ?? null,
      changes,
      before,
      activityContent:
        text(raw?.activityContent, 1000) ||
        `更新${Object.keys(changes).map((field) => FIELD_META[field].label).join("、")}`,
    });
  }
  return normalized;
}

function normalizeDailyEntries(
  rawEntries,
  projectsById,
  salespeopleById,
  profile,
  today,
  warnings,
) {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawEntries) ? rawEntries.slice(0, 30) : []) {
    const project = projectsById.get(text(raw?.projectId, 80));
    if (!project) {
      warnings.push(
        `日报未能准确匹配项目“${text(raw?.projectName, 80) || "未命名项目"}”`,
      );
      continue;
    }
    let salesperson;
    if (profile.role === "admin") {
      salesperson = salespeopleById.get(text(raw?.salespersonId, 80));
      if (!salesperson) {
        warnings.push(
          `${project.name} 的日报未能准确匹配销售“${text(raw?.salespersonName, 80) || "未注明"}”`,
        );
        continue;
      }
    } else if (profile.role === "sales") {
      salesperson = {
        id: profile.id,
        display_name: profile.display_name,
      };
      if (project.owner_id !== profile.id) {
        warnings.push(`销售只能向本人负责的项目录入日报：${project.name}`);
        continue;
      }
    } else {
      warnings.push("当前账号只能分析日报，不能代录销售日报");
      continue;
    }
    const reportDate = validDate(raw?.reportDate) ?? today;
    const offset = daysBetween(reportDate, today);
    if (offset > 0 || offset < -31) {
      warnings.push(`${project.name} 的日报日期必须是今天或过去31天内`);
      continue;
    }
    const activityType = ALLOWED_ACTIVITY_TYPES.has(text(raw?.activityType, 20))
      ? text(raw?.activityType, 20)
      : "note";
    const content = text(raw?.content, 2000);
    if (!content) {
      warnings.push(`${project.name} 的日报内容为空`);
      continue;
    }
    const entry = {
      projectId: project.id,
      projectName: project.name,
      salespersonId: salesperson.id,
      salespersonName: salesperson.display_name,
      reportDate,
      activityType,
      content,
      customerContact: text(raw?.customerContact, 200),
    };
    const dedupeKey = JSON.stringify(entry);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(entry);
  }
  return normalized;
}

export function normalizeWriteProposal(raw, context) {
  const profile = context.profile;
  const today = context.today;
  const projects = Array.isArray(context.projects) ? context.projects : [];
  const salespeople = Array.isArray(context.salespeople)
    ? context.salespeople
    : [];
  const warnings = [];
  const proposal = raw?.proposal && typeof raw.proposal === "object"
    ? raw.proposal
    : raw;
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const salespeopleById = new Map(
    salespeople.map((person) => [person.id, person]),
  );
  const projectUpdates = normalizeProjectUpdates(
    proposal?.projectUpdates,
    projectsById,
    warnings,
  );
  const dailyReportEntries = normalizeDailyEntries(
    proposal?.dailyReportEntries,
    projectsById,
    salespeopleById,
    profile,
    today,
    warnings,
  );
  if (!projectUpdates.length && !dailyReportEntries.length) {
    return {
      proposal: null,
      warnings,
      clarification: text(proposal?.clarification, 1000),
    };
  }
  return {
    proposal: {
      version: 1,
      projectUpdates,
      dailyReportEntries,
    },
    warnings,
    clarification: text(proposal?.clarification, 1000),
  };
}

function displayValue(fieldName, value) {
  if (value == null || value === "") return "未填写";
  const type = FIELD_META[fieldName]?.type;
  if (type === "amount") return `${Number(value).toLocaleString("zh-CN")} 万元`;
  if (type === "stage") return STAGE_LABELS[value] ?? value;
  if (type === "health") return HEALTH_LABELS[value] ?? value;
  return String(value);
}

export function buildProposalSummary(payload, warnings = []) {
  const lines = [];
  const updates = Array.isArray(payload?.projectUpdates)
    ? payload.projectUpdates
    : [];
  const dailyEntries = Array.isArray(payload?.dailyReportEntries)
    ? payload.dailyReportEntries
    : [];
  if (updates.length) {
    lines.push("准备更新项目：");
    updates.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.projectName}`);
      Object.entries(item.changes).forEach(([fieldName, value]) => {
        lines.push(
          `   ${FIELD_META[fieldName]?.label ?? fieldName}：${displayValue(fieldName, item.before?.[fieldName])} → ${displayValue(fieldName, value)}`,
        );
      });
    });
  }
  if (dailyEntries.length) {
    if (lines.length) lines.push("");
    lines.push("准备导入日报：");
    dailyEntries.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.reportDate} · ${item.salespersonName} · ${item.projectName}`,
      );
      lines.push(
        `   ${ACTIVITY_LABELS[item.activityType] ?? "跟进"}：${item.content}`,
      );
    });
  }
  if (warnings.length) {
    lines.push("", "未纳入本次更新：");
    warnings.slice(0, 5).forEach((warning) => lines.push(`- ${warning}`));
  }
  return lines.join("\n").slice(0, 3900);
}

export function buildProposalPreview(payload, warnings = []) {
  return [
    buildProposalSummary(payload, warnings),
    "",
    "请核对以上内容。",
    "回复“确认更新”后写入系统；回复“取消更新”放弃。本次确认24小时内有效。",
  ].join("\n");
}

export function buildAppliedReply(result) {
  if (result?.status !== "confirmed") {
    return result?.error || "本次更新未能写入，请重新描述最新情况。";
  }
  const projectCount = Number(result.projectUpdates || 0);
  const dailyCount = Number(result.dailyReportEntries || 0);
  const lines = ["更新成功。"];
  if (projectCount) lines.push(`- 已更新 ${projectCount} 个项目`);
  if (dailyCount) lines.push(`- 已导入 ${dailyCount} 条销售日报`);
  if (result.alreadyApplied) {
    lines.push("- 这条确认此前已经执行，本次没有重复写入");
  }
  lines.push("项目台账、项目活动和 AI 认知行动将读取最新数据。");
  return lines.join("\n");
}

export const proposalLabels = {
  stages: STAGE_LABELS,
  activities: ACTIVITY_LABELS,
};
