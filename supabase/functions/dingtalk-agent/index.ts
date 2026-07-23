import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.6";
import {
  buildAppliedReply,
  buildProposalPreview,
  buildProposalSummary,
  isCancelCommand,
  isConfirmCommand,
  normalizeWriteProposal,
  parseModelJson,
} from "./write-proposal.mjs";
import {
  addDays,
  buildWorkAnalysisFallback,
  chinaClockParts,
  dueReportTypes,
  isoWeekStart,
} from "./work-analysis.mjs";

const AI_MODEL = "gpt-5.6-sol";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "content-type, x-dingtalk-connector-token, x-scheduler-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
};

type AdminClient = ReturnType<typeof createClient<any>>;

type ProjectRow = {
  id: string;
  project_code: string;
  name: string;
  customer_name: string;
  amount: number | string | null;
  contract_signed_amount: number | string | null;
  stage: string;
  probability: number | null;
  owner_id: string;
  owner_name: string;
  health: string;
  priority: string;
  next_action: string | null;
  next_action_date: string | null;
  expected_close: string | null;
  risk: string | null;
  description: string | null;
  decision_chain_description: string | null;
  competitor_description: string | null;
  updated_at: string;
};

type AlertRow = {
  id: string;
  project_id: string | null;
  owner_id: string;
  level: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function safeText(value: unknown, maxLength = 2000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function chinaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
}

function daysSince(value: string | null) {
  if (!value) return 999;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 999;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

async function secureEquals(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    sha256(left),
    sha256(right),
  ]);
  let mismatch = leftHash.length ^ rightHash.length;
  for (let index = 0; index < leftHash.length; index += 1) {
    mismatch |= leftHash[index] ^ rightHash[index];
  }
  return mismatch === 0;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function projectGapLabels(project: ProjectRow) {
  const gaps: string[] = [];
  if (!Number(project.amount || 0)) gaps.push("商机金额");
  if (!project.next_action) gaps.push("下一步动作");
  if (!project.next_action_date) gaps.push("行动日期");
  if (!project.expected_close && !["won", "lost"].includes(project.stage)) {
    gaps.push("预计成交日期");
  }
  if (
    ["solution", "negotiation", "contract", "won"].includes(project.stage) &&
    !project.decision_chain_description
  ) gaps.push("决策链");
  if (
    ["contract", "won"].includes(project.stage) &&
    project.contract_signed_amount == null
  ) {
    gaps.push("合同签订金额");
  }
  return gaps;
}

function buildRuleBasedAnswer(
  displayName: string,
  dataScope: string,
  projects: ProjectRow[],
  alerts: AlertRow[],
) {
  const active = projects.filter((project) =>
    !["won", "lost"].includes(project.stage)
  );
  const overdue = active.filter((project) =>
    Boolean(project.next_action_date && project.next_action_date < chinaDate())
  );
  const missing = active
    .map((project) => ({ project, gaps: projectGapLabels(project) }))
    .filter((item) => item.gaps.length);
  const priorities = [
    ...alerts.filter((alert) => alert.status !== "已解决").slice(0, 3).map((
      alert,
    ) => alert.title),
    ...overdue.slice(0, 3).map((project) =>
      `${project.name}：${project.next_action || "补充下一步动作"}`
    ),
    ...missing.slice(0, 3).map((item) =>
      `${item.project.name}：补充${item.gaps.join("、")}`
    ),
  ].slice(0, 5);
  const pipeline = Math.round(
    active.reduce((sum, project) => sum + Number(project.amount || 0), 0),
  );
  return [
    `${displayName}，当前按“${dataScope}”读取到 ${projects.length} 个项目，进行中 ${active.length} 个，商机金额合计 ${pipeline} 万元。`,
    priorities.length
      ? `建议按这个顺序处理：\n${
        priorities.map((item, index) => `${index + 1}. ${item}`).join("\n")
      }`
      : "当前没有逾期提醒或关键字段缺口，可以继续推进已有下一步动作。",
    "你也可以继续问：今天先做什么、哪个项目风险最高、合同金额缺了哪些、某个销售或项目进展如何。",
  ].join("\n\n");
}

function compactProject(project: ProjectRow) {
  return {
    项目标识: project.id,
    项目编号: project.project_code,
    项目: project.name,
    客户: project.customer_name,
    负责人: project.owner_name,
    商机金额万元: Number(project.amount || 0),
    合同签订金额万元: project.contract_signed_amount == null
      ? null
      : Number(project.contract_signed_amount),
    阶段: project.stage,
    概率: Number(project.probability || 0),
    健康度: project.health,
    优先级: project.priority,
    下一步动作: project.next_action,
    行动日期: project.next_action_date,
    预计成交: project.expected_close,
    风险: project.risk,
    缺失字段: projectGapLabels(project),
    距上次更新天数: daysSince(project.updated_at),
    数据更新时间: project.updated_at,
  };
}

async function loadScopedContext(
  adminClient: AdminClient,
  profile: { id: string; display_name: string; role: string },
) {
  const canViewAll = ["admin", "presales"].includes(profile.role);
  let projectQuery = adminClient
    .from("project_dashboard")
    .select(
      "id,project_code,name,customer_name,amount,contract_signed_amount,stage,probability,owner_id,owner_name,health,priority,next_action,next_action_date,expected_close,risk,description,decision_chain_description,competitor_description,updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  let alertQuery = adminClient
    .from("alerts")
    .select(
      "id,project_id,owner_id,level,title,description,status,due_at,created_at",
    )
    .in("status", ["待处理", "已确认"])
    .order("created_at", { ascending: false })
    .limit(200);
  const recentStart = new Date(Date.now() - 45 * 86400000).toISOString().slice(
    0,
    10,
  );
  let dailyQuery = adminClient
    .from("daily_report_entries")
    .select(
      "project_id,salesperson_id,report_date,activity_type,content,customer_contact",
    )
    .gte("report_date", recentStart)
    .order("report_date", { ascending: false })
    .limit(300);
  let weeklyQuery = adminClient
    .from("weekly_updates")
    .select(
      "owner_id,week_start,status,last_week_summary,this_week_goal,risks,support_needed,actions,submitted_at",
    )
    .order("week_start", { ascending: false })
    .limit(100);
  let salesQuery = adminClient
    .from("profiles")
    .select("id,display_name,role")
    .eq("active", true)
    .eq("role", "sales")
    .order("display_name");
  if (!canViewAll) {
    projectQuery = projectQuery.eq("owner_id", profile.id);
    alertQuery = alertQuery.eq("owner_id", profile.id);
    dailyQuery = dailyQuery.eq("salesperson_id", profile.id);
    weeklyQuery = weeklyQuery.eq("owner_id", profile.id);
    salesQuery = salesQuery.eq("id", profile.id);
  }
  const [
    projectResult,
    alertResult,
    dailyResult,
    weeklyResult,
    salesResult,
  ] = await Promise
    .all([
      projectQuery,
      alertQuery,
      dailyQuery,
      weeklyQuery,
      salesQuery,
    ]);
  const error = projectResult.error ?? alertResult.error ?? dailyResult.error ??
    weeklyResult.error ?? salesResult.error;
  if (error) throw new Error(`实时销售数据读取失败：${error.message}`);
  return {
    projects: (projectResult.data ?? []) as ProjectRow[],
    alerts: (alertResult.data ?? []) as AlertRow[],
    dailyEntries: dailyResult.data ?? [],
    weeklyUpdates: weeklyResult.data ?? [],
    salespeople: salesResult.data ?? [],
    dataScope: canViewAll ? "全部可见数据" : "仅本人负责的数据",
  };
}

async function askSalesAgent(
  question: string,
  profile: { id: string; display_name: string; role: string },
  context: Awaited<ReturnType<typeof loadScopedContext>>,
  history: Array<Record<string, unknown>>,
  pendingProposal: Record<string, unknown> | null,
) {
  const fallback = buildRuleBasedAnswer(
    profile.display_name,
    context.dataScope,
    context.projects,
    context.alerts,
  );
  const gatewayKey = Deno.env.get("KEENROUTER_API_KEY");
  if (!gatewayKey) return { answer: fallback, proposal: null };
  const gatewayBaseUrl = (Deno.env.get("KEENROUTER_BASE_URL") ??
    "http://router.keendata.net:5343/v1").replace(/\/$/, "");
  const activeProjects = context.projects.filter((project) =>
    !["won", "lost"].includes(project.stage)
  );
  const metrics = {
    可见项目数: context.projects.length,
    进行中项目数: activeProjects.length,
    商机总额万元: Math.round(
      context.projects.reduce(
        (sum, project) => sum + Number(project.amount || 0),
        0,
      ),
    ),
    合同签订金额万元: Math.round(
      context.projects.reduce(
        (sum, project) => sum + Number(project.contract_signed_amount || 0),
        0,
      ),
    ),
    加权管道万元: Math.round(
      context.projects.reduce(
        (sum, project) =>
          sum +
          Number(project.amount || 0) * Number(project.probability || 0) / 100,
        0,
      ),
    ),
    待处理提醒数: context.alerts.length,
    缺数据项目数:
      context.projects.filter((project) => projectGapLabels(project).length)
        .length,
  };
  const modelContext = {
    当前用户: {
      账号标识: profile.id,
      姓名: profile.display_name,
      角色: profile.role,
      数据范围: context.dataScope,
    },
    中国时区今天: chinaDate(),
    销售目录: context.salespeople,
    指标: metrics,
    项目: context.projects.slice(0, 120).map(compactProject),
    待处理提醒: context.alerts.slice(0, 40).map((alert) => ({
      级别: alert.level,
      标题: alert.title,
      说明: alert.description,
      截止时间: alert.due_at,
    })),
    近45天客户行动: context.dailyEntries.slice(0, 80),
    周更新: context.weeklyUpdates.slice(0, 30),
    当前待确认更新: pendingProposal?.payload ?? null,
  };
  try {
    const response = await fetchWithTimeout(
      `${gatewayBaseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gatewayKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL,
          store: false,
          reasoning_effort: "low",
          max_completion_tokens: 6000,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "你是科杰科技销售 Agent（By Keenclaw），工作入口是钉钉。",
                "只能依据提供的实时数据回答，不得虚构项目、金额、人员、日期或客户情况。",
                "严格遵守数据范围：销售只能看本人数据；管理员和售前才可分析全局或具体销售。",
                "回答要把“数据发现 → 判断 → 下一步行动”连起来，优先给出今天能执行、可核验的动作。",
                "发现合同阶段/赢单项目缺合同签订金额，或缺下一步动作、行动日期、预计成交日期、决策链时，要明确提醒补齐。",
                "如果用户只是在提问或分析，proposal 中两个数组都返回空数组。",
                "如果用户明确陈述已经发生的项目事实、要求更新字段，或汇报当天工作，生成待确认 proposal；不得声称已经写入。",
                "项目更新只能使用实时项目里的项目标识；只提取用户明确说出的事实，不得自行推断金额、阶段、日期、风险或合同金额。",
                "每个独立拜访、会议、电话、方案交流、任务推进拆成一条 dailyReportEntries。",
                "销售账号只能生成本人的日报，并且只能作用于本人项目。",
                "管理员可按日期一次代录多名销售日报；必须根据销售目录匹配 salespersonId，根据项目名称、编号、客户和负责人匹配 projectId。",
                "售前账号不能生成日报代录，但可以按权限分析和提出项目更新。",
                "日期使用 YYYY-MM-DD；相对日期以实时数据中的中国时区今天为准。日报日期只能是今天或过去31天。",
                "项目或销售无法唯一匹配时不得猜测：不要生成对应写入项，并在 clarification 中提出一个简短问题。",
                "如果用户是在修改当前待确认更新，返回修改后的完整替代 proposal。",
                "answer 适合钉钉阅读，控制在600字以内，不输出表格。",
                "只返回 JSON，不要 Markdown 代码块。结构必须是：",
                '{"answer":"分析回答或简短说明","proposal":{"projectUpdates":[{"projectId":"实时项目UUID","projectName":"项目名","changes":{"amount":1000,"contract_signed_amount":800,"stage":"solution","health":"yellow","priority":"P1","next_action":"提交方案","next_action_date":"YYYY-MM-DD","expected_close":"YYYY-MM-DD","risk":"明确事实","description":"明确事实","decision_chain_description":"明确事实","competitor_description":"明确事实"},"activityContent":"本次更新摘要"}],"dailyReportEntries":[{"salespersonId":"销售UUID","salespersonName":"销售姓名","projectId":"项目UUID","projectName":"项目名","reportDate":"YYYY-MM-DD","activityType":"call|meeting|visit|proposal|task|note","content":"事实描述","customerContact":"明确出现的客户联系人或空"}],"clarification":"无法可靠匹配时的问题或空"}}',
                "changes 只保留用户明确要求且确实发生变化的字段；没有内容的数组返回 []。",
              ].join("\n"),
            },
            ...history.slice(-6).map((item) => ({
              role: item.role === "assistant" ? "assistant" : "user",
              content: safeText(item.content, 1200),
            })),
            {
              role: "user",
              content: `用户问题：${question}\n\n实时数据：${
                JSON.stringify(modelContext)
              }`,
            },
          ],
        }),
      },
      50000,
    );
    if (!response.ok) {
      return {
        answer:
          `${fallback}\n\n（本次 AI 增强暂不可用，未生成任何待写入数据。）`,
        proposal: null,
      };
    }
    const payload = await response.json();
    const parsed = parseModelJson(
      payload?.choices?.[0]?.message?.content ?? payload?.output_text,
    );
    return {
      answer: safeText(parsed?.answer, 5000) || fallback,
      proposal: parsed?.proposal ?? null,
    };
  } catch {
    return {
      answer:
        `${fallback}\n\n（本次 AI 增强响应超时，未生成任何待写入数据。）`,
      proposal: null,
    };
  }
}

async function loadOrCreateBinding(
  adminClient: AdminClient,
  staffId: string,
  senderNick: string,
  robotCode: string,
) {
  const { data: existing, error: findError } = await adminClient
    .from("dingtalk_user_bindings")
    .select("id,staff_id,profile_id,status,sender_nick,robot_code")
    .eq("staff_id", staffId)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) {
    const { data, error } = await adminClient
      .from("dingtalk_user_bindings")
      .update({
        sender_nick: senderNick || existing.sender_nick,
        robot_code: robotCode || existing.robot_code,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id,staff_id,profile_id,status,sender_nick,robot_code")
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await adminClient
    .from("dingtalk_user_bindings")
    .insert({
      staff_id: staffId,
      sender_nick: senderNick,
      robot_code: robotCode || null,
      status: "pending",
    })
    .select("id,staff_id,profile_id,status,sender_nick,robot_code")
    .single();
  if (error) throw error;
  return data;
}

async function claimBindingIntent(
  adminClient: AdminClient,
  binding: Record<string, any>,
  senderNick: string,
) {
  if (
    binding.status === "active" ||
    binding.profile_id ||
    !senderNick
  ) {
    return binding;
  }
  const now = new Date().toISOString();
  const { data: intents, error: intentError } = await adminClient
    .from("dingtalk_binding_intents")
    .select("id,profile_id,expected_sender_nick,created_by")
    .eq("status", "pending")
    .eq("expected_sender_nick", senderNick)
    .gt("expires_at", now)
    .limit(2);
  if (intentError) throw intentError;
  if (intents?.length !== 1) return binding;
  const intent = intents[0];
  const { data: activated, error: bindingError } = await adminClient
    .from("dingtalk_user_bindings")
    .update({
      profile_id: intent.profile_id,
      status: "active",
      bound_at: now,
      bound_by: intent.created_by,
      last_seen_at: now,
    })
    .eq("id", binding.id)
    .eq("status", "pending")
    .is("profile_id", null)
    .select("id,staff_id,profile_id,status,sender_nick,robot_code")
    .maybeSingle();
  if (bindingError) throw bindingError;
  if (!activated) return binding;
  const { error: claimError } = await adminClient
    .from("dingtalk_binding_intents")
    .update({
      status: "claimed",
      claimed_staff_id: binding.staff_id,
      claimed_at: now,
    })
    .eq("id", intent.id)
    .eq("status", "pending");
  if (claimError) throw claimError;
  return activated;
}

async function saveConversation(
  adminClient: AdminClient,
  conversationId: string,
  staffId: string,
  history: Array<Record<string, unknown>>,
) {
  const trimmed = history.slice(-8).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: safeText(item.content, 1600),
    at: item.at ?? new Date().toISOString(),
  }));
  const { error } = await adminClient.from("dingtalk_conversations").upsert({
    conversation_id: conversationId,
    staff_id: staffId,
    history: trimmed,
    last_message_at: new Date().toISOString(),
  }, { onConflict: "conversation_id,staff_id" });
  if (error) throw error;
}

async function loadPendingWriteProposal(
  adminClient: AdminClient,
  staffId: string,
  conversationId: string,
) {
  const now = new Date().toISOString();
  const { error: expiryError } = await adminClient
    .from("dingtalk_write_proposals")
    .update({ status: "expired", error_message: "超过24小时未确认" })
    .eq("staff_id", staffId)
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .lte("expires_at", now);
  if (expiryError) throw expiryError;
  const { data, error } = await adminClient
    .from("dingtalk_write_proposals")
    .select("id,payload,summary,status,expires_at,created_at")
    .eq("staff_id", staffId)
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveWriteProposal(
  adminClient: AdminClient,
  input: {
    staffId: string;
    profileId: string;
    conversationId: string;
    messageId: string;
    originalText: string;
    summary: string;
    payload: Record<string, unknown>;
  },
) {
  const { data, error } = await adminClient
    .from("dingtalk_write_proposals")
    .insert({
      staff_id: input.staffId,
      profile_id: input.profileId,
      conversation_id: input.conversationId,
      source_message_id: input.messageId,
      original_text: input.originalText,
      summary: input.summary,
      payload: input.payload,
      status: "pending",
      model: AI_MODEL,
    })
    .select("id,payload,summary,status,expires_at,created_at")
    .single();
  if (error) throw error;

  const { error: supersedeError } = await adminClient
    .from("dingtalk_write_proposals")
    .update({ status: "superseded", error_message: "已由更新后的对话方案替代" })
    .eq("staff_id", input.staffId)
    .eq("conversation_id", input.conversationId)
    .eq("status", "pending")
    .neq("id", data.id);
  if (supersedeError) throw supersedeError;
  return data;
}

async function completeMessage(
  adminClient: AdminClient,
  input: {
    messageId: string;
    staffId: string;
    conversationId: string;
    profileId: string;
    answer: string;
  },
) {
  const finishedAt = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("dingtalk_message_log")
    .update({
      profile_id: input.profileId,
      status: "completed",
      completed_at: finishedAt,
    })
    .eq("message_key", input.messageId);
  if (updateError) throw updateError;
  const { error: replyError } = await adminClient
    .from("dingtalk_message_log")
    .insert({
      message_key: `${input.messageId}:reply`,
      staff_id: input.staffId,
      conversation_id: input.conversationId,
      profile_id: input.profileId,
      direction: "outbound",
      content: input.answer,
      status: "sent",
      completed_at: finishedAt,
    });
  if (replyError) throw replyError;
}

async function handleMessage(
  adminClient: AdminClient,
  body: Record<string, unknown>,
) {
  const staffId = safeText(body.staffId, 128);
  const senderNick = safeText(body.senderNick, 80);
  const robotCode = safeText(body.robotCode, 128);
  const messageId = safeText(body.messageId, 256);
  const question = safeText(body.question, 12000);
  const conversationId = safeText(body.conversationId, 256) ||
    `direct:${staffId}`;
  if (!staffId || !messageId || !question) {
    return jsonResponse({ error: "缺少 staffId、messageId 或 question" }, 400);
  }

  const { error: logError } = await adminClient.from("dingtalk_message_log")
    .insert({
      message_key: messageId,
      staff_id: staffId,
      conversation_id: conversationId,
      direction: "inbound",
      content: question,
      status: "processing",
    });
  if (logError?.code === "23505") {
    const { data: previousReply } = await adminClient
      .from("dingtalk_message_log")
      .select("content,status")
      .eq("message_key", `${messageId}:reply`)
      .maybeSingle();
    if (previousReply?.content) {
      return jsonResponse({
        answer: previousReply.content,
        duplicate: true,
        status: previousReply.status,
      });
    }
    return jsonResponse({
      answer: "这条消息正在处理中，请稍候，不需要重复发送。",
      duplicate: true,
    });
  }
  if (logError) throw logError;

  try {
    let binding = await loadOrCreateBinding(
      adminClient,
      staffId,
      senderNick,
      robotCode,
    );
    binding = await claimBindingIntent(adminClient, binding, senderNick);
    if (binding.status !== "active" || !binding.profile_id) {
      const answer = [
        `你好，${
          senderNick || "同事"
        }。机器人已经识别到你的钉钉身份，但尚未与销售系统账号绑定。`,
        "请让管理员进入“系统管理 → 钉钉身份”，选择你的销售系统账号并确认绑定。",
        `识别码：${staffId}`,
        "绑定完成后直接再发一次问题即可；在此之前不会读取任何销售数据。",
      ].join("\n");
      await adminClient.from("dingtalk_message_log").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("message_key", messageId);
      await adminClient.from("dingtalk_message_log").insert({
        message_key: `${messageId}:reply`,
        staff_id: staffId,
        conversation_id: conversationId,
        direction: "outbound",
        content: answer,
        status: "sent",
        completed_at: new Date().toISOString(),
      });
      return jsonResponse({
        answer,
        code: "binding_required",
        bindingStatus: binding.status,
      });
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,display_name,role,active")
      .eq("id", binding.profile_id)
      .single();
    if (profileError || !profile?.active) {
      const answer =
        "你的销售系统账号不存在或已停用，请联系管理员检查账号状态。";
      await adminClient.from("dingtalk_message_log").update({
        status: "failed",
        error_message: answer,
        completed_at: new Date().toISOString(),
      }).eq("message_key", messageId);
      return jsonResponse({ answer, code: "profile_inactive" }, 403);
    }

    const { data: conversation } = await adminClient
      .from("dingtalk_conversations")
      .select("history")
      .eq("conversation_id", conversationId)
      .eq("staff_id", staffId)
      .maybeSingle();
    const history = array(conversation?.history) as Array<
      Record<string, unknown>
    >;
    const pendingProposal = await loadPendingWriteProposal(
      adminClient,
      staffId,
      conversationId,
    );

    if (isConfirmCommand(question)) {
      let answer = "当前没有等待确认的更新。请先告诉我项目进展或要导入的日报。";
      let writeResult: Record<string, unknown> | null = null;
      if (pendingProposal) {
        const { data, error } = await adminClient.rpc(
          "apply_dingtalk_write_proposal",
          {
            proposal_uuid: pendingProposal.id,
            caller_staff_id: staffId,
            confirmation_message: messageId,
          },
        );
        if (error) throw error;
        writeResult = data as Record<string, unknown>;
        answer = buildAppliedReply(writeResult);
      }
      await saveConversation(adminClient, conversationId, staffId, [
        ...history,
        { role: "user", content: question, at: new Date().toISOString() },
        { role: "assistant", content: answer, at: new Date().toISOString() },
      ]);
      await completeMessage(adminClient, {
        messageId,
        staffId,
        conversationId,
        profileId: profile.id,
        answer,
      });
      return jsonResponse({
        answer,
        code: writeResult?.status === "confirmed"
          ? "write_confirmed"
          : "no_pending_write",
        writeResult,
      });
    }

    if (isCancelCommand(question)) {
      const answer = pendingProposal
        ? "已取消这次待确认更新，项目和日报均未发生变化。"
        : "当前没有等待确认的更新。";
      if (pendingProposal) {
        const { error } = await adminClient
          .from("dingtalk_write_proposals")
          .update({ status: "cancelled", error_message: "用户通过钉钉取消" })
          .eq("id", pendingProposal.id)
          .eq("status", "pending");
        if (error) throw error;
      }
      await saveConversation(adminClient, conversationId, staffId, [
        ...history,
        { role: "user", content: question, at: new Date().toISOString() },
        { role: "assistant", content: answer, at: new Date().toISOString() },
      ]);
      await completeMessage(adminClient, {
        messageId,
        staffId,
        conversationId,
        profileId: profile.id,
        answer,
      });
      return jsonResponse({ answer, code: "write_cancelled" });
    }

    const context = await loadScopedContext(adminClient, profile);
    const agentResult = await askSalesAgent(
      question,
      profile,
      context,
      history,
      pendingProposal,
    );
    const normalized = normalizeWriteProposal(agentResult.proposal, {
      profile,
      projects: context.projects,
      salespeople: context.salespeople,
      today: chinaDate(),
    });
    let answer = agentResult.answer;
    let proposalId: string | null = null;
    if (normalized.proposal) {
      const summary = buildProposalSummary(
        normalized.proposal,
        normalized.warnings,
      );
      const savedProposal = await saveWriteProposal(adminClient, {
        staffId,
        profileId: profile.id,
        conversationId,
        messageId,
        originalText: question,
        summary,
        payload: normalized.proposal,
      });
      proposalId = savedProposal.id;
      answer = buildProposalPreview(
        normalized.proposal,
        normalized.warnings,
      );
      if (normalized.clarification) {
        answer = `${answer}\n\n还需要你补充：${normalized.clarification}`;
      }
    } else {
      const notices = [
        ...normalized.warnings,
        normalized.clarification,
      ].filter(Boolean);
      if (notices.length) {
        answer = `${answer}\n\n需要补充：${notices.slice(0, 5).join("；")}`;
      }
    }
    await saveConversation(adminClient, conversationId, staffId, [
      ...history,
      { role: "user", content: question, at: new Date().toISOString() },
      { role: "assistant", content: answer, at: new Date().toISOString() },
    ]);
    await completeMessage(adminClient, {
      messageId,
      staffId,
      conversationId,
      profileId: profile.id,
      answer,
    });
    return jsonResponse({
      answer,
      code: proposalId ? "write_confirmation_required" : "ok",
      proposalId,
      dataScope: context.dataScope,
      profile: { displayName: profile.display_name, role: profile.role },
    });
  } catch (error) {
    await adminClient.from("dingtalk_message_log").update({
      status: "failed",
      error_message: safeText(
        error instanceof Error ? error.message : "钉钉销售 Agent 处理失败",
        1000,
      ),
      completed_at: new Date().toISOString(),
    }).eq("message_key", messageId);
    throw error;
  }
}

function buildDigest(
  displayName: string,
  projects: ProjectRow[],
  alerts: AlertRow[],
) {
  const items: string[] = [];
  alerts
    .filter((alert) => alert.status !== "已解决")
    .sort((left, right) =>
      ({ red: 0, yellow: 1, info: 2 }[left.level] ?? 3) -
      ({ red: 0, yellow: 1, info: 2 }[right.level] ?? 3)
    )
    .slice(0, 4)
    .forEach((alert) =>
      items.push(
        `处理提醒：${alert.title}${
          alert.description ? `（${alert.description}）` : ""
        }`,
      )
    );
  projects
    .filter((project) => project.stage !== "lost")
    .map((project) => ({ project, gaps: projectGapLabels(project) }))
    .filter((item) => item.gaps.length)
    .slice(0, 4)
    .forEach((item) =>
      items.push(`${item.project.name}：补充${item.gaps.join("、")}`)
    );
  if (!items.length) return null;
  return {
    title: "AI 认知行动 · 今日待办",
    content: [
      `${displayName}，Sales Agent 根据最新销售数据为你整理了今天的优先行动：`,
      ...items.slice(0, 6).map((item, index) => `${index + 1}. ${item}`),
      "",
      "完成后可直接回复机器人说明进展；涉及项目数据写回时，Agent 会先请你确认。",
    ].join("\n"),
  };
}

async function prepareDailyDigests(adminClient: AdminClient) {
  const { data: bindings, error: bindingError } = await adminClient
    .from("dingtalk_user_bindings")
    .select("profile_id,staff_id,robot_code")
    .eq("status", "active")
    .not("profile_id", "is", null)
    .not("robot_code", "is", null);
  if (bindingError) throw bindingError;
  if (!bindings?.length) return 0;
  const profileIds = bindings.map((binding) => binding.profile_id);
  const [
    { data: profiles, error: profilesError },
    { data: projects, error: projectsError },
    { data: alerts, error: alertsError },
  ] = await Promise.all([
    adminClient.from("profiles").select("id,display_name,role,active").in(
      "id",
      profileIds,
    ).eq("active", true),
    adminClient.from("project_dashboard").select(
      "id,name,customer_name,amount,contract_signed_amount,stage,probability,owner_id,owner_name,health,priority,next_action,next_action_date,expected_close,risk,description,decision_chain_description,competitor_description,updated_at",
    ).limit(5000),
    adminClient.from("alerts").select(
      "id,project_id,owner_id,level,title,description,status,due_at,created_at",
    ).in("status", ["待处理", "已确认"]).limit(2000),
  ]);
  const readError = profilesError ?? projectsError ?? alertsError;
  if (readError) throw readError;
  const today = chinaDate();
  const rows = bindings.flatMap((binding) => {
    const profile = profiles?.find((item) => item.id === binding.profile_id);
    if (!profile) return [];
    const canViewAll = ["admin", "presales"].includes(profile.role);
    const scopedProjects = (projects ?? []).filter((project) =>
      canViewAll || project.owner_id === profile.id
    ) as ProjectRow[];
    const scopedAlerts = (alerts ?? []).filter((alert) =>
      canViewAll || alert.owner_id === profile.id
    ) as AlertRow[];
    const digest = buildDigest(
      profile.display_name,
      scopedProjects,
      scopedAlerts,
    );
    if (!digest) return [];
    return [{
      profile_id: profile.id,
      staff_id: binding.staff_id,
      robot_code: binding.robot_code,
      notification_type: "action_digest",
      title: digest.title,
      content: digest.content,
      dedupe_key: `action-digest:${today}:${profile.id}`,
      status: "pending",
    }];
  });
  if (!rows.length) return 0;
  const { error } = await adminClient
    .from("dingtalk_notification_outbox")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

function chinaMidnightIso(dateText: string) {
  return new Date(`${dateText}T00:00:00+08:00`).toISOString();
}

async function loadWorkAnalysisContext(
  adminClient: AdminClient,
  reportType: "daily" | "weekly",
) {
  const clock = chinaClockParts();
  const weekStart = isoWeekStart(clock.date, clock.isoWeekday);
  const queryStart = reportType === "weekly"
    ? addDays(weekStart, -7)
    : addDays(clock.date, -6);
  const queryEndExclusive = addDays(clock.date, 1);
  const [
    dailyResult,
    activityResult,
    projectResult,
    profileResult,
    weeklyResult,
  ] = await Promise.all([
    adminClient.from("daily_report_entries").select(
      "project_id,salesperson_id,report_date,activity_type,content,customer_contact",
    ).gte("report_date", queryStart).lte("report_date", clock.date)
      .order("report_date", { ascending: false }).limit(500),
    adminClient.from("project_activities").select(
      "project_id,activity_type,content,occurred_at,created_by,next_action,next_action_date,daily_report_entry_id",
    ).gte("occurred_at", chinaMidnightIso(queryStart))
      .lt("occurred_at", chinaMidnightIso(queryEndExclusive))
      .order("occurred_at", { ascending: false }).limit(500),
    adminClient.from("project_dashboard").select(
      "id,name,owner_id,owner_name,stage,health,priority,next_action,next_action_date,expected_close,risk,amount,contract_signed_amount,probability,updated_at",
    ).limit(5000),
    adminClient.from("profiles").select("id,display_name,role,active")
      .eq("active", true).order("display_name"),
    adminClient.from("weekly_updates").select(
      "owner_id,week_start,status,last_week_summary,this_week_goal,risks,support_needed,actions,submitted_at",
    ).gte("week_start", weekStart).order("week_start", { ascending: false })
      .limit(200),
  ]);
  const readError = dailyResult.error ?? activityResult.error ??
    projectResult.error ?? profileResult.error ?? weeklyResult.error;
  if (readError) {
    throw new Error(`工作分析数据读取失败：${readError.message}`);
  }
  const projects = projectResult.data ?? [];
  const projectById = new Map(
    projects.map((project: Record<string, any>) => [project.id, project]),
  );
  const dailyEntries = (dailyResult.data ?? []).map((
    entry: Record<string, any>,
  ) => ({
    salesperson_id: entry.salesperson_id,
    project_id: entry.project_id,
    work_date: entry.report_date,
    activity_type: entry.activity_type,
    content: safeText(entry.content, 600),
    customer_contact: safeText(entry.customer_contact, 120) || null,
    source: "daily_report",
  }));
  const activityEntries = (activityResult.data ?? [])
    .filter((activity: Record<string, any>) =>
      !activity.daily_report_entry_id
    )
    .map((activity: Record<string, any>) => ({
      salesperson_id: projectById.get(activity.project_id)?.owner_id ??
        activity.created_by,
      project_id: activity.project_id,
      work_date: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
      }).format(new Date(activity.occurred_at)),
      activity_type: activity.activity_type,
      content: safeText(activity.content, 600),
      customer_contact: null,
      source: "project_activity",
    }));
  const allEntries = [...dailyEntries, ...activityEntries].sort((left, right) =>
    String(right.work_date).localeCompare(String(left.work_date))
  );
  const currentPeriodEntries = reportType === "weekly"
    ? allEntries.filter((entry) => entry.work_date >= weekStart)
    : allEntries.filter((entry) => entry.work_date === clock.date);
  const analysisEntries = currentPeriodEntries.length
    ? currentPeriodEntries
    : allEntries;
  const touchedProjectIds = new Set(
    analysisEntries.map((entry) => entry.project_id),
  );
  const focusProjects = projects
    .filter((project: Record<string, any>) =>
      touchedProjectIds.has(project.id)
    )
    .slice(0, 120);
  const usedRecentWork = !currentPeriodEntries.length && allEntries.length > 0;
  return {
    clock,
    weekStart,
    periodLabel: reportType === "weekly"
      ? `${usedRecentWork ? queryStart : weekStart}—${clock.date}`
      : clock.date,
    analysisEntries: analysisEntries.slice(0, 150),
    currentPeriodEntryCount: currentPeriodEntries.length,
    usedRecentWork,
    projects: focusProjects,
    salespeople: (profileResult.data ?? []).filter((
      profile: Record<string, any>,
    ) => profile.role === "sales"),
    weeklyUpdates: weeklyResult.data ?? [],
  };
}

async function generateWorkAnalysis(
  adminClient: AdminClient,
  profile: { id: string; display_name: string; role: string },
  reportType: "daily" | "weekly",
) {
  const context = await loadWorkAnalysisContext(adminClient, reportType);
  const fallback = buildWorkAnalysisFallback({
    displayName: profile.display_name,
    reportType,
    periodLabel: context.periodLabel,
    entries: context.analysisEntries,
    projects: context.projects,
    salespeople: context.salespeople,
  });
  const gatewayKey = Deno.env.get("KEENROUTER_API_KEY");
  if (!gatewayKey) return { ...fallback, context };
  const gatewayBaseUrl = (Deno.env.get("KEENROUTER_BASE_URL") ??
    "http://router.keendata.net:5343/v1").replace(/\/$/, "");
  const reportName = reportType === "weekly" ? "领导工作周报" : "领导工作日报";
  try {
    const response = await fetchWithTimeout(
      `${gatewayBaseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gatewayKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL,
          store: false,
          reasoning_effort: "low",
          max_completion_tokens: 2200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                `你是科杰科技销售管理 Agent，现在为公司领导生成${reportName}。`,
                "核心任务是分析销售团队做了什么、工作产生了什么推进、管理者下一步应该推动什么。",
                "只依据输入的真实工作记录和项目状态，不虚构客户反馈、金额、日期或结论。",
                "不要讨论数据缺陷、数据完整性、字段缺失、录入质量、未填报或系统问题。",
                "如果当期动作较少，直接从近期真实动作中判断工作趋势和下一步，不解释为什么记录少，也不要写“未看到、没有记录、无法判断、暂不能判断”。",
                "不得输出补字段、补金额、补日期、补录数据之类的行动。",
                "把事实、判断、管理动作串联起来，突出具体销售、具体项目和可执行动作。",
                reportType === "weekly"
                  ? "周报包含：本周管理结论、销售工作分析、有效推进与不足、下周管理动作。"
                  : "日报包含：管理结论、工作推进分析、关键判断、明日管理动作。",
                "适合钉钉 Markdown 阅读，不使用表格，控制在900个汉字以内。",
                '只返回 JSON：{"title":"简短标题","content":"完整 Markdown 正文"}。',
              ].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify({
                接收领导: profile.display_name,
                报告类型: reportName,
                报告周期: context.periodLabel,
                当期工作动作数: context.currentPeriodEntryCount,
                分析使用近期工作趋势: context.usedRecentWork,
                工作动作: context.analysisEntries,
                相关项目: context.projects,
                销售人员: context.salespeople,
                本周更新: context.weeklyUpdates,
              }),
            },
          ],
        }),
      },
      50000,
    );
    if (!response.ok) return { ...fallback, context };
    const payload = await response.json();
    const parsed = parseModelJson(
      payload?.choices?.[0]?.message?.content ?? payload?.output_text,
    );
    const title = safeText(parsed?.title, 120);
    const content = safeText(parsed?.content, 8000);
    if (
      !title ||
      !content ||
      /(数据缺失|数据不完整|缺数据|字段缺失|未录入|未填报|录入质量|补录|补充字段|未看到|没有可归因|没有可确认|无法判断|暂不能|未形成可确认)/.test(
        content,
      )
    ) {
      return { ...fallback, context };
    }
    return { title, content, context };
  } catch {
    return { ...fallback, context };
  }
}

