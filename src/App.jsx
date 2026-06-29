import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FilterOutlined,
  FullscreenOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoreOutlined,
  PieChartOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  RightOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SearchOutlined,
  SettingOutlined,
  TableOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { ChinaBattleMap, EChart } from "./ECharts.jsx";
import { useAuth } from "./auth/AuthProvider.jsx";
import { AccountBlockedScreen, AppLoadingScreen, DataErrorScreen, LoginScreen } from "./components/AuthScreens.jsx";
import {
  CATEGORY_META,
  INITIAL_ALERTS,
  INITIAL_PROJECTS,
  ROLE_PRESETS,
  SAVED_VIEWS,
  STAGES,
  USERS,
} from "./data.js";
import {
  createRegionBoundary,
  getBoundaryRequest,
  getProjectAdcode,
  loadBoundary,
  nextDrillItem,
  projectMatchesMapScope,
} from "./services/mapService.js";
import {
  createBackendUser,
  loadBackendData,
  loadDirectory,
  importBackendProjects,
  saveBackendProject,
  setBackendUserActive,
  softDeleteBackendProjects,
  updateBackendAlerts,
} from "./services/backendRepository.js";
import logo from "./assets/keendata-logo.png";

const NAV_ITEMS = [
  { key: "map", label: "作战地图", icon: EnvironmentOutlined },
  { key: "workbench", label: "数据工作台", icon: AppstoreOutlined },
  { key: "analysis", label: "BI 分析", icon: BarChartOutlined },
  { key: "management", label: "数据管理", icon: DatabaseOutlined },
  { key: "alerts", label: "提醒中心", icon: BellOutlined, badge: 12 },
  { key: "system", label: "系统管理", icon: SettingOutlined },
];

const HEALTH_META = {
  green: { label: "正常", color: "#18a879" },
  yellow: { label: "关注", color: "#f49b22" },
  red: { label: "高风险", color: "#ef4d4d" },
  gray: { label: "暂停", color: "#8a98ac" },
};

function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

