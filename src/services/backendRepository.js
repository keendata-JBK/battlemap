import { supabase } from "../lib/supabase.js";

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
}

function mapProject(row) {
  return {
    id: row.id,
    code: row.project_code,
    name: row.name,
    account: row.customer_name,
    customerId: row.customer_id,
    category: row.category,
    region: row.region,
    province: row.province,
    city: row.city,
    district: row.district,
    adcode: row.adcode,
    coordinates: [Number(row.longitude), Number(row.latitude)],
    amount: Number(row.amount),
    stage: row.stage,
    owner: row.owner_name,
    ownerId: row.owner_id,
    presales: row.presales_name || "未分配",
    presalesId: row.presales_id,
    health: row.health,
    priority: row.priority,
    nextAction: row.next_action || "",
    nextActionDate: row.next_action_date || "",
    expectedClose: row.expected_close || "",
    source: row.source || "",
    updatedAt: formatDateTime(row.updated_at),
    risk: row.risk || "未填写",
    requirementDescription: row.description || "",
    decisionChainDescription: row.decision_chain_description || "",
    competitorDescription: row.competitor_description || "",
    referralUnit: row.referral_unit || "",
    isDirectContract: row.is_direct_contract !== false,
    integrator: row.integrator || "",
    deliveryPartners: Array.isArray(row.delivery_partners) ? row.delivery_partners : [],
    createdAt: row.created_at,
    updatedAtIso: row.updated_at,
  };
}

