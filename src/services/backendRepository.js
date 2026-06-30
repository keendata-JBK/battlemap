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
    createdAt: row.created_at,
    updatedAtIso: row.updated_at,
  };
}

function mapAlert(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    level: row.level,
    title: row.title,
    description: row.description || "",
    time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.created_at)),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
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
    probability: { lead: 5, discovery: 20, solution: 50, negotiation: 80, contract: 90, won: 100 }[form.stage] ?? 5,
    owner_id: ownerId,
    presales_id: presalesId,
    health: form.health,
    priority: form.priority,
    next_action: form.nextAction || null,
    next_action_date: form.nextActionDate || null,
    expected_close: form.expectedClose || null,
    source: form.source || "手工录入",
    risk: form.risk || null,
    created_by: currentUserId,
  };
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
  const [
    { data: projectRows, error: projectError },
    { data: alertRows, error: alertError },
    { data: contactRows, error: contactError },
    { data: customerRows, error: customerError },
    { data: importRows, error: importError },
    { data: auditRows, error: auditError },
  ] = await Promise.all([
    supabase.from("project_dashboard").select("*").order("updated_at", { ascending: false }),
    supabase.from("alerts").select("*").order("created_at", { ascending: false }),
    supabase.from("contacts").select("customer_id,mobile,email").is("deleted_at", null),
    supabase.from("customers").select("id,name,unified_credit_code,updated_at").is("deleted_at", null),
    supabase.from("import_jobs").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("audit_logs").select("id,table_name,record_id,action,old_data,new_data,actor_id,created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  if (projectError) throw projectError;
  if (alertError) throw alertError;
  if (contactError) throw contactError;
  if (customerError) throw customerError;
  if (importError) throw importError;
  if (auditError) throw auditError;

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
    customers: customerRows,
    importJobs: importRows.map(mapImportJob),
    auditLogs: auditRows.map(mapAuditLog),
  };
}

export async function saveBackendProject(form, existingProject, currentUserId) {
  const ownerId = await resolveProfileId(form.owner, existingProject?.ownerId ?? currentUserId);
  const presalesId = await resolveProfileId(form.presales, existingProject?.presalesId ?? null);
  const customerId = await ensureCustomer(form, ownerId, currentUserId);
  await savePrimaryContact(form, customerId, ownerId, currentUserId);
  const payload = toProjectPayload(form, customerId, ownerId, presalesId, currentUserId);
  if (existingProject) delete payload.created_by;

  const query = existingProject
    ? supabase.from("projects").update(payload).eq("id", existingProject.id)
    : supabase.from("projects").insert(payload);
  const { data, error } = await query.select("id").single();
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
  return mapProject(row);
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
