import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeftOutlined,
  AudioOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DownloadOutlined,
  FileTextOutlined,
  LoadingOutlined,
  LogoutOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { useAuth } from "../auth/AuthProvider.jsx";
import { backendConfigured } from "../lib/supabase.js";
import {
  askMarketingData,
  createSalesReport,
  listSalesReports,
  loadMarketingDataJob,
  loadSalesReport,
  loadWorkspaceState,
  saveWorkspaceState,
} from "../services/backendRepository.js";
import { downloadSalesReportPdf } from "../services/reportPdf.js";

const GREETING = {
  role: "assistant",
  content: "你好，我是销售 Agent。你可以直接问经营进展、风险、项目、区域和负责人；我会基于你的数据权限给出结论。",
};

const SUGGESTIONS = [
  "本周最需要我关注的项目风险是什么？",
  "按负责人汇总加权管道和风险",
  "有哪些高价值项目近期没有客户行动？",
  "总结本周销售行动和需要领导支持的事项",
];

function normalizeMessages(messages) {
  return messages.slice(-40).map(({ role, content, meta, error, jobId, status }) => ({
    role,
    content,
    meta: meta || "",
    error: Boolean(error),
    jobId: jobId || "",
    status: status || "",
  }));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function reportLabel(report) {
  return `${report.reportType === "monthly" ? "月度" : "周度"}报告 · ${formatDate(report.periodStart)}—${formatDate(report.periodEnd)}`;
}

function MobileLogin() {
  const { signIn, requestPasswordReset, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [notice, setNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalError("");
    setNotice("");
    try {
      if (resetMode) {
        await requestPasswordReset(email.trim());
        setNotice("密码设置邮件已发送，请使用手机邮箱中最新的链接继续。");
      } else {
        await signIn(email.trim(), password);
      }
    } catch (loginError) {
      setLocalError(loginError.message === "Invalid login credentials" ? "邮箱或密码不正确" : loginError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mobile-login">
      <section className="mobile-login__brand">
        <span>KEENDATA</span>
        <h1>销售 Agent</h1>
        <p>面向管理层的移动 BI 分析</p>
      </section>
      <form className="mobile-login__form" onSubmit={submit}>
        <h2>{resetMode ? "找回登录密码" : "登录"}</h2>
        <p>{resetMode ? "输入受邀邮箱，我们会发送新的密码设置链接。" : "使用企业账号进入销售数据分析。"}</p>
        <label>企业邮箱<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>
        {!resetMode && <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>}
        {(localError || error) && <div className="mobile-form-error"><WarningFilled /> {localError || error}</div>}
        {notice && <div className="mobile-form-success"><CheckCircleFilled /> {notice}</div>}
        <button type="submit" disabled={submitting}>{submitting ? <LoadingOutlined spin /> : null}{resetMode ? "发送设置链接" : "安全登录"}</button>
        <button className="mobile-login__link" type="button" onClick={() => { setResetMode((value) => !value); setNotice(""); setLocalError(""); }}>{resetMode ? "返回登录" : "首次登录或忘记密码？"}</button>
      </form>
      <footer><SafetyCertificateOutlined /> 账号权限与营销作战地图保持一致</footer>
    </main>
  );
}

function VoiceButton({ onText, disabled }) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setUnsupported(true);
      window.setTimeout(() => setUnsupported(false), 3600);
      return;
    }
    let finalText = "";
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += text;
        else interimText += text;
      }
      onText(`${finalText}${interimText}`);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="voice-control">
      <button type="button" className={listening ? "is-listening" : ""} onClick={toggleVoice} disabled={disabled} aria-label={listening ? "结束语音输入" : "语音输入"}>
        {listening ? <StopOutlined /> : <AudioOutlined />}
      </button>
      {unsupported && <span>当前浏览器不支持语音输入</span>}
    </div>
  );
}

