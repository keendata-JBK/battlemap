import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomIndex(length: number) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % length;
}

function generateTemporaryPassword() {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%&*?",
  ];
  const all = groups.join("");
  const characters = groups.map((group) => group[randomIndex(group.length)]);
  while (characters.length < 16) characters.push(all[randomIndex(all.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join("");
}

function isEmailRateLimit(message = "") {
  return /email.*rate limit|rate limit.*email|over email send rate limit/i.test(message);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = request.headers.get("Authorization") ?? "";

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "登录状态已失效，请重新登录" }, 401);

  const { data: caller } = await callerClient.from("profiles").select("role, active").eq("id", user.id).single();
  if (!caller?.active || caller.role !== "admin") return jsonResponse({ error: "仅管理员可以管理用户" }, 403);

  const body = await request.json();
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const displayName = String(body.displayName ?? "").trim();
    const role = ["sales", "presales", "admin"].includes(body.role) ? body.role : "sales";
    if (!email || !displayName) return jsonResponse({ error: "姓名和企业邮箱不能为空" }, 400);

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(body.email, {
      data: { display_name: displayName },
      redirectTo: Deno.env.get("SITE_URL") ?? "https://keendata-jbk.github.io/battlemap/",
    });

    if (!error) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ role, team_id: body.teamId ?? null, password_change_required: false })
        .eq("id", data.user.id);
      if (profileError) return jsonResponse({ error: `账号已邀请，但权限配置失败：${profileError.message}` }, 500);
      return jsonResponse({ userId: data.user.id, delivery: "email" });
    }

    if (!isEmailRateLimit(error.message)) {
      const status = /already.*registered|already.*exists/i.test(error.message) ? 409 : 400;
      const message = status === 409 ? "该邮箱已存在，请在用户列表中管理该账号" : error.message;
      return jsonResponse({ error: message }, status);
    }

    const temporaryPassword = generateTemporaryPassword();
    const { data: listed, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return jsonResponse({ error: `邮件服务限流，且账号兜底创建失败：${listError.message}` }, 500);
    const existingUser = listed.users.find((item) => item.email?.toLowerCase() === email);

    let fallbackUser = existingUser;
    if (existingUser) {
      if (existingUser.email_confirmed_at || existingUser.last_sign_in_at) {
        return jsonResponse({ error: "该邮箱已存在，请在用户列表中管理该账号" }, 409);
      }
      const { data: updated, error: updateError } = await adminClient.auth.admin.updateUserById(existingUser.id, {
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { ...existingUser.user_metadata, display_name: displayName },
      });
      if (updateError) return jsonResponse({ error: `邮件服务限流，且临时账号启用失败：${updateError.message}` }, 500);
      fallbackUser = updated.user;
    } else {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (createError) return jsonResponse({ error: `邮件服务限流，且临时账号创建失败：${createError.message}` }, 500);
      fallbackUser = created.user;
    }

    if (!fallbackUser) return jsonResponse({ error: "临时账号创建失败" }, 500);

    const { error: fallbackProfileError } = await adminClient
      .from("profiles")
      .update({ role, team_id: body.teamId ?? null, password_change_required: true })
      .eq("id", fallbackUser.id);
    if (fallbackProfileError) return jsonResponse({ error: `临时账号已创建，但权限配置失败：${fallbackProfileError.message}` }, 500);

    return jsonResponse({
      userId: fallbackUser.id,
      delivery: "temporary_password",
      temporaryPassword,
      notice: "邮件服务触发限流，已创建强制改密的临时账号",
    });
  }

  if (body.action === "set-active") {
    const { error } = await adminClient.from("profiles").update({ active: Boolean(body.active) }).eq("id", body.userId);
    if (error) return jsonResponse({ error: error.message }, 400);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Unsupported action" }, 400);
});