function scheduledDedupeKey(
  reportType: "daily" | "weekly",
  profileId: string,
  clock: ReturnType<typeof chinaClockParts>,
) {
  const period = reportType === "weekly"
    ? isoWeekStart(clock.date, clock.isoWeekday)
    : clock.date;
  return `work-${reportType}:${period}:${profileId}`;
}

async function prepareScheduledWorkReports(adminClient: AdminClient) {
  const { data: preferences, error: preferenceError } = await adminClient
    .from("dingtalk_notification_preferences")
    .select(
      "profile_id,daily_enabled,daily_time,weekly_enabled,weekly_day,weekly_time,content_mode,delivery_mode",
    )
    .eq("content_mode", "work_analysis")
    .eq("delivery_mode", "cloud_direct");
  if (preferenceError) throw preferenceError;
  if (!preferences?.length) return 0;
  const profileIds = preferences.map((preference) => preference.profile_id);
  const [{ data: profiles, error: profileError }, {
    data: bindings,
    error: bindingError,
  }] = await Promise.all([
    adminClient.from("profiles").select("id,display_name,role,active")
      .in("id", profileIds).eq("active", true),
    adminClient.from("dingtalk_user_bindings")
      .select("profile_id,staff_id,robot_code,status")
      .in("profile_id", profileIds).eq("status", "active")
      .not("robot_code", "is", null),
  ]);
  const readError = profileError ?? bindingError;
  if (readError) throw readError;
  const clock = chinaClockParts();
  const candidates = preferences.flatMap((preference) => {
    const profile = profiles?.find((item) =>
      item.id === preference.profile_id
    );
    const binding = bindings?.find((item) =>
      item.profile_id === preference.profile_id
    );
    if (!profile || !binding) return [];
    return dueReportTypes(preference, clock).map((reportType) => ({
      profile,
      binding,
      reportType: reportType as "daily" | "weekly",
      dedupeKey: scheduledDedupeKey(
        reportType as "daily" | "weekly",
        profile.id,
        clock,
      ),
    }));
  });
  if (!candidates.length) return 0;
  const { data: existing, error: existingError } = await adminClient
    .from("dingtalk_notification_outbox")
    .select("dedupe_key")
    .in("dedupe_key", candidates.map((candidate) => candidate.dedupeKey));
  if (existingError) throw existingError;
  const existingKeys = new Set(
    (existing ?? []).map((item) => item.dedupe_key),
  );
  let prepared = 0;
  for (const candidate of candidates) {
    if (existingKeys.has(candidate.dedupeKey)) continue;
    const report = await generateWorkAnalysis(
      adminClient,
      candidate.profile,
      candidate.reportType,
    );
    const { error } = await adminClient
      .from("dingtalk_notification_outbox")
      .insert({
        profile_id: candidate.profile.id,
        staff_id: candidate.binding.staff_id,
        robot_code: candidate.binding.robot_code,
        notification_type: candidate.reportType === "weekly"
          ? "weekly_work_analysis"
          : "daily_work_analysis",
        title: report.title,
        content: report.content,
        dedupe_key: candidate.dedupeKey,
        status: "pending",
      });
    if (error?.code !== "23505") {
      if (error) throw error;
      prepared += 1;
    }
  }
  return prepared;
}

