const DATAV_BOUNDARY_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";
const BACKEND_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const boundaryCache = new Map();

export const REGION_PROVINCE_CODES = {
  华东: new Set(["310000", "320000", "330000", "340000", "350000", "360000", "370000"]),
  西南: new Set(["500000", "510000", "520000", "530000", "540000"]),
};

const DRILL_LEVEL_INDEX = {
  province: 0,
  city: 1,
  district: 2,
};

const PROJECT_ADCODES = {
  P2026001: "330108",
  P2026002: "310104",
  P2026003: "320505",
  P2026004: "510106",
  P2026005: "500112",
  P2026006: "330212",
  P2026007: "320214",
  P2026008: "340111",
  P2026009: "350102",
  P2026010: "530103",
  P2026011: "520115",
  P2026012: "320105",
  P2026013: "350206",
  P2026014: "330110",
  P2026015: "360113",
  P2026016: "510703",
  P2026017: "310115",
  P2026018: "510107",
};

function normalizeAdcode(value) {
  return String(value ?? "").padStart(6, "0");
}

function normalizeGeoJson(geoJson) {
  return {
    ...geoJson,
    features: (geoJson.features ?? []).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        adcode: normalizeAdcode(feature.properties?.adcode ?? feature.properties?.id),
      },
    })),
  };
}

async function fetchJson(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`地图边界加载失败（HTTP ${response.status}）`);
  return response.json();
}

export async function loadBoundary(adcode = "100000", options = {}) {
  const normalized = normalizeAdcode(adcode);
  const full = options.full ?? (normalized === "100000" || !normalized.endsWith("00"));
  const cacheKey = `${normalized}:${full ? "full" : "single"}`;
  if (boundaryCache.has(cacheKey)) return boundaryCache.get(cacheKey);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  const externalSignal = options.signal;
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });

  try {
    const suffix = full ? "_full" : "";
    const localNational = `${import.meta.env.BASE_URL}maps/100000_full.json`;
    const backendBoundary = BACKEND_URL ? `${BACKEND_URL}/functions/v1/map-boundary?adcode=${normalized}&full=${full}` : null;
    const url = normalized === "100000" ? localNational : backendBoundary ?? `${DATAV_BOUNDARY_BASE}/${normalized}${suffix}.json`;
    const geoJson = normalizeGeoJson(await fetchJson(url, controller.signal));
    if (!geoJson.features.length) throw new Error("地图边界数据为空");
    boundaryCache.set(cacheKey, geoJson);
    return geoJson;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("地图边界加载超时，请重试");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

export function createRegionBoundary(nationalGeoJson, regionMode) {
  const regionCodes = REGION_PROVINCE_CODES[regionMode];
  if (!regionCodes) return nationalGeoJson;
  return {
    ...nationalGeoJson,
    features: nationalGeoJson.features.filter((feature) => regionCodes.has(normalizeAdcode(feature.properties?.adcode))),
  };
}

export function getProjectAdcode(project) {
  return normalizeAdcode(project.adcode ?? PROJECT_ADCODES[project.id]);
}

export function projectMatchesMapScope(project, regionMode, drillPath) {
  const adcode = getProjectAdcode(project);
  const current = drillPath.at(-1);
  if (current?.level === "district") return adcode === current.adcode;
  if (current?.level === "city") return adcode.slice(0, 4) === current.adcode.slice(0, 4);
  if (current?.level === "province") return adcode.slice(0, 2) === current.adcode.slice(0, 2);
  if (regionMode !== "全国") return REGION_PROVINCE_CODES[regionMode]?.has(`${adcode.slice(0, 2)}0000`) ?? false;
  return true;
}

export function getBoundaryRequest(drillPath) {
  const current = drillPath.at(-1);
  if (!current) return { adcode: "100000", full: true };
  return { adcode: current.adcode, full: current.level !== "district" };
}

export function nextDrillItem(featureProperties) {
  const level = featureProperties?.level;
  if (!featureProperties?.adcode || !["province", "city", "district"].includes(level)) return null;
  return {
    adcode: normalizeAdcode(featureProperties.adcode),
    name: featureProperties.name,
    level,
  };
}

export function isDrillItemInRegion(item, regionMode) {
  if (!item || regionMode === "全国") return Boolean(item);
  return REGION_PROVINCE_CODES[regionMode]?.has(`${item.adcode.slice(0, 2)}0000`) ?? false;
}

export function buildDrillPath(currentPath, nextItem) {
  if (!nextItem || !(nextItem.level in DRILL_LEVEL_INDEX)) return currentPath;
  const nextIndex = DRILL_LEVEL_INDEX[nextItem.level];

  if (nextIndex === 0) return [nextItem];

  const parent = currentPath[nextIndex - 1];
  if (!parent) return currentPath;

  const prefixLength = nextItem.level === "city" ? 2 : 4;
  if (parent.adcode.slice(0, prefixLength) !== nextItem.adcode.slice(0, prefixLength)) return currentPath;

  return [...currentPath.slice(0, nextIndex), nextItem];
}
