import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.6";

const corsHeaders = {
  "Access-Control-Allow-Headers": "content-type, x-dingtalk-connector-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
};

type AdminClient = ReturnType<typeof createClient<any>>;

type ProjectRow = {
  id: string;
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
      "id,name,customer_name,amount,contract_signed_amount,stage,probability,owner_id,owner_name,health,priority,next_action,next_action_date,expected_close,risk,description,decision_chain_description,competitor_description,updated_at",
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
  if (!canViewAll) {
    projectQuery = projectQuery.eq("owner_id", profile.id);
    alertQuery = alertQuery.eq("owner_id", profile.id);
    dailyQuery = dailyQuery.eq("salesperson_id", profile.id);
    weeklyQuery = weeklyQuery.eq("owner_id", profile.id);
  }
  const [projectResult, alertResult, dailyResult, weeklyResult] = await Promise
    .all([
      projectQuery,
      alertQuery,
      dailyQuery,
      weeklyQuery,
    ]);
  const error = projectResult.error ?? alertResult.error ?? dailyResult.error ??
    weeklyResult.error;
  if (error) throw new Error(`实时销售数据读取失败：${error.message}`);
  return {
    projects: (projectResult.data ?? []) as ProjectRow[],
    alerts: (alertResult.data ?? []) as AlertRow[],
    dailyEntries: dailyResult.data ?? [],
    weeklyUpdates: weeklyResult.data ?? [],
    dataScope: canViewAll ? "全部可见数据" : "仅本人负责的数据",
  };
}

async function askSalesAgent(
  question: string,
  profile: { id: string; display_name: string; role: string },
  context: Awaited<ReturnType<typeof loadScopedContext>>,
  history: Array<Record<string, unknown>>,
) {
  const fallback = buildRuleBasedAnswer(
    profile.display_name,
    context.dataScope,
    context.projects,
    context.alerts,
  );
  const gatewayKey = Deno.env.get("KEENROUTER_API_KEY");
  if (!gatewayKey) return fallback;
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
      姓名: profile.display_name,
      角色: profile.role,
      数据范围: context.dataScope,
    },
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
          model: "gpt-5.5",
          store: false,
          reasoning_effort: "low",
          max_completion_tokens: 1400,
          messages: [
            {
              role: "system",
              content: [
                "你是科杰科技销售 Agent（By Keenclaw），工作入口是钉钉。",
                "只能依据提供的实时数据回答，不得虚构项目、金额、人员、日期或客户情况。",
                "严格遵守数据范围：销售只能看本人数据；管理员和售前才可分析全局或具体销售。",
                "回答要把“数据发现 → 判断 → 下一步行动”连起来，优先给出今天能执行、可核验的动作。",
                "发现合同阶段/赢单项目缺合同签订金额，或缺下一步动作、行动日期、预计成交日期、决策链时，要明确提醒补齐。",
                "不要声称已经修改数据；需要写回项目的动作必须先说明待用户确认。",
                "适合钉钉阅读，控制在 600 字以内，可使用简短编号，不要输出表格。",
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
      return `${fallback}\n\n（本次 AI 增强暂不可用，以上为实时数据规则分析。）`;
    }
    const payload = await response.json();
    const answer = safeText(
      payload?.choices?.[0]?.message?.content ?? payload?.output_text,
      5000,
    );
    return answer || fallback;
  } catch {
    return `${fallback}\n\n（本次 AI 增强响应超时，以上为实时数据规则分析。）`;
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

async function handleMessage(
  adminClient: AdminClient,
  body: Record<string, unknown>,
) {
  const staffId = safeText(body.staffId, 128);
  const senderNick = safeText(body.senderNick, 80);
  const robotCode = safeText(body.robotCode, 128);
  const messageId = safeText(body.messageId, 256);
  const question = safeText(body.question, 2000);
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

  const binding = await loadOrCreateBinding(
    adminClient,
    staffId,
    senderNick,
    robotCode,
  );
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
    const answer = "你的销售系统账号不存在或已停用，请联系管理员检查账号状态。";
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
  const context = await loadScopedContext(adminClient, profile);
  const answer = await askSalesAgent(question, profile, context, history);
  await saveConversation(adminClient, conversationId, staffId, [
    ...history,
    { role: "user", content: question, at: new Date().toISOString() },
    { role: "assistant", content: answer, at: new Date().toISOString() },
  ]);
  const finishedAt = new Date().toISOString();
  await adminClient.from("dingtalk_message_log").update({
    profile_id: profile.id,
    status: "completed",
    completed_at: finishedAt,
  }).eq("message_key", messageId);
  await adminClient.from("dingtalk_message_log").insert({
    message_key: `${messageId}:reply`,
    staff_id: staffId,
    conversation_id: conversationId,
    profile_id: profile.id,
    direction: "outbound",
    content: answer,
    status: "sent",
    completed_at: finishedAt,
  });
  return jsonResponse({
    answer,
    code: "ok",
    dataScope: context.dataScope,
    profile: { displayName: profile.display_name, role: profile.role },
  });
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
  const expectedToken = Deno.env.get("DINGTALK_CONNECTOR_TOKEN") ?? "";
  const actualToken = request.headers.get("x-dingtalk-connector-token") ?? "";
  if (!expectedToken || !(await secureEquals(actualToken, expectedToken))) {
    return jsonResponse({ error: "Invalid connector token" }, 401);
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = safeText(body.action, 40) || "message";
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