function ReportSheet({ report, onClose, onDownload, downloading }) {
  if (!report) return null;
  const isComplete = report.status === "completed";
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="mobile-report-sheet" role="dialog" aria-modal="true" aria-label="报告详情" onMouseDown={(event) => event.stopPropagation()}>
        <header><button type="button" onClick={onClose} aria-label="关闭报告"><CloseOutlined /></button><span>{reportLabel(report)}</span></header>
        <div className="mobile-report-sheet__body">
          <p className="report-sheet__scope">{report.dataScope || "当前权限数据"} · {report.projectCount ?? 0} 个项目</p>
          <h2>{report.title}</h2>
          {isComplete && report.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown || report.content.executiveSummary || "报告已生成"}</ReactMarkdown> : <div className="report-sheet__pending">{report.status === "failed" ? <><WarningFilled /> {report.error || "报告生成失败"}</> : <><LoadingOutlined spin /> 销售 Agent 正在生成报告，稍后会自动更新。</>}</div>}
        </div>
        {isComplete && <footer><button type="button" onClick={() => onDownload(report)} disabled={downloading}><DownloadOutlined /> {downloading ? "正在生成 PDF…" : "下载 PDF 报告"}</button></footer>}
      </section>
    </div>
  );
}

function MobileWorkspace({ profile, onSignOut }) {
  const [activeTab, setActiveTab] = useState("chat");
  const [messages, setMessages] = useState([GREETING]);
  const [question, setQuestion] = useState("");
  const [activeJobId, setActiveJobId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reports, setReports] = useState([]);
  const [activeReportIds, setActiveReportIds] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [generating, setGenerating] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");
  const messageEndRef = useRef(null);
  const historyQueueRef = useRef(Promise.resolve());
  const asking = submitting || Boolean(activeJobId);

  const persistMessages = (nextMessages) => {
    const payload = normalizeMessages(nextMessages);
    historyQueueRef.current = historyQueueRef.current.catch(() => undefined).then(() => saveWorkspaceState("marketing_qa_history", { messages: payload }, profile.id));
    return historyQueueRef.current;
  };

  const refreshReports = async () => {
    const nextReports = await listSalesReports();
    setReports(nextReports);
    setActiveReportIds(nextReports.filter((item) => ["pending", "processing"].includes(item.status)).map((item) => item.id));
  };

  useEffect(() => {
    let active = true;
    Promise.all([loadWorkspaceState("marketing_qa_history"), listSalesReports()])
      .then(([saved, savedReports]) => {
        if (!active) return;
        const savedMessages = Array.isArray(saved?.messages) ? saved.messages.filter((item) => item?.role && item?.content).slice(-40) : [];
        if (savedMessages.length) {
          setMessages(savedMessages);
          const pending = [...savedMessages].reverse().find((item) => item.jobId && ["pending", "processing"].includes(item.status));
          if (pending) setActiveJobId(pending.jobId);
        }
        setReports(savedReports);
        setActiveReportIds(savedReports.filter((item) => ["pending", "processing"].includes(item.status)).map((item) => item.id));
      })
      .catch(() => setNotice("部分历史记录暂时无法读取，请稍后刷新。"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, submitting]);

  useEffect(() => {
    if (!activeJobId) return undefined;
    let cancelled = false;
    let timer;
    const startTime = Date.now();
    const poll = async () => {
      try {
        const job = await loadMarketingDataJob(activeJobId);
        if (cancelled) return;
        if (["completed", "failed"].includes(job.status)) {
          setMessages((current) => {
            const next = current.map((item) => item.jobId === activeJobId ? {
              role: "assistant",
              content: job.status === "completed" ? job.answer : job.error || "销售 Agent 任务执行失败，请重试。",
              meta: job.status === "completed" ? `${job.dataScope} · ${job.projectCount} 个项目` : "任务失败",
              error: job.status === "failed",
              jobId: activeJobId,
              status: job.status,
            } : item);
            persistMessages(next).catch(() => undefined);
            return next;
          });
          setActiveJobId("");
          return;
        }
        if (Date.now() - startTime > 180000) {
          setNotice("分析仍在后台进行，稍后重新打开即可查看结果。");
          setActiveJobId("");
          return;
        }
        timer = window.setTimeout(poll, 2500);
      } catch {
        timer = window.setTimeout(poll, 4000);
      }
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeJobId]);

  useEffect(() => {
    if (!activeReportIds.length) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      const results = await Promise.allSettled(activeReportIds.map((id) => loadSalesReport(id)));
      if (cancelled) return;
      const received = results.filter((item) => item.status === "fulfilled").map((item) => item.value);
      if (received.length) {
        setReports((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          received.forEach((item) => byId.set(item.id, item));
          return Array.from(byId.values()).sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)));
        });
        setSelectedReport((current) => current ? received.find((item) => item.id === current.id) || current : null);
      }
      const pendingIds = received.filter((item) => ["pending", "processing"].includes(item.status)).map((item) => item.id);
      setActiveReportIds(pendingIds);
      if (pendingIds.length) timer = window.setTimeout(poll, 3000);
    };
    poll().catch(() => { timer = window.setTimeout(poll, 4500); });
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeReportIds.join("|")]);

  const submitQuestion = async (value = question) => {
    const content = value.trim();
    if (!content || asking) return;
    const nextMessages = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setQuestion("");
    setSubmitting(true);
    persistMessages(nextMessages).catch(() => undefined);
    try {
      const task = await askMarketingData(content, messages);
      const pending = [...nextMessages, { role: "assistant", content: "正在分析当前权限范围内的数据…", meta: "后台任务已提交", jobId: task.jobId, status: task.status || "pending" }];
      setMessages(pending);
      await persistMessages(pending);
      setActiveJobId(task.jobId);
    } catch (error) {
      const failed = [...nextMessages, { role: "assistant", content: error.message || "任务提交失败，请稍后重试。", error: true }];
      setMessages(failed);
      persistMessages(failed).catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const generateReport = async (reportType) => {
    setGenerating(reportType);
    try {
      const task = await createSalesReport(reportType);
      const pending = { id: task.reportId, reportType, periodStart: task.periodStart, periodEnd: task.periodEnd, title: task.title, status: task.status || "pending", content: null, projectCount: 0 };
      setReports((current) => [pending, ...current.filter((item) => item.id !== pending.id)]);
      setSelectedReport(pending);
      setActiveReportIds((current) => Array.from(new Set([...current, task.reportId])));
    } catch (error) {
      setNotice(error.message || "报告任务创建失败，请稍后重试。 ");
    } finally {
      setGenerating("");
    }
  };

  const downloadReport = async (report) => {
    setDownloading(true);
    try {
      await downloadSalesReportPdf(report);
    } catch (error) {
      setNotice(error.message || "PDF 下载失败，请稍后重试。 ");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="mobile-agent">
      <header className="mobile-agent__header">
        <div className="mobile-agent__brand"><span>KEENDATA</span><strong>销售 Agent</strong></div>
        <button className="mobile-agent__profile" type="button" onClick={onSignOut} title="退出登录" aria-label="退出登录"><span>{(profile.display_name || "管").slice(0, 1)}</span><MoreOutlined /></button>
      </header>
      <nav className="mobile-tabs" aria-label="主导航"><button type="button" className={activeTab === "chat" ? "is-active" : ""} onClick={() => setActiveTab("chat")}><RobotOutlined /> 对话</button><button type="button" className={activeTab === "reports" ? "is-active" : ""} onClick={() => setActiveTab("reports")}><FileTextOutlined /> 报告</button></nav>
      {notice && <div className="mobile-notice"><span>{notice}</span><button type="button" onClick={() => setNotice("")}><CloseOutlined /></button></div>}

      {activeTab === "chat" ? <section className="mobile-chat">
        <div className="mobile-chat__intro"><h1>今天想了解什么？</h1><p>基于实时销售数据，为你梳理经营进展、风险和下一步。</p></div>
        <div className="mobile-suggestions">{SUGGESTIONS.map((item) => <button type="button" key={item} disabled={asking} onClick={() => submitQuestion(item)}>{item}</button>)}</div>
        <div className="mobile-chat__messages">
          {messages.map((message, index) => <article className={`mobile-message mobile-message--${message.role} ${message.error ? "is-error" : ""}`} key={`${message.role}-${index}`}><span className="mobile-message__avatar">{message.role === "assistant" ? <RobotOutlined /> : <UserOutlined />}</span><div>{message.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <p>{message.content}</p>}{message.meta && <small>{message.meta}</small>}</div></article>)}
          {submitting && <article className="mobile-message mobile-message--assistant"><span className="mobile-message__avatar"><RobotOutlined /></span><div><p><LoadingOutlined spin /> 正在提交问题…</p></div></article>}
          <div ref={messageEndRef} />
        </div>
        <form className="mobile-composer" onSubmit={(event) => { event.preventDefault(); submitQuestion(); }}>
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitQuestion(); } }} placeholder="输入问题，或使用语音输入" rows="1" />
          <VoiceButton disabled={asking} onText={setQuestion} />
          <button type="submit" className="mobile-send" disabled={asking || !question.trim()} aria-label="发送"><SendOutlined /></button>
          <small>销售数据受企业权限保护</small>
        </form>
      </section> : <section className="mobile-reports">
        <div className="mobile-reports__intro"><span>销售经营报告</span><h1>随时获取经营结论</h1><p>报告覆盖项目行动、风险、热冷项目与管理建议。</p></div>
        <div className="mobile-report-actions"><button type="button" onClick={() => generateReport("weekly")} disabled={Boolean(generating)}><FileTextOutlined /> {generating === "weekly" ? "正在生成…" : "生成本周报告"}</button><button type="button" onClick={() => generateReport("monthly")} disabled={Boolean(generating)}><PlusOutlined /> {generating === "monthly" ? "正在生成…" : "生成本月报告"}</button></div>
        <div className="mobile-report-list">{reports.length ? reports.map((report) => <button className={`mobile-report-card status-${report.status}`} type="button" key={report.id} onClick={() => setSelectedReport(report)}><div><span>{reportLabel(report)}</span><strong>{report.title}</strong><small>{report.status === "completed" ? `${report.dataScope || "当前权限数据"} · ${report.projectCount ?? 0} 个项目` : report.status === "failed" ? report.error || "生成失败" : "正在后台生成"}</small></div>{report.status === "completed" ? <DownloadOutlined /> : report.status === "failed" ? <WarningFilled /> : <LoadingOutlined spin />}</button>) : <div className="mobile-report-empty"><FileTextOutlined /><strong>还没有报告</strong><span>可先生成一份本周报告，之后会在这里保留并支持下载。</span></div>}</div>
      </section>}
      <ReportSheet report={selectedReport} onClose={() => setSelectedReport(null)} onDownload={downloadReport} downloading={downloading} />
    </main>
  );
}

export function MobileSalesAgent() {
  const { loading, session, profile, error, signOut } = useAuth();
  if (!backendConfigured) return <main className="mobile-state"><WarningFilled /><h1>服务尚未配置</h1><p>请在部署环境中配置安全的数据服务连接。</p></main>;
  if (loading) return <main className="mobile-state"><LoadingOutlined spin /><p>正在安全连接数据服务…</p></main>;
  if (!session) return <MobileLogin />;
  if (error || !profile?.active) return <main className="mobile-state"><WarningFilled /><h1>账号当前不可用</h1><p>{error || "请联系系统管理员确认账号状态和数据权限。"}</p><button type="button" onClick={signOut}><LogoutOutlined /> 退出登录</button></main>;
  return <MobileWorkspace profile={profile} onSignOut={signOut} />;
}
