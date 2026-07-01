import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduler-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parseModelJson(value: unknown) {
  const text = String(value ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回有效 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function chinaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

function reportPeriod(reportType: "weekly" | "monthly", dateText = chinaDate()) {
  const current = new Date(`${dateText}T12:00:00+08:00`);
  if (reportType === "weekly") {
    const day = current.getUTCDay() || 7;
    const start = new Date(current);
    start.setUTCDate(current.getUTCDate() - day + 1);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function isScheduledDay(reportType: "weekly" | "monthly", dateText = chinaDate()) {
  const current = new Date(`${dateText}T12:00:00+08:00`);
  if (reportType === "weekly") return current.getUTCDay() === 0;
  const tomorrow = new Date(current);
  tomorrow.setUTCDate(current.getUTCDate() + 1);
  return tomorrow.getUTCMonth() !== current.getUTCMonth();
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function reportMarkdown(title: string, content: Record<string, unknown>) {
  const metrics = (content.metrics ?? {}) as Record<string, unknown>;
  const section = (heading: string, items: unknown, formatter: (item: Record<string, unknown>) => string) => {
    const rows = array(items) as Array<Record<string, unknown>>;
    return `## ${heading}\n${rows.length ? rows.map((item) => `- ${formatter(item)}`).join("\n") : "- 暂无记录"}`;
  };
  return [
    `# ${title}`,
    String(content.executiveSummary ?? ""),
    `## 核心指标\n- 项目数：${metrics.projectCount ?? 0}\n- 商机总额：${metrics.totalAmount ?? 0} 万元\n- 加权管道：${metrics.weightedPipeline ?? 0} 万元\n- 客户行动：${metrics.actionCount ?? 0} 次\n- 赢单：${metrics.wonCount ?? 0} 个\n- 丢单：${metrics.lostCount ?? 0} 个`,
    section("当前项目行动", content.currentActions, (item) => `**${item.projectName ?? "未命名项目"}**：${item.action ?? "未填写"}${item.owner ? `（${item.owner}）` : ""}`),
    section("项目问题", content.projectIssues, (item) => `**${item.projectName ?? "未命名项目"}**：${item.issue ?? "未填写"}${item.impact ? `；影响：${item.impact}` : ""}`),
    section("热项目", content.hotProjects, (item) => `**${item.projectName ?? "未命名项目"}**：${item.reason ?? ""}`),
    section("冷项目", content.coldProjects, (item) => `**${item.projectName ?? "未命名项目"}**：${item.reason ?? ""}`),
    `## Agent 分析\n${String(content.agentAnalysis ?? "暂无分析")}`,
    `## 下一步建议\n${array(content.nextSuggestions).map((item) => `- ${String(item)}`).join("\n") || "- 暂无建议"}`,
  ].join("\n\n");
}

async function processReport(
  reportId: string,
  requesterId: string,
  reportType: "weekly" | "monthly",
  periodStart: string,
  periodEnd: string,
  title: string,
  adminClient: ReturnType<typeof createClient>,
  gatewayBaseUrl: string,
  gatewayKey: string,
) {
  try {
    await adminClient.from("sales_reports").update({ status: "processing", started_at: new Date().toISOString(), error_message: null }).eq("id", reportId);
    const { data: profile, error: profileError } = await adminClient.from("profiles").select("id,display_name,role").eq("id", requesterId).single();
    if (profileError || !profile) throw new Error(`报告用户读取失败：${profileError?.message ?? "用户不存在"}`);
    const canViewAll = ["admin", "presales"].includes(profile.role);

    let projectQuery = adminClient.from("project_dashboard").select("id,name,customer_name,amount,stage,probability,owner_id,owner_name,health,priority,next_action,next_action_date,expected_close,risk,updated_at").order("updated_at", { ascending: false }).limit(5000);
    let dailyQuery = adminClient.from("daily_report_entries").select("project_id,salesperson_id,report_date,activity_type,content,customer_contact").gte("report_date", periodStart).lte("report_date", periodEnd).order("report_date", { ascending: false }).limit(5000);
    let weeklyQuery = adminClient.from("weekly_updates").select("owner_id,week_start,status,last_week_summary,this_week_goal,risks,support_needed,actions,submitted_at").gte("week_start", periodStart).lte("week_start", periodEnd).order("week_start", { ascending: false }).limit(500);
    if (!canViewAll) {
      projectQuery = projectQuery.eq("owner_id", requesterId);
      dailyQuery = dailyQuery.eq("salesperson_id", requesterId);
      weeklyQuery = weeklyQuery.eq("owner_id", requesterId);
    }
    const [projectsResult, dailyResult, weeklyResult] = await Promise.all([projectQuery, dailyQuery, weeklyQuery]);
    const dataError = projectsResult.error ?? dailyResult.error ?? weeklyResult.error;
    if (dataError) throw new Error(`销售报告数据读取失败：${dataError.message}`);
    const projects = projectsResult.data ?? [];
    const dailyEntries = dailyResult.data ?? [];
    const weeklyUpdates = weeklyResult.data ?? [];
    const dataScope = canViewAll ? "全部可见数据" : "本人负责项目";
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const actionCountByProject = new Map<string, number>();
    dailyEntries.forEach((entry) => actionCountByProject.set(entry.project_id, (actionCountByProject.get(entry.project_id) ?? 0) + 1));
    const terminalStages = new Set(["won", "lost"]);
    const activeProjects = projects.filter((project) => !terminalStages.has(project.stage));
    const stageScore: Record<string, number> = { lead: 1, discovery: 2, solution: 4, negotiation: 6, contract: 8 };
    const periodEndTime = new Date(`${periodEnd}T23:59:59+08:00`).getTime();
    const staleDays = (project: Record<string, unknown>) => Math.max(0, Math.floor((periodEndTime - new Date(String(project.updated_at)).getTime()) / 86400000));
    const hotProjects = [...activeProjects]
      .sort((a, b) => ((stageScore[b.stage] ?? 0) * 10 + (actionCountByProject.get(b.id) ?? 0) * 5 + Number(b.amount) / 1000) - ((stageScore[a.stage] ?? 0) * 10 + (actionCountByProject.get(a.id) ?? 0) * 5 + Number(a.amount) / 1000))
      .slice(0, 8)
      .map((project) => ({ projectName: project.name, amount: Number(project.amount), stage: project.stage, reason: `${project.stage === "contract" || project.stage === "negotiation" ? "处于高转化阶段" : "处于持续推进阶段"}，本期客户行动 ${actionCountByProject.get(project.id) ?? 0} 次${project.next_action ? `，下一步为“${project.next_action}”` : ""}` }));
    const coldProjects = [...activeProjects]
      .sort((a, b) => (staleDays(b) + ((actionCountByProject.get(b.id) ?? 0) ? 0 : 20) + (b.next_action ? 0 : 10)) - (staleDays(a) + ((actionCountByProject.get(a.id) ?? 0) ? 0 : 20) + (a.next_action ? 0 : 10)))
      .slice(0, 8)
      .map((project) => ({ projectName: project.name, amount: Number(project.amount), stage: project.stage, reason: `已 ${staleDays(project)} 天未更新，本期客户行动 ${actionCountByProject.get(project.id) ?? 0} 次${project.next_action ? "" : "，且未填写下一步动作"}` }));
    const currentActions = [
      ...projects.filter((project) => project.next_action).map((project) => ({ projectName: project.name, owner: project.owner_name, stage: project.stage, action: project.next_action, date: project.next_action_date || "", progress: "项目下一步动作" })),
      ...dailyEntries.map((entry) => ({ projectName: projectById.get(entry.project_id)?.name ?? "未匹配项目", owner: projectById.get(entry.project_id)?.owner_name ?? "", stage: projectById.get(entry.project_id)?.stage ?? "", action: entry.content, date: entry.report_date, progress: "已记录客户行动" })),
    ].slice(0, 30);
    const projectIssues = activeProjects.filter((project) => project.health === "red" || project.health === "yellow" || (project.risk && !["暂无重大风险", "未填写", "暂无"].includes(project.risk)) || (project.expected_close && project.expected_close < periodEnd)).slice(0, 20).map((project) => ({
      projectName: project.name,
      issue: project.risk && !["暂无重大风险", "未填写", "暂无"].includes(project.risk) ? project.risk : project.expected_close && project.expected_close < periodEnd ? `预计成交日期 ${project.expected_close} 已过期` : `项目健康度为 ${project.health}`,
      impact: project.stage === "contract" || project.stage === "negotiation" ? "影响近期签约预测" : "可能降低后续转化效率",
    }));
    const metrics = {
      projectCount: projects.length,
      totalAmount: Math.round(projects.reduce((sum, project) => sum + Number(project.amount || 0), 0)),
      weightedPipeline: Math.round(projects.reduce((sum, project) => sum + Number(project.amount || 0) * Number(project.probability || 0) / 100, 0)),
      actionCount: dailyEntries.length,
      wonCount: projects.filter((project) => project.stage === "won").length,
      lostCount: projects.filter((project) => project.stage === "lost").length,
    };
    const baseContent: Record<string, unknown> = {
      executiveSummary: `本期共跟踪 ${metrics.projectCount} 个项目，商机总额 ${metrics.totalAmount} 万元，加权管道 ${metrics.weightedPipeline} 万元；记录客户行动 ${metrics.actionCount} 次，识别热项目 ${hotProjects.length} 个、需重点唤醒的冷项目 ${coldProjects.length} 个。`,
      metrics,
      currentActions,
      projectIssues,
      hotProjects,
      coldProjects,
      agentAnalysis: `当前管道以 ${hotProjects.slice(0, 3).map((item) => item.projectName).join("、") || "暂无明确热项目"} 为优先推进对象；${coldProjects.length ? `同时有 ${coldProjects.length} 个冷项目需要补充客户行动和下一步计划。` : "当前没有明显冷项目。"}`,
      nextSuggestions: [
        "优先核实合同签订、招投标阶段项目的决策链、预算和明确签约日期。",
        "对本期无客户行动或未填写下一步动作的项目安排责任人和完成时限。",
        "对预计成交日期已过期的项目重新评估概率，必要时转为丢单并记录原因。",
      ],
    };
    let content = baseContent;
    try {
      const modelResponse = await fetchWithTimeout(`${gatewayBaseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${gatewayKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5",
          store: false,
          reasoning_effort: "low",
          max_completion_tokens: 2500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "你是科杰科技销售 Agent（By Keenclaw）。基于给定的规则分析结果，补充更凝练的管理摘要、Agent 分析和下一步建议。不得修改指标，不得编造项目。只返回 JSON：{\"executiveSummary\":\"\",\"agentAnalysis\":\"\",\"nextSuggestions\":[\"\"]}" },
            { role: "user", content: JSON.stringify({ title, periodStart, periodEnd, dataScope, metrics, hotProjects, coldProjects, projectIssues, currentActions: currentActions.slice(0, 15), weeklyUpdates }) },
          ],
        }),
      }, 55000);
      if (modelResponse.ok) {
        const modelData = await modelResponse.json();
        const agentContent = parseModelJson(modelData?.choices?.[0]?.message?.content ?? modelData?.output_text) as Record<string, unknown>;
        content = {
          ...baseContent,
          executiveSummary: agentContent.executiveSummary || baseContent.executiveSummary,
          agentAnalysis: agentContent.agentAnalysis || baseContent.agentAnalysis,
          nextSuggestions: array(agentContent.nextSuggestions).length ? agentContent.nextSuggestions : baseContent.nextSuggestions,
        };
      } else {
        content = { ...baseContent, agentAnalysis: `${baseContent.agentAnalysis} 本次大模型增强暂不可用，报告已使用实时数据规则分析完成。` };
      }
    } catch {
      content = { ...baseContent, agentAnalysis: `${baseContent.agentAnalysis} 本次大模型增强响应超时，报告已使用实时数据规则分析完成。` };
    }
    const markdown = reportMarkdown(title, content);
    const { error: updateError } = await adminClient.from("sales_reports").update({
      status: "completed",
      content,
      markdown,
      error_message: null,
      data_scope: dataScope,
      project_count: projects.length,
      finished_at: new Date().toISOString(),
    }).eq("id", reportId);
    if (updateError) throw updateError;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    await adminClient.from("sales_reports").update({
      status: "failed",
      error_message: timedOut ? "销售报告生成超过 140 秒，请稍后重新生成。" : error instanceof Error ? error.message.slice(0, 1000) : "销售报告生成失败",
      finished_at: new Date().toISOString(),
    }).eq("id", reportId);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const gatewayKey = Deno.env.get("KEENROUTER_API_KEY");
  const schedulerToken = Deno.env.get("SALES_REPORT_SCHEDULER_TOKEN");
  const gatewayBaseUrl = (Deno.env.get("KEENROUTER_BASE_URL") ?? "http://router.keendata.net:5343/v1").replace(/\/$/, "");
  if (!gatewayKey) return jsonResponse({ error: "销售 Agent 尚未配置模型密钥" }, 503);
  const body = await request.json();
  const action = String(body.action ?? "create");
  const reportType = body.reportType === "monthly" ? "monthly" : "weekly";
  const scheduled = action === "scheduled";
  let requesterId = "";

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  if (scheduled) {
    if (!schedulerToken || request.headers.get("x-scheduler-token") !== schedulerToken) return jsonResponse({ error: "Invalid scheduler token" }, 401);
    if (!isScheduledDay(reportType)) return jsonResponse({ skipped: true, reason: "Not a scheduled report day" });
    requesterId = String(body.requesterId ?? "");
    if (!requesterId) return jsonResponse({ error: "Missing requesterId" }, 400);
  } else {
    const authorization = request.headers.get("Authorization") ?? "";
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "登录状态已失效，请重新登录" }, 401);
    requesterId = user.id;
  }

  const period = reportPeriod(reportType);
  const { data: requesterProfile, error: requesterProfileError } = await adminClient.from("profiles").select("display_name,active").eq("id", requesterId).single();
  if (requesterProfileError || !requesterProfile?.active) return jsonResponse({ error: "报告用户不存在或已停用" }, 404);
  const title = `${requesterProfile.display_name} · ${period.start} 至 ${period.end} 销售${reportType === "weekly" ? "周报" : "月报"}`;
  const generationKey = `${requesterId}:${reportType}:${period.start}`;
  const { data: report, error: upsertError } = await adminClient.from("sales_reports").upsert({
    requester_id: requesterId,
    report_type: reportType,
    period_start: period.start,
    period_end: period.end,
    title,
    generation_key: generationKey,
    status: "pending",
    content: null,
    markdown: null,
    error_message: null,
    generated_automatically: scheduled,
    started_at: null,
    finished_at: null,
  }, { onConflict: "generation_key" }).select("id,status,report_type,period_start,period_end,title,created_at").single();
  if (upsertError || !report) return jsonResponse({ error: `销售报告任务创建失败：${upsertError?.message ?? "未知错误"}` }, 500);

  const task = processReport(report.id, requesterId, reportType, period.start, period.end, title, adminClient, gatewayBaseUrl, gatewayKey);
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (edgeRuntime) edgeRuntime.waitUntil(task);
  else task.catch(() => undefined);
  return jsonResponse({ reportId: report.id, status: report.status, reportType, periodStart: period.start, periodEnd: period.end, title }, 202);
});
