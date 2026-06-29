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
    risk: row.risk || "暂无重大风险",
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
    risk: form.risk || "暂无重大风险",
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
  const [{ data: projectRows, error: projectError }, { data: alertRows, error: alertError }] = await Promise.all([
    supabase.from("project_dashboard").select("*").order("updated_at", { ascending: false }),
    supabase.from("alerts").select("*").order("created_at", { ascending: false }),
  ]);
  if (projectError) throw projectError;
  if (alertError) throw alertError;
  return { projects: projectRows.map(mapProject), alerts: alertRows.map(mapAlert) };
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
  return mapProject(row);
}

export async function softDeleteBackendProjects(ids) {
  const { error } = await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).in("id", ids);
  if (error) throw error;
}

export async function importBackendProjects(rows) {
  const { error } = await supabase.rpc("import_projects", { payload: rows });
  if (error) throw error;
  return loadBackendData();
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

export async function createBackendUser(input) {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", ...input },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function setBackendUserActive(userId, active) {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "set-active", userId, active },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