function formatMoney(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
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
  const currentRole = { ...ROLE_PRESETS[roleKey], user: currentUser?.display_name ?? ROLE_PRESETS[roleKey].user };

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
          const badge = item.key === "alerts" ? alertsCount : item.badge;
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
  savedView,
  setSavedView,
  alerts,
  onSelectAlert,
  dataUpdatedAt,
}) {
  const activeProjects = projects.filter((project) => project.stage !== "won");
  const highValue = projects.filter((project) => project.amount >= 5000).length;
  const expected = projects.reduce((sum, project) => sum + project.amount * (getStage(project.stage).probability / 100), 0);
  const won = projects.filter((project) => project.stage === "won").length;
  const winRate = projects.length ? Math.round((won / projects.length) * 100) : 0;

  return (
    <aside className="command-panel">
      <div className="command-panel__heading">
        <div>
          <h1>营销作战总览</h1>
          <p>数据截至：{dataUpdatedAt}</p>
        </div>
        <ReloadOutlined title="刷新数据" />
      </div>
      <div className="metric-grid">
        <Metric label="项目总数" value={projects.length} trend="18%" />
        <Metric label="预计成交（万元）" value={formatMoney(expected)} trend="22%" />
        <Metric label="本月新增项目" value={Math.min(8, projects.length)} trend="26%" />
        <Metric label="推进中项目" value={activeProjects.length} />
        <Metric label="高价值项目（≥500万）" value={highValue} trend="15%" />
        <Metric label="赢单率（近90天）" value={winRate} suffix="%" trend="3pp" />
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

      <section className="command-section command-section--views">
        <header>
          <h2>我的视图</h2>
          <button type="button">管理</button>
        </header>
        <div className="saved-view-list">
          {SAVED_VIEWS.map((view) => (
            <button
              type="button"
              key={view.id}
              className={savedView === view.id ? "is-selected" : ""}
              onClick={() => setSavedView(savedView === view.id ? null : view.id)}
            >
              <span>★</span>
              <em>{view.name}</em>
              <time>{view.date.slice(5)}</time>
            </button>
          ))}
        </div>
      </section>

      <section className="command-section command-section--alerts">
        <header>
          <h2>待处理提醒</h2>
          <button type="button">全部查看（{alerts.filter((alert) => alert.status === "待处理").length}）</button>
        </header>
        <div className="mini-alert-list">
          {alerts.slice(0, 3).map((alert) => (
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
          <dd>{project.nextAction}（{project.nextActionDate.slice(5)}）</dd>
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

function MapToolbar({ search, setSearch, regionMode, setRegionMode, layersOpen, setLayersOpen, filtersOpen, setFiltersOpen, alertsOpen, setAlertsOpen, currentUserName = "用户" }) {
  return (
    <div className="map-toolbar">
      <div className="segmented-control">
        {["全国", "华东", "西南"].map((mode) => (
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
          <b>12</b>
        </button>
        <span className="avatar avatar--small">{currentUserName.slice(0, 1)}</span>
        <strong>{currentUserName}</strong>
        <DownOutlined />
      </div>
    </div>
  );
}

function MapPage({ projects, alerts, onSelectProject, selectedProjectId, onGoToProject, roleKey, currentUserName }) {
  const [layers, setLayers] = useState(Object.fromEntries(Object.keys(CATEGORY_META).map((key) => [key, true])));
  const [search, setSearch] = useState("");
  const [regionMode, setRegionMode] = useState("全国");
  const [drillPath, setDrillPath] = useState([]);
  const [geoJson, setGeoJson] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [mapReloadToken, setMapReloadToken] = useState(0);
  const [savedView, setSavedView] = useState(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [regionFilter, setRegionFilter] = useState("全部区域");
  const [healthFilter, setHealthFilter] = useState("全部健康度");
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const request = getBoundaryRequest(drillPath);
    setMapLoading(true);
    setMapError("");
    loadBoundary(request.adcode, { full: request.full, signal: controller.signal })
      .then((boundary) => {
        if (controller.signal.aborted) return;
        setGeoJson(drillPath.length ? boundary : createRegionBoundary(boundary, regionMode));
        setMapLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMapError(error.message || "地图边界加载失败");
        setMapLoading(false);
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
    if (savedView) {
      const view = SAVED_VIEWS.find((item) => item.id === savedView);
      if (view?.filter.region) rows = rows.filter((project) => project.region === view.filter.region);
      if (view?.filter.priority) rows = rows.filter((project) => project.priority === view.filter.priority);
      if (view?.filter.health) rows = rows.filter((project) => project.health === view.filter.health);
      if (view?.filter.category) rows = rows.filter((project) => project.category === view.filter.category);
      if (view?.filter.minAmount) rows = rows.filter((project) => project.amount >= view.filter.minAmount);
    }
    return rows;
  }, [projects, layers, search, regionMode, drillPath, regionFilter, healthFilter, savedView]);

  const selectedProject = filteredProjects.find((project) => project.id === selectedProjectId);
  const currentMapLevel = drillPath.at(-1)?.level ?? (regionMode === "全国" ? "country" : "region");

  const changeRegion = useCallback((mode) => {
    setRegionMode(mode);
    setDrillPath([]);
    onSelectProject(null);
  }, [onSelectProject]);

  const drillInto = useCallback((properties) => {
    const next = nextDrillItem(properties);
    if (!next || drillPath.at(-1)?.level === "district") return;
    setDrillPath((current) => [...current, next]);
    onSelectProject(null);
  }, [drillPath, onSelectProject]);

  const goToCrumb = useCallback((index) => {
    setDrillPath((current) => current.slice(0, index + 1));
    onSelectProject(null);
  }, [onSelectProject]);

  return (
    <div className={`map-page ${fullScreen ? "map-page--fullscreen" : ""}`}>
      <MapCommandPanel
        projects={projects}
        layers={layers}
        setLayers={setLayers}
        savedView={savedView}
        setSavedView={setSavedView}
        alerts={alerts}
        dataUpdatedAt="2026-06-29 14:40"
        onSelectAlert={(alert) => onSelectProject(alert.projectId)}
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
        />
        <div className="map-breadcrumb">
          <button type="button" onClick={() => changeRegion("全国")}>中国</button>
          <RightOutlined />
          <button type="button" className={!drillPath.length ? "is-current" : ""} onClick={() => { setDrillPath([]); onSelectProject(null); }}>
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
          />
          {mapLoading && <div className="map-state"><LoadingOutlined spin /><strong>正在加载行政区边界</strong><span>支持省、市、区县逐级下钻</span></div>}
          {mapError && <div className="map-state map-state--error"><InfoCircleOutlined /><strong>{mapError}</strong><button type="button" onClick={() => setMapReloadToken((value) => value + 1)}>重新加载</button></div>}
          {!mapLoading && !mapError && currentMapLevel !== "district" && (
            <div className="map-drill-hint"><AimOutlined /> 点击地图进入下一级</div>
          )}
          <div className="map-controls">
            <IconButton label="全屏" onClick={() => setFullScreen((value) => !value)}><FullscreenOutlined /></IconButton>
            <IconButton label={drillPath.length ? "返回上一级" : "定位到当前区域"} onClick={() => { if (drillPath.length) setDrillPath((current) => current.slice(0, -1)); else setMapReloadToken((value) => value + 1); onSelectProject(null); }}><AimOutlined /></IconButton>
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
              <label>经营区域<select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}><option>全部区域</option><option>华东区域</option><option>西南区域</option></select></label>
              <label>项目健康度<select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}><option>全部健康度</option><option value="green">正常</option><option value="yellow">关注</option><option value="red">高风险</option></select></label>
              <GhostButton onClick={() => { setRegionFilter("全部区域"); setHealthFilter("全部健康度"); }}>重置筛选</GhostButton>
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

function ProjectForm({ initialProject, onSubmit, onCancel, users = USERS, saving = false }) {
  const salesUsers = users.filter((user) => user.roleKey === "sales" || user.role === "销售" || user.role === "销售经理");
  const ownerUsers = salesUsers.length ? salesUsers : users;
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
    province: "浙江",
    city: "杭州",
    district: "滨江区",
    adcode: "330108",
    coordinates: [120.19, 30.19],
    amount: 1000,
    stage: "lead",
    owner: defaultOwner,
    presales: defaultPresales,
    health: "green",
    priority: "P2",
    nextAction: "首次拜访",
    nextActionDate: "2026-07-05",
    expectedClose: "2026-12-31",
    source: "手工录入",
    risk: "暂无重大风险",
  });
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const locateByAdcode = async () => {
    if (!/^\d{6}$/.test(form.adcode || "")) {
      setLocationMessage("请输入六位行政区划代码");
      return;
    }
    setLocating(true);
    setLocationMessage("");
    try {
      const boundary = await loadBoundary(form.adcode, { full: false });
      const properties = boundary.features[0]?.properties;
      const center = properties?.centroid ?? properties?.center;
      if (!center) throw new Error("该行政区暂无中心点");
      update("coordinates", center);
      setLocationMessage(`已定位：${properties.name}`);
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
        <label>经营区域<select value={form.region} onChange={(event) => update("region", event.target.value)}><option>华东区域</option><option>西南区域</option></select></label>
        <label>省份<input value={form.province} onChange={(event) => update("province", event.target.value)} /></label>
        <label>城市<input value={form.city} onChange={(event) => update("city", event.target.value)} /></label>
        <label>区县<input value={form.district} onChange={(event) => update("district", event.target.value)} /></label>
        <label>行政区划代码<div className="field-with-action"><input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={form.adcode} onChange={(event) => update("adcode", event.target.value.replace(/\D/g, ""))} /><button type="button" onClick={locateByAdcode} disabled={locating}>{locating ? "定位中" : "自动定位"}</button></div>{locationMessage && <small className="field-message">{locationMessage}</small>}</label>
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
      </div>
      <footer className="modal__footer">
        <GhostButton onClick={onCancel}>取消</GhostButton>
        <PrimaryButton type="submit" disabled={saving}>{saving ? <><LoadingOutlined spin /> 正在保存</> : <><SaveOutlined /> 保存项目</>}</PrimaryButton>
      </footer>
    </form>
  );
}

function DetailModal({ project, onClose, onEdit }) {
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
          <ol><li><b>今天</b><span>系统生成项目健康度检查，当前为「{HEALTH_META[project.health].label}」</span></li><li><b>06-28</b><span>{project.owner} 更新下一步动作：{project.nextAction}</span></li><li><b>06-26</b><span>{project.presales} 上传解决方案材料</span></li></ol>
        </section>
      </div>
      <footer className="modal__footer">
        <GhostButton onClick={onClose}>关闭</GhostButton>
        <PrimaryButton onClick={() => onEdit(project)}><EditOutlined /> 编辑项目</PrimaryButton>
      </footer>
    </Modal>
  );
}

function FilterBar({ filters, setFilters, onCreate, onExport, resultCount }) {
  return (
    <div className="filter-bar">
      <label className="standard-search"><SearchOutlined /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="搜索项目、客户、区县" /></label>
      <select value={filters.region} onChange={(event) => setFilters((current) => ({ ...current, region: event.target.value }))}><option>全部区域</option><option>华东区域</option><option>西南区域</option></select>
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

function CalendarView({ projects, onView }) {
  const grouped = projects.reduce((acc, project) => {
    acc[project.nextActionDate] ??= [];
    acc[project.nextActionDate].push(project);
    return acc;
  }, {});
  return (
    <div className="calendar-view">
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => (
        <section key={date}><header><CalendarOutlined /><strong>{date}</strong><span>{rows.length} 项任务</span></header><div>{rows.map((project) => <button type="button" key={project.id} onClick={() => onView(project)}><i style={{ background: CATEGORY_META[project.category].color }} /><span><strong>{project.nextAction}</strong><small>{project.name}</small></span><em>{project.owner}</em></button>)}</div></section>
      ))}
    </div>
  );
}

function WorkbenchPage({ projects, onCreate, onView, onEdit, onDelete, onBulkDelete }) {
  const [view, setView] = useState("table");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filters, setFilters] = useState({ search: "", region: "全部区域", category: "all", stage: "all" });
  const filtered = projects.filter((project) => {
    const keyword = filters.search.trim().toLowerCase();
    if (keyword && ![project.name, project.account, project.city, project.district].join(" ").toLowerCase().includes(keyword)) return false;
    if (filters.region !== "全部区域" && project.region !== filters.region) return false;
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
      <PageHeader eyebrow="MULTI-DIMENSIONAL WORKBENCH" title="数据工作台" description="像多维表格一样定位、筛选和推进所有营销项目" actions={<><GhostButton><SaveOutlined /> 保存视图</GhostButton><PrimaryButton onClick={onCreate}><PlusOutlined /> 新建项目</PrimaryButton></>} />
      <section className="view-strip">
        <div>{[{ key: "table", label: "表格", icon: TableOutlined }, { key: "kanban", label: "阶段看板", icon: AppstoreOutlined }, { key: "calendar", label: "行动日历", icon: CalendarOutlined }].map((item) => { const Icon = item.icon; return <button key={item.key} type="button" className={view === item.key ? "is-active" : ""} onClick={() => setView(item.key)}><Icon />{item.label}</button>; })}</div>
        <span>当前视图：<strong>全部项目作战总表</strong></span>
      </section>
      <FilterBar filters={filters} setFilters={setFilters} onCreate={onCreate} onExport={handleExport} resultCount={filtered.length} />
      {selectedIds.length > 0 && <div className="bulk-bar"><span>已选择 <strong>{selectedIds.length}</strong> 条记录</span><GhostButton onClick={() => setSelectedIds([])}>取消选择</GhostButton><GhostButton className="danger-button" onClick={() => { onBulkDelete(selectedIds); setSelectedIds([]); }}><DeleteOutlined /> 批量删除</GhostButton></div>}
      {view === "table" && <ProjectTable projects={filtered} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onView={onView} onEdit={onEdit} onDelete={onDelete} />}
      {view === "kanban" && <KanbanView projects={filtered} onView={onView} />}
      {view === "calendar" && <CalendarView projects={filtered} onView={onView} />}
    </div>
  );
}

function AnalysisPage({ projects }) {
  const total = projects.reduce((sum, project) => sum + project.amount, 0);
  const weighted = projects.reduce((sum, project) => sum + project.amount * getStage(project.stage).probability / 100, 0);
  const highRisk = projects.filter((project) => project.health === "red").length;
  const regionData = ["华东区域", "西南区域"].map((region) => ({ name: region, value: projects.filter((project) => project.region === region).reduce((sum, project) => sum + project.amount, 0) }));
  const categoryData = Object.entries(CATEGORY_META).map(([key, meta]) => ({ name: meta.label, value: projects.filter((project) => project.category === key).reduce((sum, project) => sum + project.amount, 0), itemStyle: { color: meta.color } }));
  const stageData = STAGES.map((stage) => ({ name: stage.label, value: projects.filter((project) => project.stage === stage.key).length }));
  const ownerNames = [...new Set(projects.map((project) => project.owner))];
  const ownerData = ownerNames.map((owner) => ({ name: owner, value: projects.filter((project) => project.owner === owner).reduce((sum, project) => sum + project.amount, 0) }));

  const commonText = { color: "#526079", fontFamily: "Inter, PingFang SC, sans-serif" };
  const axis = { axisLine: { lineStyle: { color: "#dce4ef" } }, axisLabel: { ...commonText, fontSize: 11 }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#edf1f6" } } };

  return (
    <div className="standard-page analysis-page">
      <PageHeader eyebrow="EXECUTIVE BUSINESS INTELLIGENCE" title="BI 分析" description="统一口径洞察区域、阶段、客户和销售经营表现" actions={<><GhostButton><CalendarOutlined /> 2026 年度</GhostButton><PrimaryButton onClick={() => window.print()}><DownloadOutlined /> 导出经营报告</PrimaryButton></>} />
      <div className="analysis-kpis">
        <Metric label="商机总额（万元）" value={formatMoney(total)} trend="18.6%" />
        <Metric label="加权管道（万元）" value={formatMoney(weighted)} trend="21.2%" />
        <Metric label="活跃项目" value={projects.filter((project) => !["won"].includes(project.stage)).length} trend="12.8%" />
        <Metric label="红色风险" value={highRisk} trend={highRisk ? "需关注" : "0"} inverse />
      </div>
      <div className="dashboard-grid">
        <article className="chart-card chart-card--wide"><header><div><p>PIPELINE TREND</p><h2>30 / 60 / 90 天成交预测</h2></div><MoreOutlined /></header><EChart className="chart" ariaLabel="成交预测折线图" option={{ tooltip: { trigger: "axis" }, legend: { right: 8, top: 2, textStyle: commonText }, grid: { left: 48, right: 20, top: 52, bottom: 34 }, xAxis: { type: "category", data: ["当前", "+30 天", "+60 天", "+90 天"], ...axis }, yAxis: { type: "value", ...axis }, series: [{ name: "基准预测", type: "line", data: [weighted * .18, weighted * .42, weighted * .71, weighted], smooth: true, symbolSize: 8, lineStyle: { width: 3, color: "#1677ff" }, itemStyle: { color: "#1677ff" }, areaStyle: { color: "rgba(22,119,255,.08)" } }, { name: "乐观预测", type: "line", data: [weighted * .2, weighted * .5, weighted * .84, weighted * 1.18], smooth: true, lineStyle: { width: 2, type: "dashed", color: "#59a8ff" }, itemStyle: { color: "#59a8ff" } }] }} /></article>
        <article className="chart-card"><header><div><p>CATEGORY MIX</p><h2>五类资源金额结构</h2></div><PieChartOutlined /></header><EChart className="chart" ariaLabel="资源类型饼图" option={{ tooltip: { trigger: "item" }, legend: { bottom: 0, textStyle: commonText }, series: [{ type: "pie", radius: [52, 82], center: ["50%", "43%"], itemStyle: { borderColor: "#fff", borderWidth: 3 }, label: { formatter: "{b}\n{d}%", ...commonText, fontSize: 10 }, data: categoryData }] }} /></article>
        <article className="chart-card"><header><div><p>REGIONAL PERFORMANCE</p><h2>区域商机金额</h2></div><BarChartOutlined /></header><EChart className="chart" ariaLabel="区域金额柱状图" option={{ tooltip: { trigger: "axis" }, grid: { left: 56, right: 20, top: 20, bottom: 32 }, xAxis: { type: "category", data: regionData.map((item) => item.name), ...axis }, yAxis: { type: "value", ...axis }, series: [{ type: "bar", barWidth: 28, data: regionData.map((item) => ({ value: item.value, itemStyle: { color: item.name === "华东区域" ? "#1677ff" : "#55a6ff", borderRadius: [5, 5, 0, 0] } })) }] }} /></article>
        <article className="chart-card"><header><div><p>SALES FUNNEL</p><h2>项目阶段漏斗</h2></div><ProjectOutlined /></header><EChart className="chart" ariaLabel="销售漏斗图" option={{ tooltip: { trigger: "item" }, series: [{ type: "funnel", left: "12%", top: 18, bottom: 12, width: "76%", sort: "descending", gap: 2, label: { show: true, position: "inside", color: "#fff", formatter: "{b} {c}" }, itemStyle: { borderColor: "#fff", borderWidth: 2 }, color: ["#0f4da8", "#1263c9", "#1677ff", "#3b90ff", "#67aaff", "#8fc1ff"], data: stageData }] }} /></article>
        <article className="chart-card"><header><div><p>OWNER RANKING</p><h2>负责人管道排名</h2></div><TeamOutlined /></header><EChart className="chart" ariaLabel="负责人管道排名" option={{ tooltip: { trigger: "axis" }, grid: { left: 48, right: 28, top: 22, bottom: 32 }, xAxis: { type: "category", data: ownerData.map((item) => item.name), ...axis }, yAxis: { type: "value", ...axis }, series: [{ type: "bar", barWidth: 24, data: ownerData.map((item, index) => ({ value: item.value, itemStyle: { color: ["#1677ff", "#4e9dff", "#86bcff"][index % 3], borderRadius: [5, 5, 0, 0] } })) }] }} /></article>
      </div>
    </div>
  );
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function parseImportCsv(content) {
  const lines = String(content).replace(/^\ufeff/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const categoryMap = Object.fromEntries(Object.entries(CATEGORY_META).map(([key, meta]) => [meta.label, key]));
  const stageMap = Object.fromEntries(STAGES.map((stage) => [stage.label, stage.key]));
  return lines.slice(1, 10001).map((line, index) => {
    const values = parseCsvLine(line);
    const source = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const data = {
      name: source["项目名称"], account: source["客户主体"], contactName: source["关键联系人"] || "", contactMobile: source["联系人手机号"] || "", contactEmail: source["联系人邮箱"] || "", category: categoryMap[source["项目类型"]] ?? source["项目类型"] ?? "government",
      region: source["经营区域"] || "华东区域", province: source["省份"], city: source["城市"], district: source["区县"], adcode: source["行政区划代码"],
      coordinates: [Number(source["经度"]), Number(source["纬度"])], amount: Number(source["金额（万元）"] || 0), owner: source["负责人"], presales: source["售前负责人"] || "",
      stage: stageMap[source["销售阶段"]] ?? source["销售阶段"] ?? "lead", health: "green", priority: source["优先级"] || "P2",
      nextAction: source["下一步动作"] || "首次跟进", nextActionDate: source["计划日期"] || new Date().toISOString().slice(0, 10), expectedClose: source["预计成交日期"] || "",
      source: "批量导入", risk: "暂无重大风险",
    };
    const missing = ["name", "account", "province", "city", "district", "adcode", "owner"].filter((key) => !data[key]);
    if (!/^\d{6}$/.test(data.adcode || "")) missing.push("行政区划代码格式");
    if (!Number.isFinite(data.coordinates[0]) || !Number.isFinite(data.coordinates[1])) missing.push("地图坐标");
    return { row: index + 2, data, status: missing.length ? "需修正" : "通过", error: missing.join("、") };
  });
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
        {step === "upload" ? <PrimaryButton disabled={!file} onClick={inspect}><FileExcelOutlined /> 开始预检</PrimaryButton> : <PrimaryButton disabled={!preview.length || preview.some((row) => row.status !== "通过") || submitting} onClick={async () => { setSubmitting(true); await onImport(preview.map((row) => row.data)); setSubmitting(false); }}>{submitting ? <><LoadingOutlined spin /> 正在导入</> : <><UploadOutlined /> 确认导入</>}</PrimaryButton>}
      </footer>
    </Modal>
  );
}

function ManagementPage({ projects, onCreate, onImportOpen, onToast }) {
  const projectCount = Math.max(projects.length, 1);
  const quality = {
    region: Math.round((projects.filter((project) => project.district).length / projectCount) * 100),
    owner: Math.round((projects.filter((project) => project.owner).length / projectCount) * 100),
    next: Math.round((projects.filter((project) => project.nextAction).length / projectCount) * 100),
    contact: projects.length ? 86 : 0,
  };
  const downloadTemplate = () => exportCsv("营销作战地图_导入模板.csv", [{ name: "示例项目", account: "示例客户", contactName: "示例联系人", contactMobile: "", contactEmail: "", category: "政府资源", region: "华东区域", province: "浙江", city: "杭州", district: "滨江区", adcode: "330108", longitude: 120.19, latitude: 30.19, amount: 1000, owner: "张伟", presales: "陈晨", stage: "线索", priority: "P2", nextAction: "首次拜访", nextActionDate: "2026-07-05", expectedClose: "2026-12-31" }], [{ key: "name", label: "项目名称" }, { key: "account", label: "客户主体" }, { key: "contactName", label: "关键联系人" }, { key: "contactMobile", label: "联系人手机号" }, { key: "contactEmail", label: "联系人邮箱" }, { key: "category", label: "项目类型" }, { key: "region", label: "经营区域" }, { key: "province", label: "省份" }, { key: "city", label: "城市" }, { key: "district", label: "区县" }, { key: "adcode", label: "行政区划代码" }, { key: "longitude", label: "经度" }, { key: "latitude", label: "纬度" }, { key: "amount", label: "金额（万元）" }, { key: "owner", label: "负责人" }, { key: "presales", label: "售前负责人" }, { key: "stage", label: "销售阶段" }, { key: "priority", label: "优先级" }, { key: "nextAction", label: "下一步动作" }, { key: "nextActionDate", label: "计划日期" }, { key: "expectedClose", label: "预计成交日期" }]);
  const sources = [{ name: "手工录入", count: projects.filter((p) => p.source === "手工录入").length, status: "正常", updated: "刚刚" }, { name: "历史 Excel 台账", count: 138, status: "已同步", updated: "今天 10:20" }, { name: "CRM 接口", count: 286, status: "正常", updated: "5 分钟前" }, { name: "伙伴项目清单", count: 42, status: "待复核", updated: "昨天 18:30" }];
  const history = [{ file: "华东大区项目清单_0628.csv", user: "刘洋", rows: 128, success: 124, failed: 4, time: "06-28 18:30" }, { file: "西南区客户资源补充.csv", user: "李娜", rows: 56, success: 56, failed: 0, time: "06-27 16:10" }, { file: "实施伙伴能力表.csv", user: "王磊", rows: 31, success: 29, failed: 2, time: "06-26 11:40" }];
  return (
    <div className="standard-page management-page">
      <PageHeader eyebrow="DATA OPERATIONS & GOVERNANCE" title="数据管理" description="导入、校验、查重、修正并追踪每一次数据变更" actions={<><GhostButton onClick={downloadTemplate}><DownloadOutlined /> 模板下载</GhostButton><PrimaryButton onClick={onImportOpen}><UploadOutlined /> 上传数据</PrimaryButton></>} />
      <section className="management-actions">
        <button type="button" onClick={onCreate}><PlusOutlined /><span><strong>单条新建</strong><small>录入客户、商机和下一步动作</small></span><RightOutlined /></button>
        <button type="button" onClick={onImportOpen}><CloudUploadOutlined /><span><strong>批量导入</strong><small>上传 CSV，预检后再入库</small></span><RightOutlined /></button>
        <button type="button" onClick={() => onToast("已开始扫描疑似重复记录")}><ApartmentOutlined /><span><strong>查重合并</strong><small>按统一信用代码与标准名称识别</small></span><RightOutlined /></button>
        <button type="button" onClick={() => onToast("审计日志已导出")}><SafetyCertificateOutlined /><span><strong>审计追溯</strong><small>查看字段旧值、新值与操作人</small></span><RightOutlined /></button>
      </section>
      <div className="management-grid">
        <article className="quality-card"><header><div><p>DATA QUALITY</p><h2>数据质量概览</h2></div><strong>94.2<small>分</small></strong></header>{Object.entries({ "区县完整率": quality.region, "负责人完整率": quality.owner, "下一步动作完整率": quality.next, "有效联系人覆盖率": quality.contact }).map(([label, value]) => <div className="quality-row" key={label}><span>{label}</span><b><i style={{ width: `${value}%` }} /></b><strong>{value}%</strong></div>)}<footer><InfoCircleOutlined /> 当前存在 3 条高优先级数据质量问题</footer></article>
        <article className="source-card"><header><div><p>DATA SOURCES</p><h2>数据源状态</h2></div><GhostButton onClick={() => onToast("数据源状态已刷新")}><ReloadOutlined /> 刷新</GhostButton></header><div>{sources.map((source) => <button type="button" key={source.name}><i className={source.status === "待复核" ? "source-dot source-dot--warning" : "source-dot"} /><span><strong>{source.name}</strong><small>{source.updated}</small></span><em>{source.count} 条</em><b>{source.status}</b></button>)}</div></article>
      </div>
      <article className="history-card"><header><div><p>IMPORT HISTORY</p><h2>最近导入任务</h2></div><button type="button" aria-label="更多导入记录"><MoreOutlined /></button></header><table className="data-table"><thead><tr><th>文件名称</th><th>操作人</th><th>总行数</th><th>成功</th><th>失败</th><th>完成时间</th><th>结果</th></tr></thead><tbody>{history.map((item) => <tr key={item.file}><td><FileExcelOutlined /> <strong>{item.file}</strong></td><td>{item.user}</td><td>{item.rows}</td><td className="success-text">{item.success}</td><td className={item.failed ? "danger-text" : ""}>{item.failed}</td><td>{item.time}</td><td><span className={`task-result ${item.failed ? "task-result--warning" : ""}`}>{item.failed ? "部分成功" : "导入成功"}</span></td></tr>)}</tbody></table></article>
    </div>
  );
}

function AlertsPage({ alerts, setAlerts, projects, onViewProject }) {
  const [filter, setFilter] = useState("all");
  const filtered = alerts.filter((alert) => filter === "all" || alert.level === filter || alert.status === filter);
  const resolve = (id) => setAlerts((current) => current.map((alert) => alert.id === id ? { ...alert, status: "已解决" } : alert));
  return (
    <div className="standard-page alerts-page">
      <PageHeader eyebrow="ALERTS & EXECUTION" title="提醒中心" description="集中处理逾期、停滞、临期和数据质量问题" actions={<PrimaryButton onClick={() => setAlerts((current) => current.map((alert) => ({ ...alert, status: "已确认" })))}><CheckOutlined /> 全部确认</PrimaryButton>} />
      <div className="alert-summary"><Metric label="待处理" value={alerts.filter((a) => a.status === "待处理").length} inverse /><Metric label="红色风险" value={alerts.filter((a) => a.level === "red").length} inverse /><Metric label="今日新增" value={3} trend="2" /><Metric label="本周已闭环" value={18} trend="28%" /></div>
      <div className="alert-filter-tabs">{[{ key: "all", label: "全部" }, { key: "待处理", label: "待处理" }, { key: "red", label: "红色风险" }, { key: "yellow", label: "黄色关注" }, { key: "已解决", label: "已解决" }].map((item) => <button key={item.key} type="button" className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
      <div className="alert-list">{filtered.map((alert) => { const project = projects.find((item) => item.id === alert.projectId); return <article key={alert.id}><i className={`alert-icon alert-icon--${alert.level}`}>{alert.level === "red" ? <WarningFilled /> : <InfoCircleOutlined />}</i><div><header><strong>{alert.title}</strong><span className={`task-result ${alert.status === "已解决" ? "" : "task-result--warning"}`}>{alert.status}</span></header><p>{alert.description}</p><small>{project ? `${project.region} · ${project.owner} · ${project.name}` : "系统数据质量任务"} · 今天 {alert.time}</small></div><div className="alert-actions">{project && <GhostButton onClick={() => onViewProject(project)}>查看项目</GhostButton>}{alert.status !== "已解决" && <PrimaryButton onClick={() => resolve(alert.id)}>标记解决</PrimaryButton>}</div></article>; })}</div>
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

function SystemPage({ roleKey, onToast, initialUsers = USERS, productionMode, onInviteUser, onToggleUser }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [pipeline, setPipeline] = useState(STAGES.map((stage, index) => ({ ...stage, sla: [3, 7, 14, 10, 7, null][index] })));
  const [rules, setRules] = useState([{ name: "任务逾期", type: "TASK_OVERDUE", severity: "红色", enabled: true }, { name: "阶段停滞", type: "STAGE_STAGNANT", severity: "黄色", enabled: true }, { name: "预计成交日已过", type: "CLOSE_DATE_PASSED", severity: "红色", enabled: true }, { name: "缺少下一步动作", type: "NO_NEXT_ACTION", severity: "黄色", enabled: true }]);
  useEffect(() => setUsers(initialUsers), [initialUsers]);
  const inviteUser = async (form) => {
    setInviteSaving(true);
    try {
      await onInviteUser(form);
      setInviteOpen(false);
      onToast("用户邀请已发送");
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
  const tabs = [{ key: "users", label: "用户与团队", icon: TeamOutlined }, { key: "permissions", label: "角色权限", icon: SafetyCertificateOutlined }, { key: "pipeline", label: "销售流程", icon: ProjectOutlined }, { key: "rules", label: "提醒规则", icon: BellOutlined }];
  if (roleKey !== "admin") return <div className="standard-page"><div className="permission-denied"><SafetyCertificateOutlined /><h1>仅管理员可访问系统管理</h1><p>当前为 {ROLE_PRESETS[roleKey].label}，请切换管理员视角后重试。</p></div></div>;
  return (
    <div className="standard-page system-page">
      <PageHeader eyebrow="SYSTEM ADMINISTRATION" title="系统管理" description="管理用户、权限、流程、规则和数据字典" actions={<PrimaryButton onClick={() => onToast("系统配置已保存")}><SaveOutlined /> 保存配置</PrimaryButton>} />
      <div className="system-tabs">{tabs.map((item) => { const Icon = item.icon; return <button key={item.key} type="button" className={tab === item.key ? "is-active" : ""} onClick={() => setTab(item.key)}><Icon />{item.label}</button>; })}</div>
      {tab === "users" && <article className="settings-card"><header><div><p>USERS & TEAMS</p><h2>组织用户</h2></div><PrimaryButton onClick={() => setInviteOpen(true)}><PlusOutlined /> 添加用户</PrimaryButton></header><table className="data-table"><thead><tr><th>用户</th><th>角色</th><th>团队</th><th>数据范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="user-cell"><span className="avatar avatar--small">{user.name.slice(0, 1)}</span><strong>{user.name}</strong></div></td><td>{user.role}</td><td>{user.team}</td><td>{user.role === "销售" ? "本人数据" : user.role === "销售经理" ? "团队数据" : "全部数据"}</td><td><span className={`task-result ${user.status === "停用" ? "task-result--muted" : ""}`}>{user.status}</span></td><td><button type="button" className="link-button" onClick={() => toggleUser(user)}>{user.status === "启用" ? "停用" : "启用"}</button></td></tr>)}</tbody></table></article>}
      {tab === "permissions" && <article className="settings-card"><header><div><p>ROLE-BASED ACCESS</p><h2>角色与数据范围</h2></div><GhostButton onClick={() => onToast("权限矩阵已导出")}><DownloadOutlined /> 导出矩阵</GhostButton></header><table className="permission-table"><thead><tr><th>功能模块</th><th>销售</th><th>销售经理</th><th>售前</th><th>管理员</th></tr></thead><tbody>{[["作战地图", "本人", "团队", "全部", "全部"], ["客户与商机", "维护本人", "维护团队", "查看全部", "全部管理"], ["BI 分析", "本人", "团队", "全部", "全部"], ["数据导入", "本人模板", "团队模板", "只读", "全部管理"], ["系统配置", "无", "无", "无", "全部管理"]].map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <strong>{cell}</strong> : <span className={cell === "无" ? "permission-none" : "permission-yes"}>{cell !== "无" && <CheckOutlined />} {cell}</span>}</td>)}</tr>)}</tbody></table></article>}
      {tab === "pipeline" && <article className="settings-card"><header><div><p>SALES PIPELINE</p><h2>阶段、概率与 SLA</h2></div><GhostButton onClick={() => setPipeline((current) => [...current, { key: `custom-${Date.now()}`, label: "新阶段", probability: 50, sla: 7 }])}><PlusOutlined /> 添加阶段</GhostButton></header><div className="pipeline-settings">{pipeline.map((stage, index) => <div key={stage.key}><b>{index + 1}</b><input value={stage.label} onChange={(event) => setPipeline((current) => current.map((item) => item.key === stage.key ? { ...item, label: event.target.value } : item))} /><label>默认概率<input type="number" value={stage.probability} onChange={(event) => setPipeline((current) => current.map((item) => item.key === stage.key ? { ...item, probability: Number(event.target.value) } : item))} />%</label><label>阶段 SLA<input type="number" value={stage.sla ?? ""} onChange={(event) => setPipeline((current) => current.map((item) => item.key === stage.key ? { ...item, sla: Number(event.target.value) } : item))} />天</label><MoreOutlined /></div>)}</div></article>}
      {tab === "rules" && <article className="settings-card"><header><div><p>ALERT RULES</p><h2>自动提醒规则</h2></div><GhostButton onClick={() => setRules((current) => [...current, { name: "新提醒规则", type: "CUSTOM", severity: "黄色", enabled: false }])}><PlusOutlined /> 新建规则</GhostButton></header><div className="rule-list">{rules.map((rule, index) => <div key={`${rule.type}-${index}`}><i className={rule.severity === "红色" ? "rule-color rule-color--red" : "rule-color"} /><span><strong>{rule.name}</strong><small>{rule.type}</small></span><em>{rule.severity}</em><label className="switch"><input type="checkbox" checked={rule.enabled} onChange={() => setRules((current) => current.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item))} /><span /></label></div>)}</div></article>}
      {inviteOpen && <Modal title={productionMode ? "邀请企业用户" : "添加演示用户"} onClose={() => setInviteOpen(false)} width={520}><UserInviteForm onSubmit={inviteUser} onCancel={() => setInviteOpen(false)} saving={inviteSaving} /></Modal>}
    </div>
  );
}

export function App() {
  const auth = useAuth();
  const [demoProjects, setDemoProjects] = usePersistentState("battlemap-projects", INITIAL_PROJECTS);
  const [demoAlerts, setDemoAlerts] = usePersistentState("battlemap-alerts", INITIAL_ALERTS);
  const [backendProjects, setBackendProjects] = useState([]);
  const [backendAlerts, setBackendAlerts] = useState([]);
  const [directoryUsers, setDirectoryUsers] = useState(USERS);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [activePage, setActivePage] = useState("map");
  const [demoRoleKey, setDemoRoleKey] = useState("admin");
  const [selectedProjectId, setSelectedProjectId] = useState("P2026001");
  const [detailProject, setDetailProject] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState([]);
  const [toast, setToast] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [savingProject, setSavingProject] = useState(false);

  const productionMode = auth.backendConfigured;
  const projects = productionMode ? backendProjects : demoProjects;
  const alerts = productionMode ? backendAlerts : demoAlerts;
  const roleKey = productionMode ? auth.profile?.role ?? "sales" : demoRoleKey;
  const currentUser = productionMode
    ? auth.profile
    : { display_name: ROLE_PRESETS[roleKey].user, email: "演示账号" };

  const refreshBackendData = useCallback(async () => {
    if (!productionMode || !auth.session || !auth.profile) return;
    setDataLoading(true);
    setDataError("");
    try {
      const [data, users] = await Promise.all([loadBackendData(), loadDirectory()]);
      setBackendProjects(data.projects);
      setBackendAlerts(data.alerts);
      setDirectoryUsers(users);
    } catch (error) {
      setDataError(error.message || "后端数据加载失败");
    } finally {
      setDataLoading(false);
    }
  }, [auth.profile, auth.session, productionMode]);

  useEffect(() => {
    refreshBackendData();
  }, [refreshBackendData]);

  const visibleProjects = useMemo(
    () => (productionMode || roleKey !== "sales" ? projects : projects.filter((project) => project.owner === ROLE_PRESETS.sales.user)),
    [productionMode, projects, roleKey],
  );

  useEffect(() => {
    if (selectedProjectId && !visibleProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(visibleProjects[0]?.id ?? null);
    }
  }, [roleKey, selectedProjectId, visibleProjects]);

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
      if (productionMode) {
        const saved = await saveBackendProject(form, editingProject, auth.session.user.id);
        setBackendProjects((current) => editingProject
          ? current.map((project) => project.id === saved.id ? saved : project)
          : [saved, ...current]);
      } else if (editingProject) {
        setDemoProjects((current) => current.map((project) => project.id === editingProject.id ? { ...project, ...form, updatedAt: "2026-06-29 14:45" } : project));
      } else {
        const id = `P${Date.now().toString().slice(-7)}`;
        setDemoProjects((current) => [{ ...form, id, updatedAt: "2026-06-29 14:45" }, ...current]);
      }
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
      if (productionMode) {
        await softDeleteBackendProjects(ids);
        setBackendProjects((current) => current.filter((project) => !ids.includes(project.id)));
      } else {
        setDemoProjects((current) => current.filter((project) => !ids.includes(project.id)));
      }
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
    if (productionMode) {
      setBackendAlerts(next);
      updateBackendAlerts(next, previous).catch((error) => {
        setBackendAlerts(previous);
        notify(error.message || "提醒状态更新失败", "error");
      });
    } else {
      setDemoAlerts(next);
    }
  };

  const importRows = async (rows) => {
    try {
      if (productionMode) {
        const data = await importBackendProjects(rows);
        setBackendProjects(data.projects);
        setBackendAlerts(data.alerts);
      } else {
        const timestamp = Date.now();
        const imported = rows.map((row, index) => ({ ...row, id: `P${String(timestamp + index).slice(-9)}`, updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }) }));
        setDemoProjects((current) => [...imported, ...current]);
      }
      setImportOpen(false);
      notify(`已完成 ${rows.length} 条项目数据入库`);
    } catch (error) {
      notify(error.message || "批量导入失败，数据库未写入", "error");
    }
  };

  const inviteUser = async (input) => {
    if (productionMode) {
      await createBackendUser(input);
      await refreshBackendData();
      return;
    }
    setDirectoryUsers((current) => [...current, { id: `demo-${Date.now()}`, name: input.displayName, role: { sales: "销售", presales: "售前", admin: "管理员" }[input.role], roleKey: input.role, team: "未分组", status: "启用" }]);
  };

  const toggleUser = async (userId, active) => {
    if (productionMode) {
      await setBackendUserActive(userId, active);
      await refreshBackendData();
      return;
    }
    setDirectoryUsers((current) => current.map((user) => user.id === userId ? { ...user, status: active ? "启用" : "停用" } : user));
  };

  if (productionMode && auth.loading) return <AppLoadingScreen />;
  if (productionMode && !auth.session) return <LoginScreen onSignIn={auth.signIn} error={auth.error} />;
  if (productionMode && (auth.error && !auth.profile)) return <DataErrorScreen message={auth.error} onRetry={() => window.location.reload()} onSignOut={auth.signOut} />;
  if (productionMode && !auth.profile) return <AppLoadingScreen />;
  if (productionMode && !auth.profile.active) return <AccountBlockedScreen onSignOut={auth.signOut} />;
  if (productionMode && dataLoading) return <AppLoadingScreen message="正在加载营销数据" />;
  if (productionMode && dataError) return <DataErrorScreen message={dataError} onRetry={refreshBackendData} onSignOut={auth.signOut} />;

  const page = (() => {
    switch (activePage) {
      case "map": return <MapPage projects={visibleProjects} alerts={alerts} roleKey={roleKey} currentUserName={currentUser.display_name} selectedProjectId={selectedProjectId} onSelectProject={setSelectedProjectId} onGoToProject={setDetailProject} />;
      case "workbench": return <WorkbenchPage projects={visibleProjects} onCreate={openCreate} onView={setDetailProject} onEdit={openEdit} onDelete={setDeleteTarget} onBulkDelete={setBulkDeleteIds} />;
      case "analysis": return <AnalysisPage projects={visibleProjects} />;
      case "management": return <ManagementPage projects={visibleProjects} onCreate={openCreate} onImportOpen={() => setImportOpen(true)} onToast={notify} />;
      case "alerts": return <AlertsPage alerts={alerts} setAlerts={applyAlertUpdate} projects={visibleProjects} onViewProject={setDetailProject} />;
      case "system": return <SystemPage roleKey={roleKey} onToast={notify} initialUsers={directoryUsers} productionMode={productionMode} onInviteUser={inviteUser} onToggleUser={toggleUser} />;
      default: return null;
    }
  })();

  return (
    <div className={`app-shell app-shell--${activePage}`}>
      {!productionMode && <div className="demo-mode-banner"><InfoCircleOutlined /> 演示数据模式：配置后端后将自动启用登录、数据库和服务端权限</div>}
      <Sidebar activePage={activePage} setActivePage={setActivePage} roleKey={roleKey} setRoleKey={setDemoRoleKey} alertsCount={alerts.filter((alert) => alert.status === "待处理").length} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} currentUser={currentUser} productionMode={productionMode} onSignOut={auth.signOut} />
      <div className="app-content">{page}</div>
      {detailProject && <DetailModal project={detailProject} onClose={() => setDetailProject(null)} onEdit={openEdit} />}
      {formOpen && <Modal title={editingProject ? "编辑项目" : "新建项目"} onClose={() => setFormOpen(false)}><ProjectForm initialProject={editingProject} onSubmit={saveProject} onCancel={() => setFormOpen(false)} users={directoryUsers} saving={savingProject} /></Modal>}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={importRows} />}
      {(deleteTarget || bulkDeleteIds.length > 0) && <Modal title="确认移入回收站" onClose={() => { setDeleteTarget(null); setBulkDeleteIds([]); }} width={480}><div className="confirm-dialog"><WarningFilled /><p>记录将从地图、分析和工作台中移除，管理员仍可在回收站恢复。</p></div><footer className="modal__footer"><GhostButton onClick={() => { setDeleteTarget(null); setBulkDeleteIds([]); }}>取消</GhostButton><PrimaryButton className="danger-primary" onClick={confirmDelete}>确认删除</PrimaryButton></footer></Modal>}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
