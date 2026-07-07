import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, EffectScatterChart, FunnelChart, LineChart, PieChart } from "echarts/charts";
import { GeoComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { CATEGORY_META } from "./data.js";
import { buildProjectSymbolOffsets, buildProvinceAggregates, REFERRAL_UNIT_FALLBACK } from "./services/mapPresentation.js";

echarts.use([
  BarChart,
  EffectScatterChart,
  FunnelChart,
  LineChart,
  PieChart,
  GeoComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export function EChart({ option, className = "", onEvents = {}, ariaLabel = "数据图表" }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const chart = echarts.init(hostRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      if (!chart.isDisposed()) chart.resize();
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    Object.entries(onEvents).forEach(([eventName, handler]) => chart.on(eventName, handler));
    return () => {
      if (!chart.isDisposed()) Object.entries(onEvents).forEach(([eventName, handler]) => chart.off(eventName, handler));
    };
  }, [onEvents]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart && !chart.isDisposed()) chart.setOption(option, true);
  }, [option]);

  return <div ref={hostRef} className={className} role="img" aria-label={ariaLabel} />;
}

export function ChinaBattleMap({
  projects,
  selectedProjectId,
  onSelectProject,
  onDrill,
  geoJson,
  mapKey,
  level = "country",
  drillDisabled = false,
  governmentReferralMode = false,
  referralUnitColorMap = {},
  aggregateMode = false,
}) {
  const mapName = useMemo(() => {
    if (!geoJson) return null;
    const name = `battlemap-${mapKey}`;
    echarts.registerMap(name, geoJson);
    return name;
  }, [geoJson, mapKey]);

  const option = useMemo(() => {
    const symbolOffsets = buildProjectSymbolOffsets(projects);
    const projectPoints = projects.map((project) => ({
      name: project.name,
      projectId: project.id,
      value: [...project.coordinates, project.amount],
      category: project.category,
      city: project.city,
      district: project.district,
      health: project.health,
      referralUnit: project.referralUnit?.trim() || REFERRAL_UNIT_FALLBACK,
      symbolOffset: symbolOffsets[project.id] ?? [0, 0],
      itemStyle: {
        color:
          governmentReferralMode
            ? referralUnitColorMap[project.referralUnit?.trim() || REFERRAL_UNIT_FALLBACK] ?? "#8a98ac"
            : project.health === "red"
            ? "#ff5f57"
            : project.health === "yellow"
              ? "#ff9d2d"
              : CATEGORY_META[project.category]?.color ?? "#1687ff",
      },
    }));
    const aggregatePoints = buildProvinceAggregates(projects, geoJson).map((aggregate) => ({
      name: aggregate.province,
      aggregate: true,
      featureProperties: aggregate.featureProperties,
      projectCount: aggregate.projectCount,
      value: [...aggregate.coordinates, aggregate.amount],
      itemStyle: {
        color: {
          type: "radial",
          x: 0.36,
          y: 0.3,
          r: 0.88,
          colorStops: [
            { offset: 0, color: "#b9f4ff" },
            { offset: 0.22, color: "#39d7ff" },
            { offset: 0.72, color: "#1677ff" },
            { offset: 1, color: "#093a9b" },
          ],
        },
      },
    }));
    const points = aggregateMode ? aggregatePoints : projectPoints;

    if (!mapName) return {};

    return {
      animationDuration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        borderWidth: 0,
        backgroundColor: "rgba(4, 24, 61, 0.96)",
        textStyle: { color: "#fff", fontSize: 12 },
        extraCssText: "box-shadow:0 10px 28px rgba(0,0,0,.25);border-radius:8px;padding:10px 12px;",
        formatter(params) {
          if (params.componentSubType === "effectScatter") {
            if (params.data.aggregate) {
              return `<strong>${params.data.name}</strong><br/>项目 ${params.data.projectCount} 个<br/>预计成交金额 ${Number(params.data.value[2]).toLocaleString()} 万元<br/><small>点击下钻并展开项目</small>`;
            }
            const project = projects.find((item) => item.id === params.data.projectId);
            if (!project) return params.name;
            const referral = project.category === "government" ? `<br/>牵线单位 ${project.referralUnit || REFERRAL_UNIT_FALLBACK}` : "";
            return `<strong>${project.name}</strong><br/>${project.city} · ${project.district}<br/>预计成交金额 ${project.amount.toLocaleString()} 万元${referral}`;
          }
          const feature = geoJson.features.find((item) => item.properties?.name === params.name);
          const canDrill = ["province", "city", "district"].includes(feature?.properties?.level);
          return `${params.name ?? ""}${canDrill && feature?.properties?.level !== "district" ? "<br/><small>点击进入下一级</small>" : ""}`;
        },
      },
      geo: {
        map: mapName,
        roam: true,
        zoom: 1,
        layoutCenter: ["50%", "51%"],
        layoutSize: level === "country" ? "94%" : "91%",
        scaleLimit: { min: 0.72, max: 12 },
        selectedMode: "single",
        label: {
          show: true,
          color: "rgba(222, 237, 255, 0.72)",
          fontSize: 10,
        },
        itemStyle: {
          areaColor: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 1,
            y2: 1,
            colorStops: [
              { offset: 0, color: "#104d99" },
              { offset: 0.55, color: "#0a3474" },
              { offset: 1, color: "#061f52" },
            ],
          },
          borderColor: "rgba(76, 174, 255, .78)",
          borderWidth: 1,
          shadowBlur: 8,
          shadowColor: "rgba(3, 115, 255, .2)",
        },
        emphasis: {
          label: { color: "#fff", fontWeight: 700 },
          itemStyle: { areaColor: "#1457a5", borderColor: "#6fc5ff", borderWidth: 1.4 },
        },
        select: {
          label: { color: "#fff", fontWeight: 700 },
          itemStyle: { areaColor: "#0b63c7", borderColor: "#50d5ff", borderWidth: 2 },
        },
      },
      series: [
        {
          type: "effectScatter",
          coordinateSystem: "geo",
          data: points,
          symbol: "circle",
          symbolSize(value, params) {
            if (params.data.aggregate) return Math.max(30, Math.min(72, 22 + Math.sqrt(Math.max(value[2], 0)) * 0.35));
            const base = Math.max(13, Math.min(30, Math.sqrt(value[2]) / 2.7));
            return params.data.projectId === selectedProjectId ? base + 8 : base;
          },
          rippleEffect: { scale: aggregateMode ? 3.4 : 2.2, brushType: "stroke", number: aggregateMode ? 3 : 2 },
          itemStyle: {
            borderColor: "rgba(255,255,255,.74)",
            borderWidth: 1,
            shadowBlur: aggregateMode ? 26 : 14,
            shadowColor: aggregateMode ? "rgba(53, 209, 255, .72)" : "rgba(0, 128, 255, .48)",
          },
          label: {
            show: true,
            position: "right",
            formatter: (params) => params.data.aggregate
              ? `{province|${params.data.name}}\n{count|${params.data.projectCount} 个项目}`
              : governmentReferralMode ? params.data.referralUnit : params.data.city,
            color: "#fff",
            fontWeight: 600,
            fontSize: 10,
            textBorderColor: "#062458",
            textBorderWidth: 3,
            rich: {
              province: { color: "#fff", fontSize: 11, fontWeight: 800, lineHeight: 16 },
              count: { color: "#a9eaff", fontSize: 9, fontWeight: 600, lineHeight: 14 },
            },
          },
          emphasis: { scale: 1.18 },
          zlevel: 3,
        },
      ],
    };
  }, [aggregateMode, geoJson, governmentReferralMode, level, mapName, projects, referralUnitColorMap, selectedProjectId]);

  const events = useMemo(
    () => ({
      click(params) {
        if (params.componentSubType === "effectScatter" && params.data?.aggregate && params.data.featureProperties) {
          if (!drillDisabled) onDrill(params.data.featureProperties);
          return;
        }
        if (params.componentSubType === "effectScatter" && params.data?.projectId) {
          onSelectProject(params.data.projectId);
          return;
        }
        if (params.componentType === "geo" && params.name) {
          if (drillDisabled) return;
          const feature = geoJson?.features.find((item) => item.properties?.name === params.name);
          if (feature) onDrill(feature.properties);
        }
      },
    }),
    [drillDisabled, geoJson, onDrill, onSelectProject],
  );

  if (!geoJson || !mapName) return <div className="china-map" role="status" aria-label="地图边界加载中" />;

  return (
    <EChart
      option={option}
      onEvents={events}
      className="china-map"
      ariaLabel="中国营销作战地图，可点击省、市、区县逐级下钻"
    />
  );
}