async function getDingTalkAccessToken() {
  const appKey = Deno.env.get("DINGTALK_CLIENT_ID") ?? "";
  const appSecret = Deno.env.get("DINGTALK_CLIENT_SECRET") ?? "";
  if (!appKey || !appSecret) {
    throw new Error("钉钉云端直发凭证未配置");
  }
  const response = await fetchWithTimeout(
    "https://api.dingtalk.com/v1.0/oauth2/accessToken",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey, appSecret }),
    },
    15000,
  );
  const payload = await response.json();
  if (!response.ok || !payload?.accessToken) {
    throw new Error(
      `钉钉访问令牌获取失败：${
        safeText(payload?.message ?? payload?.code, 300) || response.status
      }`,
    );
  }
  return payload.accessToken as string;
}

async function sendScheduledDingTalkNotification(
  accessToken: string,
  notification: Record<string, any>,
) {
  const response = await fetchWithTimeout(
    "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify({
        robotCode: notification.robot_code,
        userIds: [notification.staff_id],
        msgKey: "sampleMarkdown",
        msgParam: JSON.stringify({
          title: notification.title,
          text: notification.content,
        }),
      }),
    },
    15000,
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `钉钉主动通知失败：${
        safeText(payload?.message ?? payload?.code, 300) || response.status
      }`,
    );
  }
  if (array(payload?.invalidStaffIdList).length) {
    throw new Error("钉钉主动通知失败：staffId 无效");
  }
  if (array(payload?.flowControlledStaffIdList).length) {
    throw new Error("钉钉主动通知被限流");
  }
}

