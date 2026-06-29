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

export function LoginScreen({ onSignIn, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalError("");
    try {
      await onSignIn(email.trim(), password);
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
        <p className="auth-card__intro">使用企业账号登录。项目、客户及联系人数据将按岗位权限隔离。</p>
        <form onSubmit={submit}>
          <label><span>企业邮箱</span><div><UserOutlined /><input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></div></label>
          <label><span>密码</span><div><LockOutlined /><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></div></label>
          {(localError || error) && <p className="auth-error" role="alert">{localError || error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? "正在验证…" : "安全登录"}</button>
        </form>
        <footer><LockOutlined /> 数据传输加密 · 数据库行级权限 · 全量操作审计</footer>
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
        <div className="auth-card__actions"><button type="button" onClick={onRetry}>重新连接</button><button type="button" className="is-secondary" onClick={onSignOut}>退出登录</button></div>
      </section>
    </main>
  );
}
