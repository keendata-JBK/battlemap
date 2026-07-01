import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function parseModelJson(value: unknown) {
  const text = String(value ?? "").trim();
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回有效 JSON");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function clampConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function normalizeDate(value: unknown, fallback: string) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
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

async function processJob(
  jobId: string,
  callerClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  rawText: string,
  defaultDate: string,
  gatewayBaseUrl: string,
  gatewayKey: string,
) {
  try {
    await adminClient.from("daily_report_analysis_jobs").update({ status: "processing", started_at: new Date().toISOString(), error_message: null }).eq("id", jobId);
    const [salesResult, projectResult] = await Promise.all([
      callerClient.from("profiles").select("id,display_name").eq("role", "sales").eq("active", true).order("display_name"),
      callerClient.from("project_dashboard").select("id,project_code,name,customer_name,owner_id,owner_name,region,city,district,stage,next_action").order("updated_at", { ascending: false }).limit(5000),
    ]);
    const dataError = salesResult.error ?? projectResult.error;
    if (dataError) throw new Error(`项目或销售目录读取失败：${dataError.message}`);

    const sales = salesResult.data ?? [];
    const projects = projectResult.data ?? [];
    const todayInChina = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const systemPrompt = `你是科杰科技销售日报结构化助手。请把管理员粘贴的中文日报拆成一条条可入库记录，并匹配给定销售和项目。

规则：
1. 只允许使用销售目录和项目目录中存在的 ID，不得编造销售、项目或客户。
2. 每个独立的客户沟通、拜访、电话、方案交流、任务推进拆成一条记录。
3. activityType 只能是 call、meeting、visit、proposal、task、note。
4. 优先按项目名称、项目编号、客户名称和负责人综合匹配。无法可靠匹配时 projectId 设为 null，matchConfidence 不高于 0.4。
5. salespersonId 必须匹配销售姓名；无法识别时设为 null。
6. reportDate 使用 YYYY-MM-DD。相对日期以中国时区今天 ${todayInChina} 为准；未写日期时使用默认日期 ${defaultDate}。
7. content 保留事实，不扩写结论；customerContact 只保留日报里明确出现的客户姓名或职务。
8. 只返回 JSON，不要 Markdown，不要解释。

返回结构：
{"entries":[{"reportDate":"YYYY-MM-DD","salespersonId":"uuid或null","salespersonName":"姓名或空","projectId":"uuid或null","projectName":"项目名或空","activityType":"visit","content":"事实描述","customerContact":"客户联系人或空","matchConfidence":0.95,"matchReason":"匹配依据","rawSegment":"对应原文"}],"warnings":["需要管理员注意的问题"]}`;

    const modelResponse = await fetchWithTimeout(`${gatewayBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gatewayKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        store: false,
        reasoning_effort: "low",
        max_completion_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `销售目录：\n${JSON.stringify(sales)}\n\n项目目录：\n${JSON.stringify(projects)}\n\n默认日期：${defaultDate}\n\n日报原文：\n${rawText}` },
        ],
      }),
    }, 140000);

    if (!modelResponse.ok) {
      const message = (await modelResponse.text()).slice(0, 500);
      if (modelResponse.status === 429 && message.includes("API_KEY_QUOTA_EXHAUSTED")) throw new Error("模型接口额度已用完，请管理员在 KeenRouter 提高额度后重试。");
      if (modelResponse.status === 401 && message.includes("API_KEY_DISABLED")) throw new Error("模型接口密钥已被 KeenRouter 禁用，请管理员重新启用或更换密钥。");
      throw new Error(`模型服务调用失败（${modelResponse.status}）：${message}`);
    }

    const modelData = await modelResponse.json();
    const parsed = parseModelJson(modelData?.choices?.[0]?.message?.content ?? modelData?.output_text);
    const salesById = new Map(sales.map((item) => [item.id, item]));
    const salesByName = new Map(sales.map((item) => [item.display_name, item]));
    const projectsById = new Map(projects.map((item) => [item.id, item]));
    const allowedTypes = new Set(["call", "meeting", "visit", "proposal", "task", "note"]);
    const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).slice(0, 300).map((entry: Record<string, unknown>, index: number) => {
      const salesperson = salesById.get(String(entry.salespersonId ?? "")) ?? salesByName.get(String(entry.salespersonName ?? ""));
      const project = projectsById.get(String(entry.projectId ?? ""));
      const confidence = project && salesperson ? clampConfidence(entry.matchConfidence) : Math.min(clampConfidence(entry.matchConfidence), 0.4);
      return {
        id: `daily-${index + 1}`,
        reportDate: normalizeDate(entry.reportDate, defaultDate),
        salespersonId: salesperson?.id ?? null,
        salespersonName: salesperson?.display_name ?? String(entry.salespersonName ?? ""),
        projectId: project?.id ?? null,
        projectName: project?.name ?? String(entry.projectName ?? ""),
        activityType: allowedTypes.has(String(entry.activityType)) ? String(entry.activityType) : "note",
        content: String(entry.content ?? "").trim().slice(0, 4000),
        customerContact: String(entry.customerContact ?? "").trim().slice(0, 500),
        matchConfidence: confidence,
        matchReason: String(entry.matchReason ?? "").trim().slice(0, 1000),
        rawSegment: String(entry.rawSegment ?? "").trim().slice(0, 4000),
      };
    }).filter((entry) => entry.content);

    const result = {
      entries,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((item: unknown) => String(item)).slice(0, 20) : [],
      model: "gpt-5.5",
      defaultDate,
    };
    const { error: updateError } = await adminClient.from("daily_report_analysis_jobs").update({
      status: "completed",
      result,
      error_message: null,
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
    if (updateError) throw updateError;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    await adminClient.from("daily_report_analysis_jobs").update({
      status: "failed",
      error_message: timedOut ? "日报识别仍在后台执行超时，请稍后重试或拆分日报内容。" : error instanceof Error ? error.message.slice(0, 1000) : "日报识别任务执行失败",
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const gatewayKey = Deno.env.get("KEENROUTER_API_KEY");
  const gatewayBaseUrl = (Deno.env.get("KEENROUTER_BASE_URL") ?? "http://router.keendata.net:5343/v1").replace(/\/$/, "");
  const authorization = request.headers.get("Authorization") ?? "";
  if (!gatewayKey) return jsonResponse({ error: "日报识别服务尚未配置模型密钥" }, 503);

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "登录状态已失效，请重新登录" }, 401);
  const { data: profile, error: profileError } = await callerClient.from("profiles").select("role").eq("id", user.id).single();
  if (profileError) return jsonResponse({ error: `用户权限读取失败：${profileError.message}` }, 500);
  if (profile.role !== "admin") return jsonResponse({ error: "仅管理员可以识别和导入日报" }, 403);

  const body = await request.json();
  const rawText = String(body.rawText ?? "").trim().slice(0, 30000);
  const defaultDate = normalizeDate(body.defaultDate, new Date().toISOString().slice(0, 10));
  if (!rawText) return jsonResponse({ error: "请粘贴需要识别的日报内容" }, 400);

  const { data: job, error: insertError } = await callerClient.from("daily_report_analysis_jobs").insert({
    requester_id: user.id,
    raw_text: rawText,
    default_date: defaultDate,
  }).select("id,status,created_at").single();
  if (insertError || !job) return jsonResponse({ error: `日报异步任务创建失败：${insertError?.message ?? "未知错误"}` }, 500);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const task = processJob(job.id, callerClient, adminClient, rawText, defaultDate, gatewayBaseUrl, gatewayKey);
  const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (edgeRuntime) edgeRuntime.waitUntil(task);
  else task.catch(() => undefined);

  return jsonResponse({ jobId: job.id, status: job.status, createdAt: job.created_at }, 202);
});