function mapAlert(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    ownerId: row.owner_id,
    level: row.level,
    alertType: row.alert_type,
    title: row.title,
    description: row.description || "",
    time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.created_at)),
    status: row.status,
    dueAt: row.due_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapWeeklyUpdate(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    weekStart: row.week_start,
    status: row.status,
    lastWeekSummary: row.last_week_summary || "",
    thisWeekGoal: row.this_week_goal || "",
    risks: row.risks || "",
    supportNeeded: row.support_needed || "",
    actions: Array.isArray(row.actions) ? row.actions : [],
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

function mapAlertRule(row) {
  return {
    id: row.id,
    code: row.rule_code,
    name: row.name,
    description: row.description,
    level: row.level,
    thresholdDays: row.threshold_days,
    enabled: row.enabled,
    sortOrder: row.sort_order,
  };
}

function mapImportJob(row) {
  return {
    id: row.id,
    file: row.file_name,
    createdBy: row.created_by,
    rows: row.total_rows,
    success: row.success_rows,
    failed: row.failed_rows,
    status: row.status,
    errors: row.error_report ?? [],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapAuditLog(row) {
  return {
    id: row.id,
    table: row.table_name,
    recordId: row.record_id,
    action: row.action,
    actorId: row.actor_id,
    oldData: row.old_data,
    newData: row.new_data,
    createdAt: row.created_at,
  };
}

function toProjectPayload(form, customerId, ownerId, presalesId, currentUserId) {
  const coordinates = form.coordinates ?? [116.4, 39.9];
  const deliveryPartners = Array.isArray(form.deliveryPartners)
    ? form.deliveryPartners
    : String(form.deliveryPartners ?? "").split(/[，,、;；]/).map((item) => item.trim()).filter(Boolean);
  return {
    customer_id: customerId,
    name: form.name,
    category: form.category,
    region: form.region,
    province: form.province,
    city: form.city,
    district: form.district,
    adcode: form.adcode,
    longitude: Number(coordinates[0]),
    latitude: Number(coordinates[1]),
    amount: Number(form.amount),
    stage: form.stage,
    probability: { lead: 5, discovery: 20, solution: 50, negotiation: 80, contract: 90, won: 100, lost: 0 }[form.stage] ?? 5,
    owner_id: ownerId,
    presales_id: presalesId,
    health: form.health,
    priority: form.priority,
    next_action: form.nextAction || null,
    next_action_date: form.nextActionDate || null,
    expected_close: form.expectedClose || null,
    source: form.source || "手工录入",
    risk: form.risk || null,
    description: form.requirementDescription?.trim() || null,
    decision_chain_description: form.decisionChainDescription?.trim() || null,
    competitor_description: form.competitorDescription?.trim() || null,
    referral_unit: form.category === "government" ? form.referralUnit?.trim() || null : null,
    is_direct_contract: form.isDirectContract !== false,
    integrator: form.isDirectContract === false ? form.integrator?.trim() || null : null,
    delivery_partners: deliveryPartners,
    created_by: currentUserId,
  };
}

const PROJECT_CONTEXT_COLUMNS = ["description", "decision_chain_description", "competitor_description", "referral_unit"];

export function isProjectContextSchemaError(error) {
  const message = String(error?.message ?? "");
  const mentionsContextColumn = PROJECT_CONTEXT_COLUMNS.some((column) => message.includes(column));
  return mentionsContextColumn && (error?.code === "PGRST204" || /schema cache/i.test(message));
}

export function stripProjectContextFields(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !PROJECT_CONTEXT_COLUMNS.includes(key)));
}

async function resolveProfileId(displayName, fallbackUserId) {
  if (!displayName) return fallbackUserId;
  const { data, error } = await supabase.from("profiles").select("id").eq("display_name", displayName).eq("active", true).limit(1).maybeSingle();
  if (error) throw error;
  return data?.id ?? fallbackUserId;
}

async function ensureCustomer(form, ownerId, currentUserId) {
  let query = supabase.from("customers").select("id").eq("name", form.account).is("deleted_at", null).limit(1);
  const { data: existing, error: lookupError } = await query.maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing.id;

  const { data, error } = await supabase.from("customers").insert({
    name: form.account,
    customer_type: form.category,
    region: form.region,
    province: form.province,
    city: form.city,
    district: form.district,
    adcode: form.adcode,
    owner_id: ownerId,
    created_by: currentUserId,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function savePrimaryContact(form, customerId, ownerId, currentUserId) {
  if (!form.contactName?.trim()) return;
  const payload = {
    customer_id: customerId,
    name: form.contactName.trim(),
    mobile: form.contactMobile?.trim() || null,
    email: form.contactEmail?.trim() || null,
    is_key_decision_maker: true,
    data_classification: "confidential",
    owner_id: ownerId,
    created_by: currentUserId,
  };
  const { data: existing, error: lookupError } = await supabase.from("contacts").select("id").eq("customer_id", customerId).eq("name", payload.name).is("deleted_at", null).limit(1).maybeSingle();
  if (lookupError) throw lookupError;
  const query = existing
    ? supabase.from("contacts").update({ mobile: payload.mobile, email: payload.email, owner_id: ownerId }).eq("id", existing.id)
    : supabase.from("contacts").insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export async function loadBackendData() {
  const { error: refreshAlertError } = await supabase.rpc("refresh_alerts");
  if (refreshAlertError) throw refreshAlertError;
  const [
    { data: projectRows, error: projectError },
    { data: alertRows, error: alertError },
    { data: weeklyRows, error: weeklyError },
    { data: alertRuleRows, error: alertRuleError },
    { data: dailyImportRows, error: dailyImportError },
    { data: contactRows, error: contactError },
    { data: customerRows, error: customerError },
    { data: importRows, error: importError },
    { data: auditRows, error: auditError },
    { data: dailyEntryRows, error: dailyEntryError },
    { data: salesReportRows, error: salesReportError },
  ] = await Promise.all([
    supabase.from("project_dashboard").select("*").order("updated_at", { ascending: false }),
    supabase.from("alerts").select("*").order("created_at", { ascending: false }),
    supabase.from("weekly_updates").select("*").order("week_start", { ascending: false }).limit(500),
    supabase.from("alert_rules").select("*").order("sort_order"),
    supabase.from("daily_report_imports").select("id,report_date,status,entry_count,model,created_by,created_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("contacts").select("customer_id,mobile,email").is("deleted_at", null),
    supabase.from("customers").select("id,name,unified_credit_code,updated_at").is("deleted_at", null),
    supabase.from("import_jobs").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("audit_logs").select("id,table_name,record_id,action,old_data,new_data,actor_id,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("daily_report_entries").select("id,project_id,salesperson_id,report_date,activity_type,content,customer_contact,created_at").order("report_date", { ascending: false }).limit(2000),
    supabase.from("sales_reports").select("id,requester_id,report_type,period_start,period_end,title,status,content,markdown,error_message,model,data_scope,project_count,generated_automatically,created_at,updated_at,finished_at").order("period_end", { ascending: false }).limit(50),
  ]);
  if (projectError) throw projectError;
  if (alertError) throw alertError;
  if (weeklyError) throw weeklyError;
  if (alertRuleError) throw alertRuleError;
  if (dailyImportError) throw dailyImportError;
  if (contactError) throw contactError;
  if (customerError) throw customerError;
  if (importError) throw importError;
  if (auditError) throw auditError;
  if (dailyEntryError) throw dailyEntryError;
  if (salesReportError) throw salesReportError;

  const customerIdsWithValidContact = new Set(
    contactRows
      .filter((contact) => contact.mobile?.trim() || contact.email?.trim())
      .map((contact) => contact.customer_id),
  );
  const projects = projectRows.map((row) => ({
    ...mapProject(row),
    hasValidContact: customerIdsWithValidContact.has(row.customer_id),
  }));
  return {
    projects,
    alerts: alertRows.map(mapAlert),
    weeklyUpdates: weeklyRows.map(mapWeeklyUpdate),
    alertRules: alertRuleRows.map(mapAlertRule),
    dailyReportImports: dailyImportRows,
    customers: customerRows,
    importJobs: importRows.map(mapImportJob),
    auditLogs: auditRows.map(mapAuditLog),
    dailyReportEntries: dailyEntryRows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      salespersonId: row.salesperson_id,
      reportDate: row.report_date,
      activityType: row.activity_type,
      content: row.content,
      customerContact: row.customer_contact || "",
      createdAt: row.created_at,
    })),
    salesReports: salesReportRows.map(mapSalesReport),
  };
}

function mapSalesReport(row) {
  return {
    id: row.id,
    requesterId: row.requester_id,
    reportType: row.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    title: row.title,
    status: row.status,
    content: row.content || null,
    markdown: row.markdown || "",
    error: row.error_message || "",
    model: row.model,
    dataScope: row.data_scope || "当前权限数据",
    projectCount: row.project_count ?? 0,
    generatedAutomatically: Boolean(row.generated_automatically),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export async function saveWeeklyUpdate(input, currentUserId) {
  const payload = {
    owner_id: input.ownerId,
    week_start: input.weekStart,
    status: input.status,
    last_week_summary: input.lastWeekSummary?.trim() || "",
    this_week_goal: input.thisWeekGoal?.trim() || "",
    risks: input.risks?.trim() || "",
    support_needed: input.supportNeeded?.trim() || "",
    actions: (input.actions ?? []).map((action) => ({
      id: action.id,
      projectId: action.projectId || null,
      title: String(action.title ?? "").trim(),
      dueDate: action.dueDate || null,
      status: action.status || "planned",
    })).filter((action) => action.title),
    created_by: currentUserId,
    submitted_at: input.status === "submitted" ? new Date().toISOString() : null,
  };
  const { data, error } = await supabase
    .from("weekly_updates")
    .upsert(payload, { onConflict: "owner_id,week_start" })
    .select("*")
    .single();
  if (error) throw error;
  const { error: refreshAlertError } = await supabase.rpc("refresh_alerts");
  if (refreshAlertError) throw refreshAlertError;
  return mapWeeklyUpdate(data);
}

export async function updateAlertRule(input) {
  const { data, error } = await supabase
    .from("alert_rules")
    .update({ enabled: input.enabled, threshold_days: Number(input.thresholdDays) })
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  const { error: refreshAlertError } = await supabase.rpc("refresh_alerts");
  if (refreshAlertError) throw refreshAlertError;
  return mapAlertRule(data);
}

export async function askMarketingData(question, history = []) {
  const { data, error } = await supabase.functions.invoke("marketing-qa", {
    body: { action: "create", question, history },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadMarketingDataJob(jobId) {
  const { data, error } = await supabase
    .from("marketing_qa_jobs")
    .select("id,status,answer,error_message,model,data_scope,project_count,created_at,updated_at,finished_at")
    .eq("id", jobId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    status: data.status,
    answer: data.answer || "",
    error: data.error_message || "",
    model: data.model,
    dataScope: data.data_scope || "当前权限数据",
    projectCount: data.project_count ?? 0,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    finishedAt: data.finished_at,
  };
}

export async function loadWorkspaceState(stateKey) {
  const { data, error } = await supabase
    .from("user_workspace_state")
    .select("state_data,updated_at")
    .eq("state_key", stateKey)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...(data.state_data ?? {}), updatedAt: data.updated_at } : null;
}

export async function saveWorkspaceState(stateKey, stateData, currentUserId) {
  const { data, error } = await supabase
    .from("user_workspace_state")
    .upsert({ user_id: currentUserId, state_key: stateKey, state_data: stateData }, { onConflict: "user_id,state_key" })
    .select("updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function clearWorkspaceState(stateKey) {
  const { error } = await supabase.from("user_workspace_state").delete().eq("state_key", stateKey);
  if (error) throw error;
}

export async function analyzeDailyReport(rawText, defaultDate) {
  const { data, error } = await supabase.functions.invoke("daily-report", {
    body: { rawText, defaultDate },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadDailyReportAnalysisJob(jobId) {
  const { data, error } = await supabase
    .from("daily_report_analysis_jobs")
    .select("id,status,result,error_message,model,created_at,updated_at,finished_at")
    .eq("id", jobId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    status: data.status,
    result: data.result || null,
    error: data.error_message || "",
    model: data.model,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    finishedAt: data.finished_at,
  };
}

export async function createSalesReport(reportType) {
  const { data, error } = await supabase.functions.invoke("sales-reports", {
    body: { action: "create", reportType },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadSalesReport(reportId) {
  const { data, error } = await supabase
    .from("sales_reports")
    .select("id,requester_id,report_type,period_start,period_end,title,status,content,markdown,error_message,model,data_scope,project_count,generated_automatically,created_at,updated_at,finished_at")
    .eq("id", reportId)
    .single();
  if (error) throw error;
  return mapSalesReport(data);
}

export async function listSalesReports(limit = 20) {
  const { data, error } = await supabase
    .from("sales_reports")
    .select("id,requester_id,report_type,period_start,period_end,title,status,content,markdown,error_message,model,data_scope,project_count,generated_automatically,created_at,updated_at,finished_at")
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapSalesReport);
}

export async function importDailyReport(rawText, defaultDate, entries) {
  const payload = entries.map((entry) => ({
    projectId: entry.projectId,
    projectName: entry.projectName,
    salespersonId: entry.salespersonId,
    salespersonName: entry.salespersonName,
    reportDate: entry.reportDate,
    activityType: entry.activityType,
    content: entry.content?.trim(),
    customerContact: entry.customerContact?.trim() || "",
    matchConfidence: Number(entry.matchConfidence ?? 0),
    matchReason: entry.matchReason || "",
    rawSegment: entry.rawSegment || "",
  }));
  const { data, error } = await supabase.rpc("import_daily_report", {
    raw_report_text: rawText,
    default_report_date: defaultDate,
    payload,
  });
  if (error) throw error;
  return data?.[0] ?? { imported_count: payload.length };
}

export async function saveBackendProject(form, existingProject, currentUserId) {
  const ownerId = await resolveProfileId(form.owner, existingProject?.ownerId ?? currentUserId);
  const presalesId = await resolveProfileId(form.presales, existingProject?.presalesId ?? null);
  const customerId = await ensureCustomer(form, ownerId, currentUserId);
  await savePrimaryContact(form, customerId, ownerId, currentUserId);
  const payload = toProjectPayload(form, customerId, ownerId, presalesId, currentUserId);
  if (existingProject) delete payload.created_by;

  const persist = (nextPayload) => {
    const query = existingProject
      ? supabase.from("projects").update(nextPayload).eq("id", existingProject.id)
      : supabase.from("projects").insert(nextPayload);
    return query.select("id").single();
  };
  let { data, error } = await persist(payload);
  let contextFieldsSkipped = false;
  if (error && isProjectContextSchemaError(error)) {
    ({ data, error } = await persist(stripProjectContextFields(payload)));
    contextFieldsSkipped = !error;
  }
  if (error) throw error;

  const { data: row, error: reloadError } = await supabase.from("project_dashboard").select("*").eq("id", data.id).single();
  if (reloadError) throw reloadError;
  const activityContent = existingProject
    ? existingProject.stage !== form.stage
      ? `销售阶段由“${existingProject.stage}”变更为“${form.stage}”`
      : `更新项目资料${form.nextAction ? `，下一步动作：${form.nextAction}` : ""}`
    : `创建项目${form.nextAction ? `，下一步动作：${form.nextAction}` : ""}`;
  const { error: activityError } = await supabase.from("project_activities").insert({
    project_id: data.id,
    activity_type: existingProject && existingProject.stage !== form.stage ? "stage_change" : "note",
    content: activityContent,
    next_action: form.nextAction || null,
    next_action_date: form.nextActionDate || null,
    created_by: currentUserId,
  });
  if (activityError) throw activityError;
  return { ...mapProject(row), contextFieldsSkipped };
}

export async function applyCognitiveAction({ projectId, nextAction, nextActionDate, summary }, currentUserId) {
  if (!projectId) throw new Error("未找到要执行动作的项目");
  const safeAction = String(nextAction ?? "").trim().slice(0, 500);
  const safeDate = String(nextActionDate ?? "").trim();
  const safeSummary = String(summary ?? "").trim().slice(0, 800);
  if (!safeAction || !/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) {
    throw new Error("AI 动作缺少有效的下一步动作或日期");
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({ next_action: safeAction, next_action_date: safeDate })
    .eq("id", projectId);
  if (updateError) throw updateError;

  const { error: activityError } = await supabase.from("project_activities").insert({
    project_id: projectId,
    activity_type: "task",
    content: `AI 认知行动已确认：${safeSummary || safeAction}`,
    next_action: safeAction,
    next_action_date: safeDate,
    created_by: currentUserId,
  });
  if (activityError) throw activityError;
}

export async function softDeleteBackendProjects(ids) {
  const { error } = await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).in("id", ids);
  if (error) throw error;
}

export async function importBackendProjects(rows, { fileName, currentUserId }) {
  const { data: job, error: createJobError } = await supabase.from("import_jobs").insert({
    file_name: fileName || "未命名导入.csv",
    total_rows: rows.length,
    status: "validating",
    created_by: currentUserId,
  }).select("id").single();
  if (createJobError) throw createJobError;

  const { data: importedRows, error } = await supabase.rpc("import_projects", { payload: rows });
  if (error) {
    await supabase.from("import_jobs").update({
      failed_rows: rows.length,
      status: "failed",
      error_report: [{ message: error.message }],
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw error;
  }

  const successRows = importedRows?.length ?? rows.length;
  const { error: completeJobError } = await supabase.from("import_jobs").update({
    success_rows: successRows,
    failed_rows: Math.max(rows.length - successRows, 0),
    status: successRows === rows.length ? "completed" : "partial",
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (completeJobError) throw completeJobError;
  return loadBackendData();
}

export async function loadProjectActivities(projectId) {
  const { data, error } = await supabase
    .from("project_activities")
    .select("id,activity_type,content,occurred_at,next_action,next_action_date,created_by")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadProjectDailyReports(projectId) {
  const { data, error } = await supabase
    .from("daily_report_entries")
    .select("id,report_date,activity_type,content,customer_contact,match_confidence,match_reason,salesperson_id,salesperson:profiles!daily_report_entries_salesperson_id_fkey(display_name)")
    .eq("project_id", projectId)
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateBackendAlerts(nextAlerts, previousAlerts) {
  const changed = nextAlerts.filter((next) => previousAlerts.find((previous) => previous.id === next.id)?.status !== next.status);
  await Promise.all(changed.map(async (alert) => {
    const payload = {
      status: alert.status,
      resolved_at: alert.status === "已解决" ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("alerts").update(payload).eq("id", alert.id);
    if (error) throw error;
  }));
}

export async function loadDirectory() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,role,active,team:teams(name)")
    .order("display_name");
  if (error) throw error;
  return data.map((profile) => ({
    id: profile.id,
    name: profile.display_name,
    role: { admin: "管理员", presales: "售前", sales: "销售" }[profile.role],
    roleKey: profile.role,
    team: profile.team?.name ?? "未分组",
    status: profile.active ? "启用" : "停用",
  }));
}

export async function getFunctionErrorMessage(error) {
  if (error?.context) {
    try {
      const payload = await error.context.json();
      if (payload?.error) return payload.error;
    } catch {
      // Fall back to the client error when the response has no JSON body.
    }
  }
  return error?.message || "服务调用失败";
}

export async function createBackendUser(input) {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", ...input },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function setBackendUserActive(userId, active) {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "set-active", userId, active },
  });
  if (error) throw new Error(await getFunctionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}