async function dispatchScheduledWorkReports(adminClient: AdminClient) {
  const prepared = await prepareScheduledWorkReports(adminClient);
  const scheduledTypes = [
    "daily_work_analysis",
    "weekly_work_analysis",
  ];
  const staleThreshold = new Date(Date.now() - 10 * 60000).toISOString();
  await adminClient
    .from("dingtalk_notification_outbox")
    .update({ status: "pending", claimed_at: null })
    .in("notification_type", scheduledTypes)
    .eq("status", "sending")
    .lt("claimed_at", staleThreshold)
    .lt("attempt_count", 3);
  const { data: pending, error: pendingError } = await adminClient
    .from("dingtalk_notification_outbox")
    .select(
      "id,staff_id,robot_code,notification_type,title,content,attempt_count",
    )
    .in("notification_type", scheduledTypes)
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (pendingError) throw pendingError;
  if (!pending?.length) return { prepared, sent: 0, failed: 0 };
  const { data: claimed, error: claimError } = await adminClient
    .from("dingtalk_notification_outbox")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .in("id", pending.map((item) => item.id))
    .eq("status", "pending")
    .select(
      "id,staff_id,robot_code,notification_type,title,content,attempt_count",
    );
  if (claimError) throw claimError;
  if (!claimed?.length) return { prepared, sent: 0, failed: 0 };
  const accessToken = await getDingTalkAccessToken();
  let sent = 0;
  let failed = 0;
  for (const notification of claimed) {
    try {
      await sendScheduledDingTalkNotification(accessToken, notification);
      const { error } = await adminClient
        .from("dingtalk_notification_outbox")
        .update({
          status: "sent",
          attempt_count: Number(notification.attempt_count ?? 0) + 1,
          sent_at: new Date().toISOString(),
          claimed_at: null,
          last_error: null,
        })
        .eq("id", notification.id);
      if (error) throw error;
      sent += 1;
    } catch (error) {
      const attemptCount = Number(notification.attempt_count ?? 0) + 1;
      const retryable = attemptCount < 3;
      await adminClient
        .from("dingtalk_notification_outbox")
        .update({
          status: retryable ? "pending" : "failed",
          attempt_count: attemptCount,
          claimed_at: null,
          available_at: retryable
            ? new Date(Date.now() + attemptCount * 60000).toISOString()
            : new Date().toISOString(),
          last_error: safeText(
            error instanceof Error ? error.message : "钉钉发送失败",
            1000,
          ),
        })
        .eq("id", notification.id);
      failed += 1;
    }
  }
  return { prepared, sent, failed };
}

