import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AimOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  FilterOutlined,
  FullscreenOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  LoadingOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoreOutlined,
  PieChartOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  TableOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { ChinaBattleMap, EChart } from "./ECharts.jsx";
import { useAuth } from "./auth/AuthProvider.jsx";
import { AccountBlockedScreen, AppLoadingScreen, DataErrorScreen, LoginScreen, PasswordSetupScreen } from "./components/AuthScreens.jsx";
import {
  BUSINESS_REGIONS,
  CATEGORY_META,
  ROLE_PRESETS,
  STAGES,
} from "./data.js";
import {
  buildDrillPath,
  createRegionBoundary,
  getBoundaryRequest,
  getProjectAdcode,
  isDrillItemInRegion,
  loadBoundary,
  nextDrillItem,
  projectMatchesMapScope,
  resolveAdministrativeLocation,
} from "./services/mapService.js";
import { parseImportCsv } from "./services/importService.js";
import {
  askMarketingData,
  analyzeDailyReport,
  createBackendUser,
  importDailyReport,
  loadBackendData,
  loadDirectory,
  loadWorkspaceState,
  loadProjectActivities,
  loadProjectDailyReports,
  importBackendProjects,
  saveBackendProject,
  saveWeeklyUpdate,
  saveWorkspaceState,
  setBackendUserActive,
  softDeleteBackendProjects,
  updateBackendAlerts,
  updateAlertRule,
  clearWorkspaceState,
} from "./services/backendRepository.js";
import logo from "./assets/keendata-logo.png";

const NAV_ITEMS = [
  { key: "map", label: "作战地图", icon: EnvironmentOutlined },
  { key: "workbench", label: "数据工作台", icon: AppstoreOutlined },
  { key: "analysis", label: "BI 分析", icon: BarChartOutlined },
  { key: "management", label: "数据管理", icon: DatabaseOutlined },
  { key: "alerts", label: "提醒中心", icon: BellOutlined },
  { key: "system", label: "系统管理", icon: SettingOutlined },
];

const HEALTH_META = {
  green: { label: "正常", color: "#18a879" },
  yellow: { label: "关注", color: "#f49b22" },
  red: { label: "高风险", color: "#ef4d4d" },
  gray: { label: "暂停", color: "#8a98ac" },
};

function formatMoney(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function formatDateTime(value, fallback = "暂无数据") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
}

function isSameLocalDay(value, reference = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

function isInCurrentWeek(value, reference = new Date()) {
  if (!value) return false;
  const start = new Date(reference);
  const weekday = (start.getDay() + 6) % 7;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - weekday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const date = new Date(value);
  return date >= start && date < end;
}

function dateInputValue(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStart(value = new Date()) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateInputValue(date);
}

function shiftWeek(weekStart, amount) {
  const date = new Date(`${weekStart}T12:00:00`);
  date.setDate(date.getDate() + amount * 7);
  return dateInputValue(date);
}

function formatWeekRange(weekStart) {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
  return `${formatter.format(start)}—${formatter.format(end)}`;
}

function createActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatProjectLocation(project) {
  const municipality = ["上海", "重庆"].includes(project.province);
  return municipality
    ? `${project.province}市${project.district}`
    : `${project.province}省${project.city}市${project.district}`;
}

function getStage(stageKey) {
  return STAGES.find((stage) => stage.key === stageKey) ?? STAGES[0];
}

function exportCsv(filename, rows, headers) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = [
    headers.map((header) => escape(header.label)).join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header.key])).join(",")),
  ].join("\n");
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function IconButton({ label, children, onClick, className = "", disabled = false }) {
  return (
    <button
      className={`icon-button ${className}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, type = "button", className = "", disabled = false }) {
  return (
    <button className={`primary-button ${className}`} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, type = "button", className = "", disabled = false }) {
  return (
    <button className={`ghost-button ${className}`} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function StatusPill({ health }) {
  const meta = HEALTH_META[health] ?? HEALTH_META.gray;
  return (
    <span className="status-pill" style={{ "--status-color": meta.color }}>
      <span />
      {meta.label}
    </span>
  );
}

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(onClose, 2600);
    return () => window.clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.type ?? "success"}`} role="status">
      {toast.type === "error" ? <InfoCircleOutlined /> : <CheckCircleFilled />}
      <span>{toast.message}</span>
    </div>
  );
}

function Modal({ title, children, onClose, width = 620 }) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <p>营销作战地图</p>
            <h2>{title}</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <CloseOutlined />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

