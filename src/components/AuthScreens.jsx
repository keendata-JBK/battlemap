import { useState } from "react";
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import logo from "../assets/keendata-logo.png";

export function AppLoadingScreen({ message = "正在连接安全数据服务" }) {
  return (
    <main className="auth-screen">
      <section className="auth-card auth-card--loading">
        <img src={logo} alt="科杰科技 KeenData" />
        <span className="auth-spinner" />
        <h1>{message}</h1>
        <p>正在校验登录状态和数据权限</p>
      </section>
    </main>
  );
}

export function LoginScreen({ onSignIn, onRequestPasswordReset, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalError("");
    setSuccess("");
    try {
      if (resetMode) {
        await onRequestPasswordReset(email.trim());
        setSuccess("密码设置邮件已发送，请查看邮箱并点击最新邮件中的链接。");
      } else {
        await onSignIn(email.trim(), password);
      }
    } catch (signInError) {
      setLocalError(signInError.message === "Invalid login credentials" ? "邮箱或密码错误" : signInError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <img src={logo} alt="科杰科技 KeenData" />
        <div className="auth-card__title">
          <span><SafetyCertificateOutlined /></span>
          <div><p>KEENDATA SALES OPERATIONS</p><h1>营销作战地图</h1></div>
        </div>
        <p className="auth-card__intro">{resetMode ? "输入受邀邮箱，我们会发送一封新的密码设置邮件。" : "使用企业账号登录。项目、客户及联系人数据将按岗位权限隔离。"}</p>
        <form onSubmit={submit}>
          <label><span>企业邮箱</span><div><UserOutlined /><input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></div></label>
          {!resetMode && <label><span>密码</span><div><LockOutlined /><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></div></label>}
          {(localError || error) && <p className="auth-error" role="alert">{localError || error}</p>}
          {success && <p className="auth-success" role="status">{success}</p>}
          <button type="submit" disabled={submitting}>{submitting ? "正在处理…" : resetMode ? "发送密码设置邮件" : "安全登录"}</button>
          <div className="auth-form-options"><button type="button" onClick={() => { setResetMode((current) => !current); setLocalError(""); setSuccess(""); }}>{resetMode ? "返回登录" : "首次登录或忘记密码？"}</button></div>
        </form>
        <footer><LockOutlined /> 数据传输加密 · 数据库行级权限 · 全量操作审计</footer>
      </section>
    </main>
  );
}

export function PasswordSetupScreen({ onComplete, error, forced = false }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setLocalError("");
    if (password.length < 8) {
      setLocalError("密码至少需要 8 位字符");
      return;
    }
    if (password !== confirmation) {
      setLocalError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      await onComplete(password);
    } catch (setupError) {
      setLocalError(setupError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <img src={logo} alt="科杰科技 KeenData" />
        <div className="auth-card__title">
          <span><SafetyCertificateOutlined /></span>
          <div><p>ACCOUNT ACTIVATION</p><h1>设置登录密码</h1></div>
        </div>
        <p className="auth-card__intro">{forced ? "当前使用的是管理员生成的临时密码。请先设置不少于 8 位的新密码，完成后进入系统。" : "邀请已验证。请设置不少于 8 位的密码，完成后将直接进入营销作战地图。"}</p>
        <form onSubmit={submit}>
          <label><span>新密码</span><div><LockOutlined /><input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位字符" /></div></label>
          <label><span>确认新密码</span><div><LockOutlined /><input type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="请再次输入" /></div></label>
          {(localError || error) && <p className="auth-error" role="alert">{localError || error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? "正在保存…" : "保存密码并进入系统"}</button>
        </form>
        <footer><LockOutlined /> 密码由 Supabase Auth 加密管理，系统不会显示明文密码</footer>
      </section>
    </main>
  );
}

export function AccountBlockedScreen({ onSignOut }) {
  return (
    <main className="auth-screen">
      <section className="auth-card auth-card--blocked">
        <SafetyCertificateOutlined />
        <h1>账号当前不可用</h1>
        <p>请联系系统管理员确认账号状态与数据权限。</p>
        <button type="button" onClick={onSignOut}>退出登录</button>
      </section>
    </main>
  );
}

export function DataErrorScreen({ message, onRetry, onSignOut }) {
  return (
    <main className="auth-screen">
      <section className="auth-card auth-card--blocked">
        <SafetyCertificateOutlined />
        <h1>数据服务连接失败</h1>
        <p>{message || "请检查后端配置与网络状态。"}</p>
        <div className="auth-card__actions">{onRetry && <button type="button" onClick={onRetry}>重新连接</button>}{onSignOut && <button type="button" className="is-secondary" onClick={onSignOut}>退出登录</button>}</div>
      </section>
    </main>
  );
}