async function previewScheduledWorkReport(
  adminClient: AdminClient,
  body: Record<string, unknown>,
) {
  const profileId = safeText(body.profileId, 128);
  const reportType = body.reportType === "weekly" ? "weekly" : "daily";
  if (!profileId) return jsonResponse({ error: "缺少 profileId" }, 400);
  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("id,display_name,role,active")
    .eq("id", profileId)
    .eq("active", true)
    .single();
  if (error) throw error;
  const report = await generateWorkAnalysis(
    adminClient,
    profile,
    reportType,
  );
  return jsonResponse({
    title: report.title,
    content: report.content,
    reportType,
    periodLabel: report.context.periodLabel,
    analyzedActions: report.context.analysisEntries.length,
    currentPeriodActions: report.context.currentPeriodEntryCount,
    usedRecentWork: report.context.usedRecentWork,
  });
}

async function pullNotifications(
  adminClient: AdminClient,
  body: Record<string, unknown>,
) {
  if (body.prepare === true) await prepareDailyDigests(adminClient);
  const allowlist = array(body.staffAllowlist).map((item) =>
    safeText(item, 128)
  ).filter(Boolean).slice(0, 100);
  const staleThreshold = new Date(Date.now() - 10 * 60000).toISOString();
  await adminClient
    .from("dingtalk_notification_outbox")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "sending")
    .lt("claimed_at", staleThreshold)
    .lt("attempt_count", 3);
  let query = adminClient
    .from("dingtalk_notification_outbox")
    .select(
      "id,profile_id,staff_id,robot_code,notification_type,title,content,attempt_count",
    )
    .eq("status", "pending")
    .not(
      "notification_type",
      "in",
      "(daily_work_analysis,weekly_work_analysis)",
    )
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (allowlist.length) query = query.in("staff_id", allowlist);
  const { data: pending, error: pendingError } = await query;
  if (pendingError) throw pendingError;
  if (!pending?.length) return jsonResponse({ notifications: [] });
  const ids = pending.map((item) => item.id);
  const { data: claimed, error: claimError } = await adminClient
    .from("dingtalk_notification_outbox")
    .update({
      status: "sending",
      claimed_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("status", "pending")
    .select(
      "id,profile_id,staff_id,robot_code,notification_type,title,content,attempt_count",
    );
  if (claimError) throw claimError;
  return jsonResponse({ notifications: claimed ?? [] });
}

async function acknowledgeNotification(
  adminClient: AdminClient,
  body: Record<string, unknown>,
) {
  const id = safeText(body.notificationId, 128);
  if (!id) return jsonResponse({ error: "缺少 notificationId" }, 400);
  const success = body.success === true;
  const { data: current } = await adminClient
    .from("dingtalk_notification_outbox")
    .select("attempt_count")
    .eq("id", id)
    .maybeSingle();
  const attemptCount = Number(current?.attempt_count ?? 0) + 1;
  const retryable = !success && attemptCount < 3;
  const { error } = await adminClient
    .from("dingtalk_notification_outbox")
    .update({
      status: success ? "sent" : retryable ? "pending" : "failed",
      attempt_count: attemptCount,
      sent_at: success ? new Date().toISOString() : null,
      claimed_at: null,
      available_at: retryable
        ? new Date(Date.now() + attemptCount * 60000).toISOString()
        : new Date().toISOString(),
      last_error: success ? null : safeText(body.error, 1000) || "钉钉发送失败",
    })
    .eq("id", id);
  if (error) throw error;
  return jsonResponse({
    acknowledged: true,
    status: success ? "sent" : retryable ? "pending" : "failed",
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = safeText(body.action, 40) || "message";
    const schedulerAction = [
      "scheduled_reports",
      "preview_scheduled_report",
    ].includes(action);
    const expectedToken = schedulerAction
      ? Deno.env.get("DINGTALK_REPORT_SCHEDULER_TOKEN") ??
        Deno.env.get("SALES_REPORT_SCHEDULER_TOKEN") ?? ""
      : Deno.env.get("DINGTALK_CONNECTOR_TOKEN") ?? "";
    const actualToken = schedulerAction
      ? request.headers.get("x-scheduler-token") ?? ""
      : request.headers.get("x-dingtalk-connector-token") ?? "";
    if (!expectedToken || !(await secureEquals(actualToken, expectedToken))) {
      return jsonResponse({ error: "Invalid service token" }, 401);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { error: "Supabase service configuration missing" },
        503,
      );
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (action === "message") return await handleMessage(adminClient, body);
    if (action === "pull_notifications") {
      return await pullNotifications(adminClient, body);
    }
    if (action === "ack_notification") {
      return await acknowledgeNotification(adminClient, body);
    }
    if (action === "scheduled_reports") {
      return jsonResponse(await dispatchScheduledWorkReports(adminClient));
    }
    if (action === "preview_scheduled_report") {
      return await previewScheduledWorkReport(adminClient, body);
    }
    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error(
      "DingTalk agent request failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return jsonResponse({
      error: error instanceof Error
        ? error.message.slice(0, 1000)
        : "钉钉销售 Agent 处理失败",
    }, 500);
  }
});