function Sidebar({ activePage, setActivePage, roleKey, setRoleKey, alertsCount, collapsed, setCollapsed, currentUser, productionMode, onSignOut }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const currentRole = { ...ROLE_PRESETS[roleKey], user: currentUser?.display_name ?? "用户" };

  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand">
        <img src={logo} alt="科杰科技 KeenData" />
        <IconButton label={collapsed ? "展开导航" : "收起导航"} onClick={() => setCollapsed((value) => !value)}>
          <MenuOutlined />
        </IconButton>
      </div>
      <nav className="sidebar__nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const badge = item.key === "alerts" ? alertsCount : 0;
          return (
            <button
              className={activePage === item.key ? "is-active" : ""}
              type="button"
              key={item.key}
              onClick={() => setActivePage(item.key)}
              title={item.label}
            >
              <Icon />
              <span>{item.label}</span>
              {badge > 0 && <b>{badge}</b>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar__profile">
        <button type="button" onClick={() => setProfileOpen((value) => !value)}>
          <span className="avatar">{currentRole.user.slice(0, 1)}</span>
          <span className="profile-copy">
            <strong>{currentRole.user}</strong>
            <small>{currentRole.label}</small>
          </span>
          <DownOutlined />
        </button>
        {profileOpen && (
          <div className="profile-menu">
            <p>{productionMode ? "当前登录账号" : "切换权限视角"}</p>
            {productionMode ? (
              <button type="button" onClick={onSignOut}>
                <span><strong>退出登录</strong><small>{currentUser?.email}</small></span>
                <LogoutOutlined />
              </button>
            ) : Object.entries(ROLE_PRESETS).map(([key, preset]) => (
              <button
                type="button"
                key={key}
                className={key === roleKey ? "is-selected" : ""}
                onClick={() => {
                  setRoleKey(key);
                  setProfileOpen(false);
                }}
              >
                <span>
                  <strong>{preset.label}</strong>
                  <small>{preset.scope}</small>
                </span>
                {key === roleKey && <CheckOutlined />}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function Metric({ label, value, suffix = "", trend, inverse = false }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {value}
        {suffix && <small>{suffix}</small>}
      </strong>
      {trend !== undefined && (
        <em className={inverse ? "trend trend--danger" : "trend"}>
          <RiseOutlined /> {trend}
        </em>
      )}
    </div>
  );
}

function MapCommandPanel({
  projects,
  layers,
  setLayers,
  alerts,
  onSelectAlert,
  onOpenAlerts,
  onRefresh,
  dataUpdatedAt,
}) {
  const activeProjects = projects.filter((project) => project.stage !== "won");
  const highValue = projects.filter((project) => project.amount >= 5000).length;
  const expected = projects.reduce((sum, project) => sum + project.amount * (getStage(project.stage).probability / 100), 0);
  const won = projects.filter((project) => project.stage === "won").length;
  const winRate = projects.length ? Math.round((won / projects.length) * 100) : 0;
  const now = new Date();
  const monthNew = projects.filter((project) => {
    const createdAt = new Date(project.createdAt);
    return createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth();
  }).length;

  return (
    <aside className="command-panel">
      <div className="command-panel__heading">
        <div>
          <h1>营销作战总览</h1>
          <p>数据截至：{dataUpdatedAt}</p>
        </div>
        <button type="button" className="icon-button" aria-label="刷新数据" title="刷新数据" onClick={onRefresh}><ReloadOutlined /></button>
      </div>
      <div className="metric-grid">
        <Metric label="项目总数" value={projects.length} />
        <Metric label="预计成交（万元）" value={formatMoney(expected)} />
        <Metric label="本月新增项目" value={monthNew} />
        <Metric label="推进中项目" value={activeProjects.length} />
        <Metric label="高价值项目（≥500万）" value={highValue} />
        <Metric label="当前项目赢单率" value={winRate} suffix="%" />
      </div>

      <section className="command-section">
        <header>
          <h2>资源筛选</h2>
          <button type="button" onClick={() => setLayers(Object.fromEntries(Object.keys(layers).map((key) => [key, true])))}>
            全选
          </button>
        </header>
        <div className="layer-list">
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const count = projects.filter((project) => project.category === key).length;
            return (
              <button
                type="button"
                key={key}
                className={layers[key] ? "is-on" : ""}
                onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
              >
                <i style={{ "--category-color": meta.color }}>{meta.short}</i>
                <span>{meta.label}</span>
                <b>{count}</b>
                <RightOutlined />
              </button>
            );
          })}
        </div>
      </section>

      <section className="command-section command-section--alerts">
        <header>
          <h2>待处理提醒</h2>
          <button type="button" onClick={onOpenAlerts}>全部查看（{alerts.filter((alert) => alert.status === "待处理").length}）</button>
        </header>
        <div className="mini-alert-list">
          {alerts.filter((alert) => alert.status === "待处理").slice(0, 3).map((alert) => (
            <button type="button" key={alert.id} onClick={() => onSelectAlert(alert)}>
              <i className={`alert-dot alert-dot--${alert.level}`}>
                {alert.level === "red" ? <WarningFilled /> : <InfoCircleOutlined />}
              </i>
              <span>
                <strong>{alert.title}</strong>
                <small>{alert.description}</small>
              </span>
              <time>{alert.time}</time>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function ProjectDrawer({ project, onClose, onOpenDetails }) {
  if (!project) return null;
  const stage = getStage(project.stage);
  const category = CATEGORY_META[project.category];
  return (
    <aside className="project-drawer" aria-label={`${project.name}项目摘要`}>
      <header>
        <i style={{ "--category-color": category.color }}>{category.short}</i>
        <div>
          <div>
            <h2>{project.name}</h2>
            <b>{project.priority}</b>
          </div>
          <p>
            <EnvironmentOutlined /> {formatProjectLocation(project)}
          </p>
        </div>
        <IconButton label="关闭项目详情" onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </header>
      <dl>
        <div>
          <dt>项目阶段</dt>
          <dd>{stage.label}</dd>
        </div>
        <div>
          <dt>负责人</dt>
          <dd>{project.owner}</dd>
        </div>
        <div>
          <dt>下一步动作</dt>
          <dd>{project.nextAction || "未填写"}{project.nextActionDate ? `（${project.nextActionDate.slice(5)}）` : ""}</dd>
        </div>
        <div>
          <dt>预计成交</dt>
          <dd className="money">{formatMoney(project.amount)} 万元</dd>
        </div>
        <div>
          <dt>风险</dt>
          <dd>
            <StatusPill health={project.health} /> {project.risk}
          </dd>
        </div>
      </dl>
      <PrimaryButton onClick={onOpenDetails}>查看项目详情 <RightOutlined /></PrimaryButton>
    </aside>
  );
}

function PipelineBar({ projects }) {
  return (
    <section className="pipeline-bar">
      <header>
        <h2>销售流程总览 <small>（当前可见项目）</small></h2>
        <p>加权管道 <strong>{formatMoney(projects.reduce((sum, p) => sum + p.amount * getStage(p.stage).probability / 100, 0))}</strong> 万元</p>
      </header>
      <div className="pipeline-steps">
        {STAGES.map((stage, index) => {
          const count = projects.filter((project) => project.stage === stage.key).length;
          return (
            <div className={count ? "has-data" : ""} key={stage.key}>
              <span>{count}</span>
              <i />
              <strong>{stage.label}</strong>
              <small>{count} 个</small>
              {index < STAGES.length - 1 && <b />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MapToolbar({ search, setSearch, regionMode, setRegionMode, layersOpen, setLayersOpen, filtersOpen, setFiltersOpen, alertsOpen, setAlertsOpen, currentUserName = "用户", alertsCount = 0 }) {
  return (
    <div className="map-toolbar">
      <div className="segmented-control">
        {["全国", "华东", "西南", "北京", "其他"].map((mode) => (
          <button key={mode} type="button" className={regionMode === mode ? "is-active" : ""} onClick={() => setRegionMode(mode)}>{mode}</button>
        ))}
      </div>
      <div className="toolbar-actions">
        <button type="button" className={layersOpen ? "is-active" : ""} onClick={() => setLayersOpen((value) => !value)}>
          <TableOutlined /> 图层
        </button>
        <button type="button" className={filtersOpen ? "is-active" : ""} onClick={() => setFiltersOpen((value) => !value)}>
          <FilterOutlined /> 筛选
        </button>
        <label className="map-search">
          <SearchOutlined />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目 / 客户 / 区县" />
        </label>
      </div>
      <div className="map-toolbar__profile">
        <button type="button" onClick={() => setAlertsOpen((value) => !value)} aria-label="打开通知">
          <BellOutlined />
          {alertsCount > 0 && <b>{alertsCount}</b>}
        </button>
        <span className="avatar avatar--small">{currentUserName.slice(0, 1)}</span>
        <strong>{currentUserName}</strong>
        <DownOutlined />
      </div>
    </div>
  );
}

function MapPage({ projects, alerts, onSelectProject, selectedProjectId, onGoToProject, onOpenAlerts, onRefresh, roleKey, currentUserName }) {
  const [layers, setLayers] = useState(Object.fromEntries(Object.keys(CATEGORY_META).map((key) => [key, true])));
  const [search, setSearch] = useState("");
  const [regionMode, setRegionMode] = useState("全国");
  const [drillPath, setDrillPath] = useState([]);
  const [geoJson, setGeoJson] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [mapReloadToken, setMapReloadToken] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [regionFilter, setRegionFilter] = useState("全部区域");
  const [healthFilter, setHealthFilter] = useState("全部健康度");
  const [ownerFilter, setOwnerFilter] = useState("全部销售");
  const [fullScreen, setFullScreen] = useState(false);
  const mapTransitioningRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const request = getBoundaryRequest(drillPath);
    mapTransitioningRef.current = true;
    setMapLoading(true);
    setMapError("");
    loadBoundary(request.adcode, { full: request.full, signal: controller.signal })
      .then((boundary) => {
        if (controller.signal.aborted) return;
        setGeoJson(drillPath.length ? boundary : createRegionBoundary(boundary, regionMode));
        setMapLoading(false);
        mapTransitioningRef.current = false;
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMapError(error.message || "地图边界加载失败");
        setMapLoading(false);
        mapTransitioningRef.current = false;
      });
    return () => controller.abort();
  }, [drillPath, mapReloadToken, regionMode]);

  const filteredProjects = useMemo(() => {
    let rows = projects.filter((project) => layers[project.category]);
    rows = rows.filter((project) => projectMatchesMapScope(project, regionMode, drillPath));
    if (search.trim()) {
      const keyword = search.trim().toLowerCase();
      rows = rows.filter((project) => [project.name, project.account, project.city, project.district].join(" ").toLowerCase().includes(keyword));
    }
    if (regionFilter !== "全部区域") rows = rows.filter((project) => project.region === regionFilter);
    if (healthFilter !== "全部健康度") rows = rows.filter((project) => project.health === healthFilter);
    if (ownerFilter !== "全部销售") rows = rows.filter((project) => project.ownerId === ownerFilter);
    return rows;
  }, [projects, layers, search, regionMode, drillPath, regionFilter, healthFilter, ownerFilter]);

  const ownerOptions = useMemo(() => Array.from(new Map(projects.map((project) => [project.ownerId, project.owner])).entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-CN")), [projects]);

  const latestUpdate = projects.reduce((latest, project) => {
    const timestamp = new Date(project.updatedAtIso || 0).getTime();
    return timestamp > latest ? timestamp : latest;
  }, 0);

  const selectedProject = filteredProjects.find((project) => project.id === selectedProjectId);
  const currentMapLevel = drillPath.at(-1)?.level ?? (regionMode === "全国" ? "country" : "region");

  const changeRegion = useCallback((mode) => {
    if (mode === regionMode && drillPath.length === 0) return;
    mapTransitioningRef.current = true;
    setMapLoading(true);
    setMapError("");
    setRegionMode(mode);
    setDrillPath([]);
    onSelectProject(null);
  }, [drillPath.length, onSelectProject, regionMode]);

  const drillInto = useCallback((properties) => {
    const next = nextDrillItem(properties);
    if (!next || mapLoading || mapError || mapTransitioningRef.current || drillPath.at(-1)?.level === "district") return;
    if (!isDrillItemInRegion(next, regionMode)) return;
    const nextPath = buildDrillPath(drillPath, next);
    if (nextPath === drillPath) return;
    mapTransitioningRef.current = true;
    setMapLoading(true);
    setDrillPath(nextPath);
    onSelectProject(null);
  }, [drillPath, mapError, mapLoading, onSelectProject, regionMode]);

  const goToCrumb = useCallback((index) => {
    mapTransitioningRef.current = true;
    setMapLoading(true);
    setMapError("");
    setDrillPath((current) => current.slice(0, index + 1));
    onSelectProject(null);
  }, [onSelectProject]);

  const goToRoot = useCallback(() => {
    if (!drillPath.length && !mapError) return;
    mapTransitioningRef.current = true;
    setMapLoading(true);
    setMapError("");
    setDrillPath([]);
    onSelectProject(null);
  }, [drillPath.length, mapError, onSelectProject]);

  const goBackOneLevel = useCallback(() => {
    if (!drillPath.length) {
      mapTransitioningRef.current = true;
      setMapLoading(true);
      setMapError("");
      setMapReloadToken((value) => value + 1);
      onSelectProject(null);
      return;
    }
    mapTransitioningRef.current = true;
    setMapLoading(true);
    setMapError("");
    setDrillPath((current) => current.slice(0, -1));
    onSelectProject(null);
  }, [drillPath.length, onSelectProject]);

  return (
    <div className={`map-page ${fullScreen ? "map-page--fullscreen" : ""}`}>
      <MapCommandPanel
        projects={projects}
        layers={layers}
        setLayers={setLayers}
        alerts={alerts}
        dataUpdatedAt={latestUpdate ? formatDateTime(latestUpdate) : "暂无项目数据"}
        onSelectAlert={(alert) => onSelectProject(alert.projectId)}
        onOpenAlerts={onOpenAlerts}
        onRefresh={onRefresh}
      />
      <main className="map-stage">
        <MapToolbar
          search={search}
          setSearch={setSearch}
          regionMode={regionMode}
          setRegionMode={changeRegion}
          layersOpen={layersOpen}
          setLayersOpen={setLayersOpen}
          filtersOpen={filtersOpen}
          setFiltersOpen={setFiltersOpen}
          alertsOpen={alertsOpen}
          setAlertsOpen={setAlertsOpen}
          currentUserName={currentUserName}
          alertsCount={alerts.filter((alert) => alert.status === "待处理").length}
        />
        <div className="map-breadcrumb">
          <button type="button" onClick={() => changeRegion("全国")}>中国</button>
          <RightOutlined />
          <button type="button" className={!drillPath.length ? "is-current" : ""} onClick={goToRoot}>
            {regionMode === "全国" ? "全国" : `${regionMode}区域`}
          </button>
          {drillPath.map((item, index) => (
            <span key={item.adcode}>
              <RightOutlined />
              <button type="button" className={index === drillPath.length - 1 ? "is-current" : ""} onClick={() => goToCrumb(index)}>{item.name}</button>
            </span>
          ))}
          <em>{ROLE_PRESETS[roleKey].scope}</em>
        </div>
        <div className="map-canvas">
          <ChinaBattleMap
            projects={filteredProjects}
            selectedProjectId={selectedProjectId}
            onSelectProject={onSelectProject}
            onDrill={drillInto}
            geoJson={geoJson}
            mapKey={`${regionMode}-${drillPath.map((item) => item.adcode).join("-") || "root"}`}
            level={currentMapLevel}
            drillDisabled={mapLoading || Boolean(mapError)}
          />
          {mapLoading && <div className="map-state"><LoadingOutlined spin /><strong>正在加载行政区边界</strong><span>支持省、市、区县逐级下钻</span></div>}
          {mapError && <div className="map-state map-state--error"><InfoCircleOutlined /><strong>{mapError}</strong><button type="button" onClick={() => setMapReloadToken((value) => value + 1)}>重新加载</button></div>}
          {!mapLoading && !mapError && currentMapLevel !== "district" && (
            <div className="map-drill-hint"><AimOutlined /> 点击地图进入下一级</div>
          )}
          <div className="map-controls">
            <IconButton label="全屏" onClick={() => setFullScreen((value) => !value)}><FullscreenOutlined /></IconButton>
            <IconButton label={drillPath.length ? "返回上一级" : "定位到当前区域"} onClick={goBackOneLevel}><AimOutlined /></IconButton>
          </div>
          <div className="map-legend">
            <strong>项目价值</strong>
            <span><i className="legend-dot legend-dot--high" />高价值项目（≥500万）</span>
            <span><i className="legend-dot legend-dot--mid" />中价值项目（100–500万）</span>
            <span><i className="legend-dot legend-dot--low" />培育项目（＜100万）</span>
          </div>
          {layersOpen && (
            <div className="map-popover map-popover--layers">
              <header><strong>地图图层</strong><button type="button" aria-label="关闭地图图层" onClick={() => setLayersOpen(false)}><CloseOutlined /></button></header>
              {Object.entries(CATEGORY_META).map(([key, meta]) => (
                <label key={key}>
                  <span><i style={{ background: meta.color }} />{meta.label}</span>
                  <input type="checkbox" checked={layers[key]} onChange={() => setLayers((current) => ({ ...current, [key]: !current[key] }))} />
                </label>
              ))}
            </div>
          )}
          {filtersOpen && (
            <div className="map-popover map-popover--filters">
              <header><strong>组合筛选</strong><button type="button" aria-label="关闭组合筛选" onClick={() => setFiltersOpen(false)}><CloseOutlined /></button></header>
              <label>经营区域<select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}><option>全部区域</option>{BUSINESS_REGIONS.map((region) => <option key={region}>{region}</option>)}</select></label>
              <label>销售负责人<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="全部销售">全部销售</option>{ownerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label>项目健康度<select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}><option>全部健康度</option><option value="green">正常</option><option value="yellow">关注</option><option value="red">高风险</option></select></label>
              <GhostButton onClick={() => { setRegionFilter("全部区域"); setHealthFilter("全部健康度"); setOwnerFilter("全部销售"); }}>重置筛选</GhostButton>
            </div>
          )}
          {alertsOpen && (
            <div className="map-popover map-popover--notifications">
              <header><strong>最新通知</strong><button type="button" aria-label="关闭最新通知" onClick={() => setAlertsOpen(false)}><CloseOutlined /></button></header>
              {alerts.slice(0, 3).map((alert) => <button type="button" key={alert.id} onClick={() => { onSelectProject(alert.projectId); setAlertsOpen(false); }}><i className={`alert-dot alert-dot--${alert.level}`} /> <span><strong>{alert.title}</strong><small>{alert.time}</small></span></button>)}
            </div>
          )}
          <ProjectDrawer project={selectedProject} onClose={() => onSelectProject(null)} onOpenDetails={() => onGoToProject(selectedProject)} />
        </div>
        <PipelineBar projects={filteredProjects} />
      </main>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      <div className="page-header__actions">{actions}</div>
    </header>
  );
}

function ProjectForm({ initialProject, onSubmit, onCancel, users = [], saving = false, roleKey, currentUserId }) {
  const salesUsers = users.filter((user) => user.roleKey === "sales" || user.role === "销售" || user.role === "销售经理");
  const scopedSalesUsers = roleKey === "sales" ? salesUsers.filter((user) => user.id === currentUserId) : salesUsers;
  const ownerUsers = scopedSalesUsers.length ? scopedSalesUsers : salesUsers.length ? salesUsers : users;
  const defaultOwner = ownerUsers[0]?.name ?? "";
  const defaultPresales = users.find((user) => user.roleKey === "presales" || user.role === "售前")?.name ?? "";
  const [form, setForm] = useState(() => initialProject ? {
    ...initialProject,
    adcode: getProjectAdcode(initialProject),
    coordinates: initialProject.coordinates ?? [120.19, 30.19],
  } : {
    name: "",
    account: "",
    contactName: "",
    contactMobile: "",
    contactEmail: "",
    category: "government",
    region: "华东区域",
    province: "",
    city: "",
    district: "",
    adcode: "",
    coordinates: ["", ""],
    amount: 0,
    stage: "lead",
    owner: defaultOwner,
    presales: defaultPresales,
    health: "green",
    priority: "P2",
    nextAction: "",
    nextActionDate: "",
    expectedClose: "",
    source: "手工录入",
    risk: "",
  });
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateLocationField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value, adcode: "", coordinates: ["", ""] }));
    setLocationMessage("");
  };
  const locateByArea = async () => {
    setLocating(true);
    setLocationMessage("");
    try {
      const location = await resolveAdministrativeLocation({ province: form.province, city: form.city, district: form.district });
      setForm((current) => ({
        ...current,
        adcode: location.adcode,
        coordinates: location.coordinates,
        region: location.region ?? current.region,
      }));
      setLocationMessage(`已定位：${location.canonical.district}（${location.adcode}）`);
    } catch (error) {
      setLocationMessage(error.message || "定位失败");
    } finally {
      setLocating(false);
    }
  };

  return (
    <form className="project-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
      <div className="form-grid">
        <label className="span-2">项目名称<input required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="请输入项目名称" /></label>
        <label className="span-2">客户/资源主体<input required value={form.account} onChange={(event) => update("account", event.target.value)} placeholder="请输入客户名称" /></label>
        <label>关键联系人<input value={form.contactName ?? ""} onChange={(event) => update("contactName", event.target.value)} placeholder="可选" /></label>
        <label>联系人手机号<input type="tel" value={form.contactMobile ?? ""} onChange={(event) => update("contactMobile", event.target.value)} placeholder="机密数据" /></label>
        <label className="span-2">联系人邮箱<input type="email" value={form.contactEmail ?? ""} onChange={(event) => update("contactEmail", event.target.value)} placeholder="机密数据" /></label>
        <label>项目类型<select value={form.category} onChange={(event) => update("category", event.target.value)}>{Object.entries(CATEGORY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>
        <label>销售阶段<select value={form.stage} onChange={(event) => update("stage", event.target.value)}>{STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></label>
        <label>经营区域<select value={form.region} onChange={(event) => update("region", event.target.value)}>{BUSINESS_REGIONS.map((region) => <option key={region}>{region}</option>)}</select></label>
        <label>省份<input required value={form.province} onChange={(event) => updateLocationField("province", event.target.value)} /></label>
        <label>城市<input value={form.city} onChange={(event) => updateLocationField("city", event.target.value)} placeholder="直辖市可填写同名城市" /></label>
        <label>区县<div className="field-with-action"><input required value={form.district} onChange={(event) => updateLocationField("district", event.target.value)} /><button type="button" onClick={locateByArea} disabled={locating}>{locating ? "定位中" : "自动定位"}</button></div>{locationMessage && <small className="field-message">{locationMessage}</small>}</label>
        <label>行政区划代码<input required readOnly inputMode="numeric" pattern="[0-9]{6}" value={form.adcode} placeholder="自动生成" /></label>
        <label>商机金额（万元）<input type="number" min="0" value={form.amount} onChange={(event) => update("amount", Number(event.target.value))} /></label>
        <label>经度<input required type="number" step="0.000001" min="73" max="136" value={form.coordinates[0]} onChange={(event) => update("coordinates", [Number(event.target.value), form.coordinates[1]])} /></label>
        <label>纬度<input required type="number" step="0.000001" min="3" max="54" value={form.coordinates[1]} onChange={(event) => update("coordinates", [form.coordinates[0], Number(event.target.value)])} /></label>
        <label>负责人<select required value={form.owner} onChange={(event) => update("owner", event.target.value)}>{ownerUsers.map((user) => <option key={user.id}>{user.name}</option>)}</select></label>
        <label>售前负责人<select value={form.presales} onChange={(event) => update("presales", event.target.value)}><option value="">未分配</option>{users.filter((user) => user.roleKey === "presales" || user.role === "售前").map((user) => <option key={user.id}>{user.name}</option>)}</select></label>
        <label>健康度<select value={form.health} onChange={(event) => update("health", event.target.value)}><option value="green">正常</option><option value="yellow">关注</option><option value="red">高风险</option><option value="gray">暂停</option></select></label>
        <label>优先级<select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></label>
        <label className="span-2">下一步动作<input value={form.nextAction} onChange={(event) => update("nextAction", event.target.value)} /></label>
        <label>计划日期<input type="date" value={form.nextActionDate} onChange={(event) => update("nextActionDate", event.target.value)} /></label>
        <label>预计成交<input type="date" value={form.expectedClose} onChange={(event) => update("expectedClose", event.target.value)} /></label>
        <label>数据来源<input value={form.source} onChange={(event) => update("source", event.target.value)} placeholder="例如：手工录入、客户转介绍" /></label>
        <label className="span-2">风险说明<input value={form.risk} onChange={(event) => update("risk", event.target.value)} placeholder="如无已识别风险可留空" /></label>
      </div>
      <footer className="modal__footer">
        <GhostButton onClick={onCancel}>取消</GhostButton>
        <PrimaryButton type="submit" disabled={saving}>{saving ? <><LoadingOutlined spin /> 正在保存</> : <><SaveOutlined /> 保存项目</>}</PrimaryButton>
      </footer>
    </form>
  );
}

function ProjectActivityTimeline({ projectId, users }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadProjectActivities(projectId)
      .then((rows) => {
        if (!active) return;
        setActivities(rows);
        setError("");
      })
      .catch((activityError) => {
        if (!active) return;
        setError(activityError.message || "推进记录加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [projectId]);

  if (loading) return <p><LoadingOutlined spin /> 正在加载推进记录</p>;
  if (error) return <p className="danger-text">{error}</p>;
  if (!activities.length) return <p>暂无推进记录；后续项目更新会自动写入数据库。</p>;
  return (
    <ol>
      {activities.map((activity) => {
        const actor = users.find((user) => user.id === activity.created_by)?.name ?? "系统用户";
        return <li key={activity.id}><b>{formatDateTime(activity.occurred_at)}</b><span>{activity.content}<small>{actor}</small></span></li>;
      })}
    </ol>
  );
}

const DAILY_ACTIVITY_META = {
  visit: { label: "客户拜访", tone: "visit" },
  meeting: { label: "会议交流", tone: "meeting" },
  call: { label: "电话/微信", tone: "call" },
  proposal: { label: "方案材料", tone: "proposal" },
  task: { label: "任务推进", tone: "task" },
  note: { label: "其他记录", tone: "note" },
};

function ProjectDailyReportTimeline({ projectId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadProjectDailyReports(projectId)
      .then((rows) => {
        if (!active) return;
        setEntries(rows);
        setError("");
      })
      .catch((dailyError) => {
        if (!active) return;
        setError(dailyError.message || "日报记录加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [projectId]);

  if (loading) return <p><LoadingOutlined spin /> 正在加载日报记录</p>;
  if (error) return <p className="danger-text">{error}</p>;
  if (!entries.length) return <div className="daily-project-empty"><FileTextOutlined /><span><strong>暂无日报记录</strong><small>管理员导入日报并确认项目匹配后，客户触达会沉淀在这里。</small></span></div>;

  const visitCount = entries.filter((entry) => entry.activity_type === "visit").length;
  const contactCount = entries.filter((entry) => ["visit", "meeting", "call"].includes(entry.activity_type)).length;
  return (
    <div className="daily-project-records">
      <div className="daily-project-kpis">
        <div><span>日报记录</span><strong>{entries.length}</strong></div>
        <div><span>客户触达</span><strong>{contactCount}</strong></div>
        <div><span>现场拜访</span><strong>{visitCount}</strong></div>
        <div><span>最近触达</span><strong>{entries[0]?.report_date ?? "—"}</strong></div>
      </div>
      <ol>
        {entries.map((entry) => {
          const meta = DAILY_ACTIVITY_META[entry.activity_type] ?? DAILY_ACTIVITY_META.note;
          return (
            <li key={entry.id}>
              <time>{entry.report_date}</time>
              <i className={`daily-type daily-type--${meta.tone}`}>{meta.label}</i>
              <span>
                <strong>{entry.content}</strong>
                <small>{entry.salesperson?.display_name ?? "未识别销售"}{entry.customer_contact ? ` · 客户：${entry.customer_contact}` : ""}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DetailModal({ project, onClose, onEdit, users }) {
  const category = CATEGORY_META[project.category];
  const stage = getStage(project.stage);
  return (
    <Modal title="项目全景详情" onClose={onClose} width={760}>
      <div className="detail-modal">
        <section className="detail-hero">
          <i style={{ "--category-color": category.color }}>{category.short}</i>
          <div>
            <span>{project.code ?? project.id} · {category.label}</span>
            <h3>{project.name}</h3>
            <p>{project.account}</p>
          </div>
          <StatusPill health={project.health} />
        </section>
        <section className="detail-kpis">
          <div><span>商机金额</span><strong>{formatMoney(project.amount)} 万元</strong></div>
          <div><span>加权金额</span><strong>{formatMoney(project.amount * stage.probability / 100)} 万元</strong></div>
          <div><span>当前阶段</span><strong>{stage.label} · {stage.probability}%</strong></div>
          <div><span>负责人 / 售前</span><strong>{project.owner} / {project.presales}</strong></div>
        </section>
        <section className="detail-columns">
          <div>
            <h4>推进信息</h4>
            <dl><div><dt>下一步动作</dt><dd>{project.nextAction}</dd></div><div><dt>计划时间</dt><dd>{project.nextActionDate}</dd></div><div><dt>预计成交</dt><dd>{project.expectedClose}</dd></div><div><dt>来源</dt><dd>{project.source}</dd></div></dl>
          </div>
          <div>
            <h4>区域与风险</h4>
            <dl><div><dt>经营区域</dt><dd>{project.region}</dd></div><div><dt>行政区</dt><dd>{project.province} · {project.city} · {project.district}</dd></div><div><dt>项目风险</dt><dd>{project.risk}</dd></div><div><dt>最近更新</dt><dd>{project.updatedAt}</dd></div></dl>
          </div>
        </section>
        <section className="timeline">
          <h4>推进时间线</h4>
          <ProjectActivityTimeline projectId={project.id} users={users} />
        </section>
        <section className="daily-project-section">
          <header><div><p>DAILY REPORT RECORDS</p><h4>日报记录</h4></div><span>用于分析客户触达频次与成单周期</span></header>
          <ProjectDailyReportTimeline projectId={project.id} />
        </section>
      </div>
      <footer className="modal__footer">
        <GhostButton onClick={onClose}>关闭</GhostButton>
        <PrimaryButton onClick={() => onEdit(project)}><EditOutlined /> 编辑项目</PrimaryButton>
      </footer>
    </Modal>
  );
}

function FilterBar({ filters, setFilters, owners, onCreate, onExport, resultCount }) {
  return (
    <div className="filter-bar">
      <label className="standard-search"><SearchOutlined /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="搜索项目、客户、区县" /></label>
      <select value={filters.region} onChange={(event) => setFilters((current) => ({ ...current, region: event.target.value }))}><option>全部区域</option>{BUSINESS_REGIONS.map((region) => <option key={region}>{region}</option>)}</select>
      <select value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))}><option value="all">全部销售</option>{owners.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
      <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="all">全部类型</option>{Object.entries(CATEGORY_META).map(([key, meta]) => <option value={key} key={key}>{meta.label}</option>)}</select>
      <select value={filters.stage} onChange={(event) => setFilters((current) => ({ ...current, stage: event.target.value }))}><option value="all">全部阶段</option>{STAGES.map((stage) => <option value={stage.key} key={stage.key}>{stage.label}</option>)}</select>
      <span className="filter-result">共 {resultCount} 条</span>
      <GhostButton onClick={onExport}><DownloadOutlined /> 导出</GhostButton>
      <PrimaryButton onClick={onCreate}><PlusOutlined /> 新建项目</PrimaryButton>
    </div>
  );
}

function ProjectTable({ projects, selectedIds, setSelectedIds, onView, onEdit, onDelete }) {
  const allSelected = projects.length > 0 && projects.every((project) => selectedIds.includes(project.id));
  const toggleAll = () => setSelectedIds(allSelected ? [] : projects.map((project) => project.id));
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选" /></th><th>项目名称</th><th>资源类型</th><th>区域</th><th>负责人</th><th>当前阶段</th><th className="align-right">商机金额</th><th>健康度</th><th>下一步动作</th><th>操作</th></tr></thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td><input type="checkbox" checked={selectedIds.includes(project.id)} onChange={() => setSelectedIds((current) => current.includes(project.id) ? current.filter((id) => id !== project.id) : [...current, project.id])} aria-label={`选择${project.name}`} /></td>
              <td><button className="table-title" type="button" onClick={() => onView(project)}><strong>{project.name}</strong><small>{project.code ?? project.id} · {project.account}</small></button></td>
              <td><span className="category-badge" style={{ "--category-color": CATEGORY_META[project.category].color }}>{CATEGORY_META[project.category].label}</span></td>
              <td>{project.region}<small className="cell-subtext">{project.city} · {project.district}</small></td>
              <td>{project.owner}<small className="cell-subtext">售前：{project.presales}</small></td>
              <td><span className="stage-badge">{getStage(project.stage).label}</span></td>
              <td className="align-right"><strong>{formatMoney(project.amount)}</strong><small className="cell-subtext">万元</small></td>
              <td><StatusPill health={project.health} /></td>
              <td><span className="next-action">{project.nextAction}</span><small className="cell-subtext"><CalendarOutlined /> {project.nextActionDate}</small></td>
              <td><div className="row-actions"><IconButton label="查看" onClick={() => onView(project)}><EyeOutlined /></IconButton><IconButton label="编辑" onClick={() => onEdit(project)}><EditOutlined /></IconButton><IconButton label="删除" onClick={() => onDelete(project)}><DeleteOutlined /></IconButton></div></td>
            </tr>
          ))}
          {!projects.length && <tr><td colSpan="10"><div className="empty-state"><SearchOutlined /><strong>没有匹配的数据</strong><span>请调整筛选条件后重试</span></div></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function KanbanView({ projects, onView }) {
  return (
    <div className="kanban-board">
      {STAGES.slice(0, 5).map((stage) => {
        const rows = projects.filter((project) => project.stage === stage.key);
        return (
          <section key={stage.key}>
            <header><span>{stage.label}</span><b>{rows.length}</b></header>
            <div>{rows.map((project) => <button type="button" key={project.id} onClick={() => onView(project)}><span className="category-badge" style={{ "--category-color": CATEGORY_META[project.category].color }}>{CATEGORY_META[project.category].label}</span><strong>{project.name}</strong><small>{project.city} · {project.owner}</small><em>{formatMoney(project.amount)} 万元</em></button>)}</div>
          </section>
        );
      })}
    </div>
  );
}

function WeeklyUpdateView({ projects, weeklyUpdates, users, roleKey, currentUserId, currentUserName, onSave, onView }) {
  const salesUsers = users.filter((user) => user.roleKey === "sales" && user.status === "启用");
  const availableUsers = roleKey === "sales"
    ? [{ id: currentUserId, name: currentUserName, roleKey: "sales", status: "启用" }]
    : salesUsers;
  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [ownerId, setOwnerId] = useState(roleKey === "sales" ? currentUserId : availableUsers[0]?.id ?? currentUserId);
  const [saving, setSaving] = useState(false);
  const existing = weeklyUpdates.find((item) => item.ownerId === ownerId && item.weekStart === weekStart);
  const owner = availableUsers.find((user) => user.id === ownerId) ?? users.find((user) => user.id === ownerId);
  const ownerProjects = projects.filter((project) => project.ownerId === ownerId);
  const [draft, setDraft] = useState({ lastWeekSummary: "", thisWeekGoal: "", risks: "", supportNeeded: "", actions: [] });

  useEffect(() => {
    setDraft(existing ? {
      lastWeekSummary: existing.lastWeekSummary,
      thisWeekGoal: existing.thisWeekGoal,
      risks: existing.risks,
      supportNeeded: existing.supportNeeded,
      actions: existing.actions,
    } : { lastWeekSummary: "", thisWeekGoal: "", risks: "", supportNeeded: "", actions: [] });
  }, [existing?.id, existing?.updatedAt, ownerId, weekStart]);

  useEffect(() => {
    if (!availableUsers.some((user) => user.id === ownerId)) setOwnerId(availableUsers[0]?.id ?? currentUserId);
  }, [availableUsers, currentUserId, ownerId]);

  const weekEnd = shiftWeek(weekStart, 1);
  const actionProject = (action) => projects.find((project) => project.id === action.projectId);
  const actionStats = {
    total: draft.actions.length,
    done: draft.actions.filter((action) => action.status === "done").length,
    blocked: draft.actions.filter((action) => action.status === "blocked").length,
  };
  const updateAction = (id, field, value) => setDraft((current) => ({
    ...current,
    actions: current.actions.map((action) => action.id === id ? { ...action, [field]: value } : action),
  }));
  const addAction = () => setDraft((current) => ({
    ...current,
    actions: [...current.actions, {
      id: createActionId(),
      projectId: ownerProjects[0]?.id ?? "",
      title: ownerProjects[0]?.nextAction ?? "",
      dueDate: weekStart,
      status: "planned",
    }],
  }));
  const removeAction = (id) => setDraft((current) => ({ ...current, actions: current.actions.filter((action) => action.id !== id) }));
  const submit = async (status) => {
    if (status === "submitted" && !draft.thisWeekGoal.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...draft, ownerId, weekStart, status });
    } finally {
      setSaving(false);
    }
  };
  const groupedActions = draft.actions.reduce((result, action) => {
    const date = action.dueDate || weekStart;
    result[date] ??= [];
    result[date].push(action);
    return result;
  }, {});

  return (
    <div className="weekly-workspace">
      <header className="weekly-toolbar">
        <div className="weekly-period">
          <IconButton label="上一周" onClick={() => setWeekStart((current) => shiftWeek(current, -1))}><LeftOutlined /></IconButton>
          <div><strong>{formatWeekRange(weekStart)}</strong><span>{weekStart === getWeekStart() ? "本周" : weekStart}</span></div>
          <IconButton label="下一周" onClick={() => setWeekStart((current) => shiftWeek(current, 1))}><RightOutlined /></IconButton>
          {weekStart !== getWeekStart() && <GhostButton onClick={() => setWeekStart(getWeekStart())}>回到本周</GhostButton>}
        </div>
        <div className="weekly-owner">
          <span>周更新人</span>
          {roleKey === "sales" ? <strong>{currentUserName}</strong> : <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>{availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}
          <em className={existing?.status === "submitted" ? "is-submitted" : ""}>{existing?.status === "submitted" ? "已提交" : existing ? "草稿" : "未填写"}</em>
        </div>
      </header>

      <div className="weekly-kpis">
        <Metric label="本周项目" value={ownerProjects.length} />
        <Metric label="行动事项" value={actionStats.total} />
        <Metric label="已完成" value={actionStats.done} />
        <Metric label="阻塞事项" value={actionStats.blocked} inverse />
      </div>

      <div className="weekly-layout">
        <section className="weekly-form-card">
          <header><div><p>WEEKLY SALES UPDATE</p><h2>{owner?.name ?? currentUserName} · 周行动更新</h2></div><span>最后保存：{formatDateTime(existing?.updatedAt)}</span></header>
          <div className="weekly-summary-fields">
            <label><span>上周完成与关键结果</span><textarea value={draft.lastWeekSummary} onChange={(event) => setDraft((current) => ({ ...current, lastWeekSummary: event.target.value }))} placeholder="客户拜访、方案提交、阶段变化、赢单结果……" /></label>
            <label><span>本周重点目标 <b>*</b></span><textarea value={draft.thisWeekGoal} onChange={(event) => setDraft((current) => ({ ...current, thisWeekGoal: event.target.value }))} placeholder="明确本周必须推进的经营目标和量化结果" /></label>
            <label><span>风险与阻塞</span><textarea value={draft.risks} onChange={(event) => setDraft((current) => ({ ...current, risks: event.target.value }))} placeholder="客户、预算、竞争、交付或内部资源风险" /></label>
            <label><span>需要协同支持</span><textarea value={draft.supportNeeded} onChange={(event) => setDraft((current) => ({ ...current, supportNeeded: event.target.value }))} placeholder="需要领导、售前、产品或伙伴支持的事项" /></label>
          </div>
          <div className="weekly-actions-editor">
            <header><div><strong>本周项目行动</strong><span>每条行动绑定项目、截止日期和状态</span></div><GhostButton onClick={addAction}><PlusOutlined /> 添加行动</GhostButton></header>
            {draft.actions.map((action, index) => (
              <div className="weekly-action-row" key={action.id}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <select value={action.projectId} onChange={(event) => updateAction(action.id, "projectId", event.target.value)}><option value="">非项目行动</option>{ownerProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                <input value={action.title} onChange={(event) => updateAction(action.id, "title", event.target.value)} placeholder="本周具体行动" />
                <input type="date" min={weekStart} max={dateInputValue(new Date(`${weekEnd}T12:00:00`).setDate(new Date(`${weekEnd}T12:00:00`).getDate() - 1))} value={action.dueDate || ""} onChange={(event) => updateAction(action.id, "dueDate", event.target.value)} />
                <select value={action.status} onChange={(event) => updateAction(action.id, "status", event.target.value)}><option value="planned">待开始</option><option value="in_progress">推进中</option><option value="done">已完成</option><option value="blocked">受阻</option></select>
                <IconButton label="删除行动" onClick={() => removeAction(action.id)}><DeleteOutlined /></IconButton>
              </div>
            ))}
            {!draft.actions.length && <div className="empty-state"><CalendarOutlined /><strong>本周尚未添加项目行动</strong><span>点击“添加行动”形成可跟踪的周计划</span></div>}
          </div>
          <footer><span>提交后仍可补充更新，系统会记录更新时间并关闭“周更新未提交”提醒。</span><div><GhostButton disabled={saving} onClick={() => submit("draft")}>保存草稿</GhostButton><PrimaryButton disabled={saving || !draft.thisWeekGoal.trim()} onClick={() => submit("submitted")}>{saving ? <LoadingOutlined spin /> : <CheckOutlined />} 提交周更新</PrimaryButton></div></footer>
        </section>

        <aside className="weekly-agenda">
          <header><div><p>ACTION CALENDAR</p><h2>本周行动日历</h2></div><CalendarOutlined /></header>
          {Object.entries(groupedActions).sort(([a], [b]) => a.localeCompare(b)).map(([date, actions]) => (
            <section key={date}><div><strong>{date}</strong><span>{actions.length} 项</span></div>{actions.map((action) => { const project = actionProject(action); return <button type="button" key={action.id} onClick={() => project && onView(project)}><i className={`weekly-status weekly-status--${action.status}`} /><span><strong>{action.title || "未填写行动"}</strong><small>{project?.name ?? "非项目行动"}</small></span><em>{{ planned: "待开始", in_progress: "推进中", done: "已完成", blocked: "受阻" }[action.status]}</em></button>; })}</section>
          ))}
          {!draft.actions.length && <div className="weekly-agenda__empty"><CalendarOutlined /><strong>等待周计划</strong><span>行动提交后将在这里按日期排布。</span></div>}
        </aside>
      </div>
    </div>
  );
}

function DailyReportImportView({ projects, users, importHistory = [], onAnalyze, onImport, onLoadDraft, onSaveDraft, onClearDraft }) {
  const salesUsers = users.filter((user) => user.roleKey === "sales");
  const [rawText, setRawText] = useState("");
  const [defaultDate, setDefaultDate] = useState(dateInputValue(new Date()));
  const [entries, setEntries] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState("正在读取账号草稿");
  const draftSaveQueueRef = useRef(Promise.resolve());
  const draftWriteIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    onLoadDraft()
      .then((saved) => {
        if (!active || !saved) return;
        setRawText(saved.rawText ?? "");
        setDefaultDate(saved.defaultDate ?? dateInputValue(new Date()));
        setEntries(Array.isArray(saved.entries) ? saved.entries : []);
        setWarnings(Array.isArray(saved.warnings) ? saved.warnings : []);
        setDraftStatus("已恢复账号草稿");
      })
      .catch(() => {
        if (active) setDraftStatus("草稿读取失败，不影响正式入库");
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => { active = false; };
  }, [onLoadDraft]);

  useEffect(() => {
    if (!draftReady) return undefined;
    const timer = window.setTimeout(() => {
      const writeId = draftWriteIdRef.current + 1;
      draftWriteIdRef.current = writeId;
      const hasDraft = Boolean(rawText.trim() || entries.length);
      draftSaveQueueRef.current = draftSaveQueueRef.current
        .catch(() => undefined)
        .then(() => hasDraft ? onSaveDraft({ rawText, defaultDate, entries, warnings }) : onClearDraft());
      draftSaveQueueRef.current
        .then(() => { if (draftWriteIdRef.current === writeId) setDraftStatus(hasDraft ? "草稿已自动保存到当前账号" : "暂无未提交草稿"); })
        .catch(() => { if (draftWriteIdRef.current === writeId) setDraftStatus("草稿自动保存失败"); });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [defaultDate, draftReady, entries, onClearDraft, onSaveDraft, rawText, warnings]);

  const selectedEntries = entries.filter((entry) => entry.selected);
  const readyEntries = selectedEntries.filter((entry) => entry.salespersonId && entry.projectId && entry.content.trim());
  const unmatchedCount = entries.filter((entry) => !entry.salespersonId || !entry.projectId).length;
  const averageConfidence = entries.length ? Math.round(entries.reduce((sum, entry) => sum + Number(entry.matchConfidence || 0), 0) / entries.length * 100) : 0;

  const analyze = async () => {
    if (!rawText.trim()) return;
    setAnalyzing(true);
    setError("");
    try {
      const result = await onAnalyze(rawText, defaultDate);
      setEntries((result.entries ?? []).map((entry) => ({ ...entry, selected: Boolean(entry.salespersonId && entry.projectId) })));
      setWarnings(result.warnings ?? []);
    } catch (analysisError) {
      setError(analysisError.message || "日报识别失败");
    } finally {
      setAnalyzing(false);
    }
  };

  const updateEntry = (id, key, value) => {
    setEntries((current) => current.map((entry) => {
      if (entry.id !== id) return entry;
      const next = { ...entry, [key]: value };
      if (key === "salespersonId") next.salespersonName = salesUsers.find((user) => user.id === value)?.name ?? "";
      if (key === "projectId") {
        next.projectName = projects.find((project) => project.id === value)?.name ?? "";
        next.matchConfidence = value ? Math.max(Number(next.matchConfidence || 0), 0.8) : 0;
      }
      if (key !== "selected") next.selected = Boolean(next.salespersonId && next.projectId && next.content.trim());
      return next;
    }));
  };

  const commit = async () => {
    if (!readyEntries.length || readyEntries.length !== selectedEntries.length) {
      setError("请为已勾选记录补全销售、项目和日报内容。");
      return;
    }
    setImporting(true);
    setError("");
    try {
      await onImport(rawText, defaultDate, readyEntries);
      await draftSaveQueueRef.current.catch(() => undefined);
      await onClearDraft();
      setRawText("");
      setEntries([]);
      setWarnings([]);
    } catch (importError) {
      setError(importError.message || "日报入库失败");
    } finally {
      setImporting(false);
    }
  };

  const discardDraft = async () => {
    await draftSaveQueueRef.current.catch(() => undefined);
    await onClearDraft();
    setRawText("");
    setEntries([]);
    setWarnings([]);
    setError("");
    setDraftStatus("暂无未提交草稿");
  };

  return (
    <div className="daily-import-workspace">
      <section className="daily-import-source">
        <header>
          <div><p>AI DAILY REPORT INGESTION</p><h2>粘贴日报，自动拆分并匹配项目</h2><span>系统只生成候选记录，管理员确认后才会写入正式数据库。</span></div>
          <div className="daily-import-date"><span>默认日报日期</span><input type="date" value={defaultDate} onChange={(event) => setDefaultDate(event.target.value)} /></div>
        </header>
        <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'可直接粘贴微信群日报、邮件日报或汇总文字。\n例如：\n张三：上午拜访某客户，沟通数据平台方案；下午电话跟进另一项目采购进度。\n李四：与客户召开需求评审会，下一步完善技术方案。'} />
        <footer><span><SafetyCertificateOutlined /> {draftStatus}</span><div className="daily-import-actions"><GhostButton disabled={analyzing || (!rawText && !entries.length)} onClick={discardDraft}>清空草稿</GhostButton><PrimaryButton disabled={analyzing || !rawText.trim()} onClick={analyze}>{analyzing ? <LoadingOutlined spin /> : <RobotOutlined />} {analyzing ? "正在识别销售与项目" : "第 1 步：识别并生成候选"}</PrimaryButton></div></footer>
      </section>

      {error && <div className="daily-import-message daily-import-message--error"><WarningFilled /><span>{error}</span></div>}
      {warnings.length > 0 && <div className="daily-import-message"><InfoCircleOutlined /><span>{warnings.join("；")}</span></div>}

      {entries.length > 0 && (
        <>
          <div className="daily-import-kpis">
            <Metric label="识别记录" value={entries.length} />
            <Metric label="自动匹配" value={entries.length - unmatchedCount} />
            <Metric label="待人工确认" value={unmatchedCount} inverse />
            <Metric label="平均置信度" value={`${averageConfidence}%`} />
          </div>
          <section className="daily-review-card">
            <header><div><p>REVIEW BEFORE COMMIT</p><h2>确认日报记录</h2><span>低置信度或未匹配记录不会默认勾选，请人工指定后再入库。</span></div><strong>已选择 {selectedEntries.length} / {entries.length}</strong></header>
            <div className="daily-review-table-wrap">
              <table className="daily-review-table">
                <thead><tr><th>入库</th><th>日期</th><th>销售</th><th>匹配项目</th><th>类型</th><th>日报内容</th><th>匹配质量</th></tr></thead>
                <tbody>{entries.map((entry) => {
                  const confidence = Math.round(Number(entry.matchConfidence || 0) * 100);
                  const confidenceTone = confidence >= 80 ? "high" : confidence >= 60 ? "medium" : "low";
                  return <tr key={entry.id}>
                    <td><input type="checkbox" checked={entry.selected} disabled={!entry.salespersonId || !entry.projectId || !entry.content.trim()} onChange={(event) => updateEntry(entry.id, "selected", event.target.checked)} aria-label={`选择日报记录${entry.id}`} /></td>
                    <td><input type="date" value={entry.reportDate} onChange={(event) => updateEntry(entry.id, "reportDate", event.target.value)} /></td>
                    <td><select value={entry.salespersonId ?? ""} onChange={(event) => updateEntry(entry.id, "salespersonId", event.target.value)}><option value="">请选择销售</option>{salesUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></td>
                    <td><select value={entry.projectId ?? ""} onChange={(event) => updateEntry(entry.id, "projectId", event.target.value)}><option value="">未匹配项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.owner}</option>)}</select></td>
                    <td><select value={entry.activityType} onChange={(event) => updateEntry(entry.id, "activityType", event.target.value)}>{Object.entries(DAILY_ACTIVITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></td>
                    <td><textarea value={entry.content} onChange={(event) => updateEntry(entry.id, "content", event.target.value)} /><small>{entry.customerContact ? `客户联系人：${entry.customerContact}` : entry.rawSegment}</small></td>
                    <td><span className={`confidence-badge confidence-badge--${confidenceTone}`}>{confidence}%</span><small>{entry.matchReason || "等待人工确认"}</small></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <footer><span>只有点击右侧按钮并收到成功提示，才算正式写入数据库。</span><PrimaryButton disabled={importing || !readyEntries.length} onClick={commit}>{importing ? <LoadingOutlined spin /> : <CheckOutlined />} 第 2 步：确认正式入库 {readyEntries.length} 条</PrimaryButton></footer>
          </section>
        </>
      )}

      <section className="daily-import-history">
        <header><div><p>IMPORT HISTORY</p><h2>最近日报导入</h2></div><span>保留原文、识别结果和操作审计</span></header>
        {importHistory.length ? <table><thead><tr><th>导入时间</th><th>日报日期</th><th>记录数</th><th>模型</th><th>操作人</th><th>状态</th></tr></thead><tbody>{importHistory.slice(0, 10).map((item) => <tr key={item.id}><td>{formatDateTime(item.created_at)}</td><td>{item.report_date}</td><td>{item.entry_count}</td><td>{item.model}</td><td>{users.find((user) => user.id === item.created_by)?.name ?? "管理员"}</td><td><span className="task-result">{{ completed: "已完成", partial: "部分成功", failed: "失败" }[item.status] ?? item.status}</span></td></tr>)}</tbody></table> : <div className="empty-state"><FileTextOutlined /><strong>暂无日报导入记录</strong><span>首次正式导入后将在这里显示。</span></div>}
      </section>
    </div>
  );
}

function WorkbenchPage({ projects, weeklyUpdates, dailyReportImports, users, roleKey, currentUserId, currentUserName, onSaveWeekly, onAnalyzeDailyReport, onImportDailyReport, onLoadDailyDraft, onSaveDailyDraft, onClearDailyDraft, onCreate, onView, onEdit, onDelete, onBulkDelete }) {
  const [view, setView] = useState("table");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filters, setFilters] = useState({ search: "", region: "全部区域", owner: "all", category: "all", stage: "all" });
  const ownerOptions = useMemo(() => Array.from(new Map(projects.map((project) => [project.ownerId, project.owner])).entries()).sort((a, b) => a[1].localeCompare(b[1], "zh-CN")), [projects]);
  const filtered = projects.filter((project) => {
    const keyword = filters.search.trim().toLowerCase();
    if (keyword && ![project.name, project.account, project.city, project.district].join(" ").toLowerCase().includes(keyword)) return false;
    if (filters.region !== "全部区域" && project.region !== filters.region) return false;
    if (filters.owner !== "all" && project.ownerId !== filters.owner) return false;
    if (filters.category !== "all" && project.category !== filters.category) return false;
    if (filters.stage !== "all" && project.stage !== filters.stage) return false;
    return true;
  });

  const handleExport = () => exportCsv("营销作战地图_项目清单.csv", filtered, [
    { key: "id", label: "项目编号" }, { key: "name", label: "项目名称" }, { key: "account", label: "客户" },
    { key: "region", label: "区域" }, { key: "province", label: "省份" }, { key: "city", label: "城市" },
    { key: "district", label: "区县" }, { key: "amount", label: "金额（万元）" }, { key: "owner", label: "负责人" },
  ]);

  return (
    <div className="standard-page">
      <PageHeader eyebrow="MULTI-DIMENSIONAL WORKBENCH" title="数据工作台" description="像多维表格一样定位、筛选和推进所有营销项目" actions={<PrimaryButton onClick={onCreate}><PlusOutlined /> 新建项目</PrimaryButton>} />
      <section className="view-strip">
        <div>{[{ key: "table", label: "表格", icon: TableOutlined }, { key: "kanban", label: "阶段看板", icon: AppstoreOutlined }, { key: "calendar", label: "周行动更新", icon: CalendarOutlined }, ...(roleKey === "admin" ? [{ key: "daily-report", label: "日报导入", icon: FileTextOutlined }] : [])].map((item) => { const Icon = item.icon; return <button key={item.key} type="button" className={view === item.key ? "is-active" : ""} onClick={() => setView(item.key)}><Icon />{item.label}</button>; })}</div>
        <span>当前视图：<strong>{view === "daily-report" ? "销售日报智能导入" : view === "calendar" ? "销售周行动更新" : "全部项目作战总表"}</strong></span>
      </section>
      {view !== "daily-report" && <FilterBar filters={filters} setFilters={setFilters} owners={ownerOptions} onCreate={onCreate} onExport={handleExport} resultCount={filtered.length} />}
      {selectedIds.length > 0 && <div className="bulk-bar"><span>已选择 <strong>{selectedIds.length}</strong> 条记录</span><GhostButton onClick={() => setSelectedIds([])}>取消选择</GhostButton><GhostButton className="danger-button" onClick={() => { onBulkDelete(selectedIds); setSelectedIds([]); }}><DeleteOutlined /> 批量删除</GhostButton></div>}
      {view === "table" && <ProjectTable projects={filtered} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onView={onView} onEdit={onEdit} onDelete={onDelete} />}
      {view === "kanban" && <KanbanView projects={filtered} onView={onView} />}
      {view === "calendar" && <WeeklyUpdateView projects={projects} weeklyUpdates={weeklyUpdates} users={users} roleKey={roleKey} currentUserId={currentUserId} currentUserName={currentUserName} onSave={onSaveWeekly} onView={onView} />}
      {view === "daily-report" && roleKey === "admin" && <DailyReportImportView projects={projects} users={users} importHistory={dailyReportImports} onAnalyze={onAnalyzeDailyReport} onImport={onImportDailyReport} onLoadDraft={onLoadDailyDraft} onSaveDraft={onSaveDailyDraft} onClearDraft={onClearDailyDraft} />}
    </div>
  );
}

const SMART_QUERY_GREETING = { role: "assistant", content: "可以直接问我区域、项目阶段、金额、负责人、风险、提醒和本周行动，我会按你的数据权限实时查询。" };

function SmartQueryPanel({ onAsk, onLoadHistory, onSaveHistory, onClearHistory, projectCount, roleKey }) {
  const [messages, setMessages] = useState([SMART_QUERY_GREETING]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("正在读取账号会话");
  const historySaveQueueRef = useRef(Promise.resolve());
  const suggested = ["哪些项目客户触达很多但仍未成单？", "赢单项目前平均需要多少次客户触达？", "按负责人分析加权管道和风险", "总结本周销售行动和需要领导支持的事项"];

  useEffect(() => {
    let active = true;
    onLoadHistory()
      .then((saved) => {
        if (!active) return;
        const savedMessages = Array.isArray(saved?.messages) ? saved.messages.filter((item) => item?.role && item?.content).slice(-40) : [];
        if (savedMessages.length) setMessages(savedMessages);
        setHistoryStatus(savedMessages.length ? `已恢复 ${savedMessages.length} 条账号会话` : "会话已绑定当前账号");
      })
      .catch(() => {
        if (active) setHistoryStatus("历史会话读取失败，本次对话仍可使用");
      });
    return () => { active = false; };
  }, [onLoadHistory]);

  const persistMessages = async (nextMessages) => {
    const normalized = nextMessages.slice(-40).map(({ role, content, meta, error }) => ({ role, content, meta: meta || "", error: Boolean(error) }));
    historySaveQueueRef.current = historySaveQueueRef.current.catch(() => undefined).then(() => onSaveHistory(normalized));
    await historySaveQueueRef.current;
    setHistoryStatus("对话已保存到当前账号");
  };

  const submitQuestion = async (value = question) => {
    const content = value.trim();
    if (!content || asking) return;
    const nextMessages = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setQuestion("");
    setAsking(true);
    persistMessages(nextMessages).catch(() => setHistoryStatus("当前问题暂未同步，回答后将重试"));
    try {
      const result = await onAsk(content, messages);
      const finalMessages = [...nextMessages, { role: "assistant", content: result.answer, meta: `${result.model} · ${result.dataScope} · ${result.projectCount} 个项目` }];
      setMessages(finalMessages);
      persistMessages(finalMessages).catch(() => setHistoryStatus("回答成功，但会话同步失败"));
    } catch (error) {
      const finalMessages = [...nextMessages, { role: "assistant", content: error.message || "智能问数暂时不可用，请稍后重试。", error: true }];
      setMessages(finalMessages);
      persistMessages(finalMessages).catch(() => setHistoryStatus("会话保存失败，请稍后重试"));
    } finally {
      setAsking(false);
    }
  };

  const clearHistory = async () => {
    await historySaveQueueRef.current.catch(() => undefined);
    await onClearHistory();
    setMessages([SMART_QUERY_GREETING]);
    setHistoryStatus("账号会话已清空");
  };

  return (
    <article className="smart-query-card">
      <header>
        <div className="smart-query-title"><i><RobotOutlined /></i><div><p>MARKETING DATA COPILOT</p><h2>智能问数</h2><span>GPT-5.5 实时读取当前权限下的营销地图数据</span></div></div>
        <div className="smart-query-account"><div className="smart-query-scope"><SafetyCertificateOutlined /><span><strong>{roleKey === "sales" ? "本人数据" : "全部可见数据"}</strong><small>{projectCount} 个项目 · {historyStatus}</small></span></div><button type="button" disabled={asking || messages.length <= 1} onClick={clearHistory}>清空对话</button></div>
      </header>
      <div className="smart-query-layout">
        <section className="smart-chat">
          <div className="smart-chat__messages">
            {messages.map((message, index) => <div className={`smart-message smart-message--${message.role} ${message.error ? "smart-message--error" : ""}`} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? <RobotOutlined /> : <UserOutlined />}</span><div>{message.role === "assistant" ? <div className="smart-message__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div> : <p>{message.content}</p>}{message.meta && <small>{message.meta}</small>}</div></div>)}
            {asking && <div className="smart-message smart-message--assistant"><span><RobotOutlined /></span><div><p><LoadingOutlined spin /> 正在读取最新营销数据并分析……</p></div></div>}
          </div>
          <form className="smart-chat__composer" onSubmit={(event) => { event.preventDefault(); submitQuestion(); }}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：华东区域本季度有哪些高价值项目存在延期风险？" />
            <button type="submit" disabled={asking || !question.trim()} aria-label="发送问题"><SendOutlined /></button>
          </form>
        </section>
        <aside className="smart-query-suggestions">
          <strong>推荐问题</strong>
          <span>基于经营管理常用分析口径</span>
          <div>{suggested.map((item) => <button type="button" key={item} disabled={asking} onClick={() => submitQuestion(item)}>{item}<RightOutlined /></button>)}</div>
          <footer><InfoCircleOutlined /><p>回答仅基于数据库当前记录，包含已确认入库的日报触达。历史数据不足时会明确提示统计边界。</p></footer>
        </aside>
      </div>
    </article>
  );
}

function AnalysisPage({ projects, roleKey, onAsk, onLoadHistory, onSaveHistory, onClearHistory }) {
  const total = projects.reduce((sum, project) => sum + project.amount, 0);
  const weighted = projects.reduce((sum, project) => sum + project.amount * getStage(project.stage).probability / 100, 0);
  const highRisk = projects.filter((project) => project.health === "red").length;
  const regionData = BUSINESS_REGIONS.map((region) => ({ name: region, value: projects.filter((project) => project.region === region).reduce((sum, project) => sum + project.amount, 0) }));
  const categoryData = Object.entries(CATEGORY_META).map(([key, meta]) => ({ name: meta.label, value: projects.filter((project) => project.category === key).reduce((sum, project) => sum + project.amount, 0), itemStyle: { color: meta.color } }));
  const stageData = STAGES.map((stage) => ({ name: stage.label, value: projects.filter((project) => project.stage === stage.key).length }));
  const ownerNames = [...new Set(projects.map((project) => project.owner))];
  const ownerData = ownerNames.map((owner) => ({ name: owner, value: projects.filter((project) => project.owner === owner).reduce((sum, project) => sum + project.amount, 0) }));
  const forecastHorizon = [0, 30, 60, 90];
  const forecastData = forecastHorizon.map((days) => {
    const deadline = new Date();
    deadline.setHours(23, 59, 59, 999);
    deadline.setDate(deadline.getDate() + days);
    return projects
      .filter((project) => project.stage !== "won" && project.expectedClose && new Date(project.expectedClose) <= deadline)
      .reduce((sum, project) => sum + project.amount * getStage(project.stage).probability / 100, 0);
  });

  const commonText = { color: "#526079", fontFamily: "Inter, PingFang SC, sans-serif" };
  const axis = { axisLine: { lineStyle: { color: "#dce4ef" } }, axisLabel: { ...commonText, fontSize: 11 }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#edf1f6" } } };

  return (
    <div className="standard-page analysis-page">
      <PageHeader eyebrow="EXECUTIVE BUSINESS INTELLIGENCE" title="BI 分析" description={`统一口径洞察区域、阶段、客户和销售经营表现 · ${new Date().getFullYear()} 年`} actions={<PrimaryButton onClick={() => window.print()}><DownloadOutlined /> 导出经营报告</PrimaryButton>} />
      <SmartQueryPanel onAsk={onAsk} onLoadHistory={onLoadHistory} onSaveHistory={onSaveHistory} onClearHistory={onClearHistory} projectCount={projects.length} roleKey={roleKey} />
      <div className="analysis-kpis">
        <Metric label="商机总额（万元）" value={formatMoney(total)} />
        <Metric label="加权管道（万元）" value={formatMoney(weighted)} />
        <Metric label="活跃项目" value={projects.filter((project) => !["won"].includes(project.stage)).length} />
        <Metric label="红色风险" value={highRisk} inverse />
      </div>
      <div className="dashboard-grid">
        <article className="chart-card chart-card--wide"><header><div><p>PIPELINE FORECAST</p><h2>按预计成交日计算的 30 / 60 / 90 天加权管道</h2></div></header><EChart className="chart" ariaLabel="成交预测折线图" option={{ tooltip: { trigger: "axis" }, grid: { left: 48, right: 20, top: 32, bottom: 34 }, xAxis: { type: "category", data: ["已到期", "+30 天", "+60 天", "+90 天"], ...axis }, yAxis: { type: "value", ...axis }, series: [{ name: "加权管道", type: "line", data: forecastData, smooth: true, symbolSize: 8, lineStyle: { width: 3, color: "#1677ff" }, itemStyle: { color: "#1677ff" }, areaStyle: { color: "rgba(22,119,255,.08)" } }] }} /></article>
        <article className="chart-card"><header><div><p>CATEGORY MIX</p><h2>五类资源金额结构</h2></div><PieChartOutlined /></header><EChart className="chart" ariaLabel="资源类型饼图" option={{ tooltip: { trigger: "item" }, legend: { bottom: 0, textStyle: commonText }, series: [{ type: "pie", radius: [52, 82], center: ["50%", "43%"], itemStyle: { borderColor: "#fff", borderWidth: 3 }, label: { formatter: "{b}\n{d}%", ...commonText, fontSize: 10 }, data: categoryData }] }} /></article>
        <article className="chart-card"><header><div><p>REGIONAL PERFORMANCE</p><h2>区域商机金额</h2></div><BarChartOutlined /></header><EChart className="chart" ariaLabel="区域金额柱状图" option={{ tooltip: { trigger: "axis" }, grid: { left: 56, right: 20, top: 20, bottom: 32 }, xAxis: { type: "category", data: regionData.map((item) => item.name), ...axis }, yAxis: { type: "value", ...axis }, series: [{ type: "bar", barWidth: 28, data: regionData.map((item) => ({ value: item.value, itemStyle: { color: item.name === "华东区域" ? "#1677ff" : "#55a6ff", borderRadius: [5, 5, 0, 0] } })) }] }} /></article>
        <article className="chart-card"><header><div><p>SALES FUNNEL</p><h2>项目阶段漏斗</h2></div><ProjectOutlined /></header><EChart className="chart" ariaLabel="销售漏斗图" option={{ tooltip: { trigger: "item" }, series: [{ type: "funnel", left: "12%", top: 18, bottom: 12, width: "76%", sort: "descending", gap: 2, label: { show: true, position: "inside", color: "#fff", formatter: "{b} {c}" }, itemStyle: { borderColor: "#fff", borderWidth: 2 }, color: ["#0f4da8", "#1263c9", "#1677ff", "#3b90ff", "#67aaff", "#8fc1ff"], data: stageData }] }} /></article>
        <article className="chart-card"><header><div><p>OWNER RANKING</p><h2>负责人管道排名</h2></div><TeamOutlined /></header><EChart className="chart" ariaLabel="负责人管道排名" option={{ tooltip: { trigger: "axis" }, grid: { left: 48, right: 28, top: 22, bottom: 32 }, xAxis: { type: "category", data: ownerData.map((item) => item.name), ...axis }, yAxis: { type: "value", ...axis }, series: [{ type: "bar", barWidth: 24, data: ownerData.map((item, index) => ({ value: item.value, itemStyle: { color: ["#1677ff", "#4e9dff", "#86bcff"][index % 3], borderRadius: [5, 5, 0, 0] } })) }] }} /></article>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onImport }) {
  const [file, setFile] = useState(null);
  const [step, setStep] = useState("upload");
  const [preview, setPreview] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const inspect = () => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(parseImportCsv(reader.result));
      setStep("preview");
    };
    reader.readAsText(file);
  };

  return (
    <Modal title="批量导入项目数据" onClose={onClose} width={700}>
      <div className="import-modal">
        <div className="import-steps"><span className="is-active">1 上传文件</span><b /><span className={step === "preview" ? "is-active" : ""}>2 预检确认</span><b /><span>3 导入结果</span></div>
        {step === "upload" ? <><label className="dropzone"><CloudUploadOutlined /><strong>上传 CSV 数据文件</strong><span>单次最多 10,000 行，系统将校验必填字段、行政区划代码和地图坐标</span><input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><em>{file ? file.name : "选择文件"}</em></label><div className="import-tips"><InfoCircleOutlined /><span><strong>导入前检查</strong><small>请使用系统模板，并填写六位行政区划代码、经度、纬度和负责人。</small></span></div></> : <div className="import-preview"><header><strong>预检结果</strong><span>{preview.filter((row) => row.status === "通过").length} 行通过，{preview.filter((row) => row.status !== "通过").length} 行需修正</span></header>{preview.slice(0, 50).map((row) => <div key={row.row}><b>第 {row.row} 行</b><span>{row.data.name || "未填写项目名称"} · {row.data.account || "未填写客户"}{row.error ? `（${row.error}）` : ""}</span><em className={row.status === "通过" ? "success-text" : "danger-text"}>{row.status}</em></div>)}</div>}
      </div>
      <footer className="modal__footer">
        <GhostButton onClick={onClose}>取消</GhostButton>
        {step === "upload" ? <PrimaryButton disabled={!file} onClick={inspect}><FileExcelOutlined /> 开始预检</PrimaryButton> : <PrimaryButton disabled={!preview.length || preview.some((row) => row.status !== "通过") || submitting} onClick={async () => { setSubmitting(true); try { await onImport(preview.map((row) => row.data), file?.name); } finally { setSubmitting(false); } }}>{submitting ? <><LoadingOutlined spin /> 正在导入</> : <><UploadOutlined /> 确认导入</>}</PrimaryButton>}
      </footer>
    </Modal>
  );
}

function ManagementPage({ projects, operations, users, roleKey, onCreate, onImportOpen, onRefresh }) {
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const projectCount = projects.length;
  const percentage = (predicate) => projectCount ? Math.round((projects.filter(predicate).length / projectCount) * 100) : 0;
  const quality = {
    region: percentage((project) => project.district && /^\d{6}$/.test(project.adcode || "")),
    owner: percentage((project) => Boolean(project.ownerId)),
    next: percentage((project) => Boolean(project.nextAction && project.nextActionDate)),
    contact: percentage((project) => project.hasValidContact),
  };
  const qualityScore = projectCount ? Math.round(Object.values(quality).reduce((sum, value) => sum + value, 0) / 4) : 0;
  const highPriorityIssues = projects.filter((project) => ["P0", "P1"].includes(project.priority) && (!project.nextAction || !project.nextActionDate || !project.hasValidContact)).length;
  const sourceMap = new Map();
  projects.forEach((project) => {
    const sourceName = project.source?.trim() || "未标注来源";
    const current = sourceMap.get(sourceName) ?? { name: sourceName, count: 0, updatedAt: null };
    current.count += 1;
    if (!current.updatedAt || new Date(project.updatedAtIso) > new Date(current.updatedAt)) current.updatedAt = project.updatedAtIso;
    sourceMap.set(sourceName, current);
  });
  const sources = [...sourceMap.values()].sort((a, b) => b.count - a.count);
  const history = operations.importJobs.map((job) => ({
    ...job,
    user: users.find((user) => user.id === job.createdBy)?.name ?? "未知用户",
  }));
  const duplicateMap = new Map();
  operations.customers.forEach((customer) => {
    const normalizedName = customer.name.toLowerCase().replace(/[\s（）()·._-]/g, "");
    const key = customer.unified_credit_code?.trim() ? `credit:${customer.unified_credit_code.trim()}` : `name:${normalizedName}`;
    const group = duplicateMap.get(key) ?? [];
    group.push(customer);
    duplicateMap.set(key, group);
  });
  const duplicateGroups = [...duplicateMap.values()].filter((group) => group.length > 1);
  const changedFields = (log) => {
    const keys = new Set([...Object.keys(log.oldData ?? {}), ...Object.keys(log.newData ?? {})]);
    return [...keys].filter((key) => JSON.stringify(log.oldData?.[key]) !== JSON.stringify(log.newData?.[key])).join("、") || "无字段差异";
  };
  const templateHeaders = [{ key: "name", label: "项目名称" }, { key: "account", label: "客户主体" }, { key: "contactName", label: "关键联系人" }, { key: "contactMobile", label: "联系人手机号" }, { key: "contactEmail", label: "联系人邮箱" }, { key: "category", label: "项目类型" }, { key: "region", label: "经营区域" }, { key: "province", label: "省份" }, { key: "city", label: "城市" }, { key: "district", label: "区县" }, { key: "adcode", label: "行政区划代码" }, { key: "longitude", label: "经度" }, { key: "latitude", label: "纬度" }, { key: "amount", label: "金额（万元）" }, { key: "owner", label: "负责人" }, { key: "presales", label: "售前负责人" }, { key: "stage", label: "销售阶段" }, { key: "health", label: "健康度" }, { key: "priority", label: "优先级" }, { key: "nextAction", label: "下一步动作" }, { key: "nextActionDate", label: "计划日期" }, { key: "expectedClose", label: "预计成交日期" }, { key: "source", label: "数据来源" }, { key: "risk", label: "风险说明" }];
  const downloadTemplate = () => exportCsv("营销作战地图_导入模板.csv", [], templateHeaders);
  const exportAuditLogs = () => exportCsv("营销作战地图_审计日志.csv", operations.auditLogs.map((log) => ({
    time: formatDateTime(log.createdAt), table: log.table, record: log.recordId, action: log.action,
    actor: users.find((user) => user.id === log.actorId)?.name ?? "系统", fields: changedFields(log),
  })), [{ key: "time", label: "操作时间" }, { key: "table", label: "数据表" }, { key: "record", label: "记录ID" }, { key: "action", label: "操作" }, { key: "actor", label: "操作人" }, { key: "fields", label: "变更字段" }]);
  return (
    <div className="standard-page management-page">
      <PageHeader eyebrow="DATA OPERATIONS & GOVERNANCE" title="数据管理" description="导入、校验、查重、修正并追踪每一次数据变更" actions={<><GhostButton onClick={downloadTemplate}><DownloadOutlined /> 模板下载</GhostButton><PrimaryButton onClick={onImportOpen}><UploadOutlined /> 上传数据</PrimaryButton></>} />
      <section className="management-actions">
        <button type="button" onClick={onCreate}><PlusOutlined /><span><strong>单条新建</strong><small>录入客户、商机和下一步动作</small></span><RightOutlined /></button>
        <button type="button" onClick={onImportOpen}><CloudUploadOutlined /><span><strong>批量导入</strong><small>上传 CSV，预检后再入库</small></span><RightOutlined /></button>
        <button type="button" onClick={() => setDuplicateOpen(true)}><ApartmentOutlined /><span><strong>重复检查</strong><small>按统一信用代码与标准名称识别</small></span><RightOutlined /></button>
        <button type="button" onClick={() => setAuditOpen(true)}><SafetyCertificateOutlined /><span><strong>审计追溯</strong><small>查看数据库字段变更与操作人</small></span><RightOutlined /></button>
      </section>
      <div className="management-grid">
        <article className="quality-card"><header><div><p>DATA QUALITY</p><h2>数据质量概览</h2></div><strong>{qualityScore}<small>分</small></strong></header>{Object.entries({ "区县及区划代码完整率": quality.region, "负责人完整率": quality.owner, "下一步动作完整率": quality.next, "有效联系人覆盖率": quality.contact }).map(([label, value]) => <div className="quality-row" key={label}><span>{label}</span><b><i style={{ width: `${value}%` }} /></b><strong>{value}%</strong></div>)}<footer><InfoCircleOutlined /> 当前存在 {highPriorityIssues} 条高优先级数据质量问题</footer></article>
        <article className="source-card"><header><div><p>DATA SOURCES</p><h2>数据库来源分布</h2></div><GhostButton onClick={onRefresh}><ReloadOutlined /> 刷新</GhostButton></header><div>{sources.map((source) => <button type="button" key={source.name} disabled><i className="source-dot" /><span><strong>{source.name}</strong><small>最近更新 {formatDateTime(source.updatedAt)}</small></span><em>{source.count} 条</em><b>已入库</b></button>)}{!sources.length && <div className="empty-state"><DatabaseOutlined /><strong>暂无项目数据</strong><span>新建或导入项目后将在此显示真实来源</span></div>}</div></article>
      </div>
      <article className="history-card"><header><div><p>IMPORT HISTORY</p><h2>最近导入任务</h2></div></header><table className="data-table"><thead><tr><th>文件名称</th><th>操作人</th><th>总行数</th><th>成功</th><th>失败</th><th>完成时间</th><th>结果</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><FileExcelOutlined /> <strong>{item.file}</strong></td><td>{item.user}</td><td>{item.rows}</td><td className="success-text">{item.success}</td><td className={item.failed ? "danger-text" : ""}>{item.failed}</td><td>{formatDateTime(item.completedAt || item.createdAt)}</td><td><span className={`task-result ${item.status !== "completed" ? "task-result--warning" : ""}`}>{{ pending: "等待处理", validating: "校验中", completed: "导入成功", partial: "部分成功", failed: "导入失败" }[item.status] ?? item.status}</span></td></tr>)}{!history.length && <tr><td colSpan="7"><div className="empty-state"><FileExcelOutlined /><strong>暂无导入记录</strong><span>首次批量导入后将自动记录任务结果</span></div></td></tr>}</tbody></table></article>
      {duplicateOpen && <Modal title="客户重复检查" onClose={() => setDuplicateOpen(false)} width={760}><div className="detail-modal">{duplicateGroups.length ? duplicateGroups.map((group, index) => <section key={`${group[0].id}-${index}`} className="detail-columns"><div><h4>疑似重复组 {index + 1}</h4>{group.map((customer) => <p key={customer.id}>{customer.name}{customer.unified_credit_code ? ` · ${customer.unified_credit_code}` : ""}</p>)}</div></section>) : <div className="empty-state"><CheckCircleFilled /><strong>未发现重复客户</strong><span>已按当前可见客户的统一信用代码和标准化名称完成扫描</span></div>}</div><footer className="modal__footer"><GhostButton onClick={() => setDuplicateOpen(false)}>关闭</GhostButton></footer></Modal>}
      {auditOpen && <Modal title="数据库审计日志" onClose={() => setAuditOpen(false)} width={900}><div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>数据表</th><th>操作</th><th>操作人</th><th>变更字段</th></tr></thead><tbody>{operations.auditLogs.map((log) => <tr key={log.id}><td>{formatDateTime(log.createdAt)}</td><td>{log.table}</td><td>{log.action}</td><td>{users.find((user) => user.id === log.actorId)?.name ?? "系统"}</td><td>{changedFields(log)}</td></tr>)}{!operations.auditLogs.length && <tr><td colSpan="5"><div className="empty-state"><SafetyCertificateOutlined /><strong>{roleKey === "admin" ? "暂无审计记录" : "仅管理员可查看审计日志"}</strong></div></td></tr>}</tbody></table></div><footer className="modal__footer"><GhostButton onClick={() => setAuditOpen(false)}>关闭</GhostButton>{roleKey === "admin" && operations.auditLogs.length > 0 && <PrimaryButton onClick={exportAuditLogs}><DownloadOutlined /> 导出审计日志</PrimaryButton>}</footer></Modal>}
    </div>
  );
}

function AlertRuleSettings({ rules, roleKey, onUpdate, onClose }) {
  const [savingId, setSavingId] = useState(null);
  const saveRule = async (rule, changes) => {
    setSavingId(rule.id);
    try {
      await onUpdate({ ...rule, ...changes });
    } finally {
      setSavingId(null);
    }
  };
  return (
    <div className="alert-rule-settings">
      <div className="alert-rule-settings__intro"><InfoCircleOutlined /><p>提醒由数据库规则自动生成。每次刷新、项目更新或提交周更新时都会重新计算，并按登录人的数据权限展示。</p></div>
      {rules.map((rule) => <article key={rule.id} className={!rule.enabled ? "is-disabled" : ""}><i className={`alert-dot alert-dot--${rule.level}`} /><div><strong>{rule.name}</strong><p>{rule.description}</p><small>规则代码：{rule.code}</small></div><label><span>阈值（天）</span><input type="number" min="0" max="365" value={rule.thresholdDays} disabled={roleKey !== "admin" || savingId === rule.id} onChange={(event) => saveRule(rule, { thresholdDays: event.target.value })} /></label><label className="rule-switch"><input type="checkbox" checked={rule.enabled} disabled={roleKey !== "admin" || savingId === rule.id} onChange={(event) => saveRule(rule, { enabled: event.target.checked })} /><span>{rule.enabled ? "已启用" : "已停用"}</span></label></article>)}
      {roleKey !== "admin" && <p className="alert-rule-settings__permission">当前为只读规则视图，仅管理员可以调整阈值或停用规则。</p>}
      <footer className="modal__footer"><PrimaryButton onClick={onClose}>完成</PrimaryButton></footer>
    </div>
  );
}

function AlertsPage({ alerts, setAlerts, alertRules, roleKey, projects, onViewProject, onUpdateRule, onRefresh }) {
  const [filter, setFilter] = useState("all");
  const [rulesOpen, setRulesOpen] = useState(false);
  const filtered = alerts.filter((alert) => filter === "all" || alert.level === filter || alert.status === filter);
  const resolve = (id) => setAlerts((current) => current.map((alert) => alert.id === id ? { ...alert, status: "已解决", resolvedAt: new Date().toISOString() } : alert));
  const todayNew = alerts.filter((alert) => isSameLocalDay(alert.createdAt)).length;
  const weekResolved = alerts.filter((alert) => alert.status === "已解决" && isInCurrentWeek(alert.resolvedAt)).length;
  return (
    <div className="standard-page alerts-page">
      <PageHeader eyebrow="ALERTS & EXECUTION" title="提醒中心" description="由规则引擎自动识别逾期、停滞、临期和周更新缺失" actions={<><GhostButton onClick={() => setRulesOpen(true)}><SettingOutlined /> 规则配置</GhostButton><GhostButton onClick={onRefresh}><ReloadOutlined /> 重新计算</GhostButton><PrimaryButton onClick={() => setAlerts((current) => current.map((alert) => ({ ...alert, status: "已确认" })))}><CheckOutlined /> 全部确认</PrimaryButton></>} />
      <div className="alert-summary"><Metric label="待处理" value={alerts.filter((a) => a.status === "待处理").length} inverse /><Metric label="红色风险" value={alerts.filter((a) => a.level === "red").length} inverse /><Metric label="今日新增" value={todayNew} /><Metric label="本周已闭环" value={weekResolved} /></div>
      <div className="alert-filter-tabs">{[{ key: "all", label: "全部" }, { key: "待处理", label: "待处理" }, { key: "red", label: "红色风险" }, { key: "yellow", label: "黄色关注" }, { key: "已解决", label: "已解决" }].map((item) => <button key={item.key} type="button" className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
      <div className="alert-list">{filtered.map((alert) => { const project = projects.find((item) => item.id === alert.projectId); return <article key={alert.id}><i className={`alert-icon alert-icon--${alert.level}`}>{alert.level === "red" ? <WarningFilled /> : <InfoCircleOutlined />}</i><div><header><strong>{alert.title}</strong><span className={`task-result ${alert.status === "已解决" ? "" : "task-result--warning"}`}>{alert.status}</span></header><p>{alert.description}</p><small>{project ? `${project.region} · ${project.owner} · ${project.name}` : "周更新与系统任务"} · {formatDateTime(alert.createdAt)}</small></div><div className="alert-actions">{project && <GhostButton onClick={() => onViewProject(project)}>查看项目</GhostButton>}{alert.status !== "已解决" && <PrimaryButton onClick={() => resolve(alert.id)}>标记解决</PrimaryButton>}</div></article>; })}{!filtered.length && <div className="empty-state"><BellOutlined /><strong>当前没有待处理提醒</strong><span>点击“规则配置”查看来源，或重新计算当前项目状态</span></div>}</div>
      {rulesOpen && <Modal title="提醒规则配置" onClose={() => setRulesOpen(false)} width={780}><AlertRuleSettings rules={alertRules} roleKey={roleKey} onUpdate={onUpdateRule} onClose={() => setRulesOpen(false)} /></Modal>}
    </div>
  );
}

function UserInviteForm({ onSubmit, onCancel, saving }) {
  const [form, setForm] = useState({ displayName: "", email: "", role: "sales" });
  return (
    <form className="project-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}>
      <div className="form-grid">
        <label className="span-2">姓名<input required value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label className="span-2">企业邮箱<input required type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
        <label className="span-2">角色<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}><option value="sales">销售</option><option value="presales">售前</option><option value="admin">管理员</option></select></label>
      </div>
      <footer className="modal__footer"><GhostButton onClick={onCancel}>取消</GhostButton><PrimaryButton type="submit" disabled={saving}>{saving ? <><LoadingOutlined spin /> 正在发送</> : <><UserOutlined /> 发送邀请</>}</PrimaryButton></footer>
    </form>
  );
}

function TemporaryCredentials({ credentials, onClose, onToast }) {
  const copyCredentials = async () => {
    try {
      await navigator.clipboard.writeText(`登录地址：https://keendata-jbk.github.io/battlemap/\n账号：${credentials.email}\n临时密码：${credentials.password}`);
      onToast("临时登录凭据已复制");
    } catch {
      onToast("复制失败，请手动选择凭据", "error");
    }
  };

  return (
    <div className="credential-handoff">
      <div className="credential-handoff__notice"><SafetyCertificateOutlined /><span><strong>用户已创建，邮件未发送</strong><small>Supabase 邮件服务触发限流，系统已启用临时密码兜底。该用户首次登录后必须修改密码。</small></span></div>
      <label>登录账号<input readOnly value={credentials.email} /></label>
      <label>临时密码<input readOnly value={credentials.password} /></label>
      <p>请通过企业微信、电话等安全渠道单独发送，不要在公开群聊中传递。</p>
      <footer className="modal__footer"><GhostButton onClick={onClose}>完成</GhostButton><PrimaryButton onClick={copyCredentials}><CopyOutlined /> 复制登录凭据</PrimaryButton></footer>
    </div>
  );
}

function SystemPage({ roleKey, onToast, initialUsers = [], onInviteUser, onToggleUser }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [temporaryCredentials, setTemporaryCredentials] = useState(null);
  useEffect(() => setUsers(initialUsers), [initialUsers]);
  const inviteUser = async (form) => {
    setInviteSaving(true);
    try {
      const result = await onInviteUser(form);
      setInviteOpen(false);
      if (result?.delivery === "temporary_password") setTemporaryCredentials({ email: form.email, password: result.temporaryPassword });
      else onToast("用户邀请已发送");
    } catch (error) {
      onToast(error.message || "用户邀请失败", "error");
    } finally {
      setInviteSaving(false);
    }
  };
  const toggleUser = async (user) => {
    const active = user.status !== "启用";
    try {
      await onToggleUser(user.id, active);
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, status: active ? "启用" : "停用" } : item));
      onToast(active ? "用户已启用" : "用户已停用");
    } catch (error) {
      onToast(error.message || "用户状态更新失败", "error");
    }
  };
  const tabs = [{ key: "users", label: "用户与团队", icon: TeamOutlined }, { key: "permissions", label: "角色权限", icon: SafetyCertificateOutlined }];
  const permissionRows = [["作战地图", "本人", "全部", "全部"], ["客户与商机", "维护本人", "查看全部", "全部管理"], ["BI 分析", "本人", "全部", "全部"], ["数据导入", "本人数据", "可见数据", "全部管理"], ["系统管理", "无", "无", "全部管理"]];
  const exportPermissions = () => exportCsv("营销作战地图_权限矩阵.csv", permissionRows.map((row) => ({ module: row[0], sales: row[1], presales: row[2], admin: row[3] })), [{ key: "module", label: "功能模块" }, { key: "sales", label: "销售" }, { key: "presales", label: "售前" }, { key: "admin", label: "管理员" }]);
  if (roleKey !== "admin") return <div className="standard-page"><div className="permission-denied"><SafetyCertificateOutlined /><h1>仅管理员可访问系统管理</h1><p>当前账号为 {ROLE_PRESETS[roleKey].label}，如需管理用户请联系管理员。</p></div></div>;
  return (
    <div className="standard-page system-page">
      <PageHeader eyebrow="SYSTEM ADMINISTRATION" title="系统管理" description="管理真实企业用户并核对数据库权限范围" />
      <div className="system-tabs">{tabs.map((item) => { const Icon = item.icon; return <button key={item.key} type="button" className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}><Icon />{item.label}</button>; })}</div>
      {tab === "users" && <article className="settings-card"><header><div><p>USERS & TEAMS</p><h2>组织用户</h2></div><PrimaryButton onClick={() => setInviteOpen(true)}><PlusOutlined /> 添加用户</PrimaryButton></header><table className="data-table"><thead><tr><th>用户</th><th>角色</th><th>团队</th><th>数据范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="user-cell"><span className="avatar avatar--small">{user.name.slice(0, 1)}</span><strong>{user.name}</strong></div></td><td>{user.role}</td><td>{user.team}</td><td>{user.role === "销售" ? "本人数据" : "全部数据"}</td><td><span className={`task-result ${user.status === "停用" ? "task-result--muted" : ""}`}>{user.status}</span></td><td><button type="button" className="link-button" onClick={() => toggleUser(user)}>{user.status === "启用" ? "停用" : "启用"}</button></td></tr>)}{!users.length && <tr><td colSpan="6"><div className="empty-state"><TeamOutlined /><strong>暂无企业用户</strong></div></td></tr>}</tbody></table></article>}
      {tab === "permissions" && <article className="settings-card"><header><div><p>ROLE-BASED ACCESS</p><h2>角色与数据库权限范围</h2></div><GhostButton onClick={exportPermissions}><DownloadOutlined /> 导出矩阵</GhostButton></header><table className="permission-table"><thead><tr><th>功能模块</th><th>销售</th><th>售前</th><th>管理员</th></tr></thead><tbody>{permissionRows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${index}`}>{index === 0 ? <strong>{cell}</strong> : <span className={cell === "无" ? "permission-none" : "permission-yes"}>{cell !== "无" && <CheckOutlined />} {cell}</span>}</td>)}</tr>)}</tbody></table></article>}
      {inviteOpen && <Modal title="邀请企业用户" onClose={() => setInviteOpen(false)} width={520}><UserInviteForm onSubmit={inviteUser} onCancel={() => setInviteOpen(false)} saving={inviteSaving} /></Modal>}
      {temporaryCredentials && <Modal title="临时登录凭据" onClose={() => setTemporaryCredentials(null)} width={520}><TemporaryCredentials credentials={temporaryCredentials} onClose={() => setTemporaryCredentials(null)} onToast={onToast} /></Modal>}
    </div>
  );
}

export function App() {
  const auth = useAuth();
  const [backendProjects, setBackendProjects] = useState([]);
  const [backendAlerts, setBackendAlerts] = useState([]);
  const [operations, setOperations] = useState({ customers: [], importJobs: [], auditLogs: [], weeklyUpdates: [], alertRules: [], dailyReportImports: [] });
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [activePage, setActivePage] = useState("map");
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [detailProject, setDetailProject] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState([]);
  const [toast, setToast] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const dataLoadedRef = useRef(false);

  const projects = backendProjects;
  const alerts = backendAlerts;
  const roleKey = auth.profile?.role ?? "sales";
  const currentUser = auth.profile;

  const applyBackendData = useCallback((data) => {
    setBackendProjects(data.projects);
    setBackendAlerts(data.alerts);
    setOperations({ customers: data.customers, importJobs: data.importJobs, auditLogs: data.auditLogs, weeklyUpdates: data.weeklyUpdates, alertRules: data.alertRules, dailyReportImports: data.dailyReportImports ?? [] });
  }, []);

  const refreshBackendData = useCallback(async () => {
    const currentUserId = auth.session?.user?.id;
    if (!auth.backendConfigured || !currentUserId || !auth.profile) return;
    if (!dataLoadedRef.current) setDataLoading(true);
    setDataError("");
    try {
      const [data, users] = await Promise.all([loadBackendData(), loadDirectory()]);
      applyBackendData(data);
      setDirectoryUsers(users);
      dataLoadedRef.current = true;
    } catch (error) {
      setDataError(error.message || "后端数据加载失败");
    } finally {
      setDataLoading(false);
    }
  }, [applyBackendData, auth.backendConfigured, auth.profile, auth.session?.user?.id]);

  useEffect(() => {
    refreshBackendData();
  }, [refreshBackendData]);

  const visibleProjects = projects;

  useEffect(() => {
    if (selectedProjectId && !visibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(visibleProjects[0]?.id ?? null);
    }
  }, [selectedProjectId, visibleProjects]);

  const notify = (message, type = "success") => setToast({ message, type, id: Date.now() });

  const openCreate = () => {
    setEditingProject(null);
    setFormOpen(true);
  };

  const openEdit = (project) => {
    setDetailProject(null);
    setEditingProject(project);
    setFormOpen(true);
  };

  const saveProject = async (form) => {
    setSavingProject(true);
    try {
      await saveBackendProject(form, editingProject, auth.session.user.id);
      await refreshBackendData();
      notify(editingProject ? "项目已更新" : "新项目已创建并同步到地图");
      setFormOpen(false);
      setEditingProject(null);
    } catch (error) {
      notify(error.message || "项目保存失败", "error");
    } finally {
      setSavingProject(false);
    }
  };

  const confirmDelete = async () => {
    const ids = bulkDeleteIds.length ? bulkDeleteIds : deleteTarget ? [deleteTarget.id] : [];
    if (!ids.length) return;
    try {
      await softDeleteBackendProjects(ids);
      await refreshBackendData();
      notify(ids.length > 1 ? `已移入回收站 ${ids.length} 条记录` : "项目已移入回收站");
      setBulkDeleteIds([]);
      setDeleteTarget(null);
    } catch (error) {
      notify(error.message || "删除失败", "error");
    }
  };

  const applyAlertUpdate = (updater) => {
    const previous = alerts;
    const next = typeof updater === "function" ? updater(previous) : updater;
    setBackendAlerts(next);
    updateBackendAlerts(next, previous).catch((error) => {
      setBackendAlerts(previous);
      notify(error.message || "提醒状态更新失败", "error");
    });
  };

  const importRows = async (rows, fileName) => {
    try {
      const data = await importBackendProjects(rows, { fileName, currentUserId: auth.session.user.id });
      applyBackendData(data);
      setImportOpen(false);
      notify(`已完成 ${rows.length} 条项目数据入库`);
    } catch (error) {
      notify(error.message || "批量导入失败，数据库未写入", "error");
    }
  };

  const inviteUser = async (input) => {
    const result = await createBackendUser(input);
    await refreshBackendData();
    return result;
  };

  const toggleUser = async (userId, active) => {
    await setBackendUserActive(userId, active);
    await refreshBackendData();
  };

  const saveSalesWeek = async (input) => {
    try {
      await saveWeeklyUpdate(input, auth.session.user.id);
      await refreshBackendData();
      notify(input.status === "submitted" ? "本周行动更新已提交" : "周更新草稿已保存");
    } catch (error) {
      notify(error.message || "周更新保存失败", "error");
      throw error;
    }
  };

  const analyzeSalesDailyReport = async (rawText, defaultDate) => analyzeDailyReport(rawText, defaultDate);

  const saveSalesDailyReport = async (rawText, defaultDate, entries) => {
    const result = await importDailyReport(rawText, defaultDate, entries);
    await refreshBackendData();
    notify(`已将 ${result.imported_count ?? entries.length} 条日报记录写入项目`);
    return result;
  };

  const saveAlertRule = async (input) => {
    try {
      await updateAlertRule(input);
      await refreshBackendData();
      notify("提醒规则已更新");
    } catch (error) {
      notify(error.message || "提醒规则更新失败", "error");
      throw error;
    }
  };

  const loadDailyReportDraft = useCallback(() => loadWorkspaceState("daily_report_draft"), []);
  const saveDailyReportDraft = useCallback((state) => saveWorkspaceState("daily_report_draft", state, auth.session?.user?.id), [auth.session?.user?.id]);
  const clearDailyReportDraft = useCallback(() => clearWorkspaceState("daily_report_draft"), []);
  const loadMarketingHistory = useCallback(() => loadWorkspaceState("marketing_qa_history"), []);
  const saveMarketingHistory = useCallback((messages) => saveWorkspaceState("marketing_qa_history", { messages }, auth.session?.user?.id), [auth.session?.user?.id]);
  const clearMarketingHistory = useCallback(() => clearWorkspaceState("marketing_qa_history"), []);

  if (!auth.backendConfigured) return <DataErrorScreen message="系统未配置 Supabase 生产环境，已禁止使用本地模拟数据。" onRetry={() => window.location.reload()} />;
  if ((auth.passwordSetupRequired || auth.profile?.password_change_required) && auth.session) return <PasswordSetupScreen onComplete={auth.completePasswordSetup} error={auth.error} forced={Boolean(auth.profile?.password_change_required)} />;
  if (auth.loading) return <AppLoadingScreen />;
  if (!auth.session) return <LoginScreen onSignIn={auth.signIn} onRequestPasswordReset={auth.requestPasswordReset} error={auth.error} />;
  if (auth.error && !auth.profile) return <DataErrorScreen message={auth.error} onRetry={() => window.location.reload()} onSignOut={auth.signOut} />;
  if (!auth.profile) return <AppLoadingScreen />;
  if (!auth.profile.active) return <AccountBlockedScreen onSignOut={auth.signOut} />;
  if (dataLoading) return <AppLoadingScreen message="正在加载营销数据" />;
  if (dataError) return <DataErrorScreen message={dataError} onRetry={refreshBackendData} onSignOut={auth.signOut} />;

  const page = (() => {
    switch (activePage) {
      case "map": return <MapPage projects={visibleProjects} alerts={alerts} roleKey={roleKey} currentUserName={currentUser.display_name} selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onGoToProject={setDetailProject} onOpenAlerts={() => setActivePage("alerts")} onRefresh={refreshBackendData} />;
      case "workbench": return <WorkbenchPage projects={visibleProjects} weeklyUpdates={operations.weeklyUpdates} dailyReportImports={operations.dailyReportImports} users={directoryUsers} roleKey={roleKey} currentUserId={auth.session.user.id} currentUserName={currentUser.display_name} onSaveWeekly={saveSalesWeek} onAnalyzeDailyReport={analyzeSalesDailyReport} onImportDailyReport={saveSalesDailyReport} onLoadDailyDraft={loadDailyReportDraft} onSaveDailyDraft={saveDailyReportDraft} onClearDailyDraft={clearDailyReportDraft} onCreate={openCreate} onView={setDetailProject} onEdit={openEdit} onDelete={setDeleteTarget} onBulkDelete={setBulkDeleteIds} />;
      case "analysis": return <AnalysisPage projects={visibleProjects} roleKey={roleKey} onAsk={askMarketingData} onLoadHistory={loadMarketingHistory} onSaveHistory={saveMarketingHistory} onClearHistory={clearMarketingHistory} />;
      case "management": return <ManagementPage projects={visibleProjects} operations={operations} users={directoryUsers} roleKey={roleKey} onCreate={openCreate} onImportOpen={() => setImportOpen(true)} onRefresh={refreshBackendData} />;
      case "alerts": return <AlertsPage alerts={alerts} setAlerts={applyAlertUpdate} alertRules={operations.alertRules} roleKey={roleKey} projects={visibleProjects} onViewProject={setDetailProject} onUpdateRule={saveAlertRule} onRefresh={refreshBackendData} />;
      case "system": return <SystemPage roleKey={roleKey} onToast={notify} initialUsers={directoryUsers} onInviteUser={inviteUser} onToggleUser={toggleUser} />;
      default: return null;
    }
  })();

  return (
    <div className={`app-shell app-shell--${activePage}`}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} roleKey={roleKey} setRoleKey={() => {}} alertsCount={alerts.filter((alert) => alert.status === "待处理").length} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} currentUser={currentUser} productionMode onSignOut={auth.signOut} />
      <div className="app-content">{page}</div>
      {detailProject && <DetailModal project={detailProject} onClose={() => setDetailProject(null)} onEdit={openEdit} users={directoryUsers} />}
      {formOpen && <Modal title={editingProject ? "编辑项目" : "新建项目"} onClose={() => setFormOpen(false)}><ProjectForm initialProject={editingProject} onSubmit={saveProject} onCancel={() => setFormOpen(false)} users={directoryUsers} saving={savingProject} roleKey={roleKey} currentUserId={auth.session.user.id} /></Modal>}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={importRows} />}
      {(deleteTarget || bulkDeleteIds.length > 0) && <Modal title="确认移入回收站" onClose={() => { setDeleteTarget(null); setBulkDeleteIds([]); }} width={480}><div className="confirm-dialog"><WarningFilled /><p>记录将从地图、分析和工作台中移除，管理员仍可在回收站恢复。</p></div><footer className="modal__footer"><GhostButton onClick={() => { setDeleteTarget(null); setBulkDeleteIds([]); }}>取消</GhostButton><PrimaryButton className="danger-primary" onClick={confirmDelete}>确认删除</PrimaryButton></footer></Modal>}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
