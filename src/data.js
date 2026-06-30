export const CATEGORY_META = {
  government: { label: "政府资源", short: "政", color: "#1787ff" },
  industry: { label: "产业资源", short: "产", color: "#ff8a1f" },
  platform: { label: "平台资源", short: "平", color: "#1fb889" },
  standalone: { label: "单体项目", short: "单", color: "#7b61e8" },
  partner: { label: "合作伙伴", short: "合", color: "#00a8e8" },
};

export const STAGES = [
  { key: "lead", label: "线索", probability: 5 },
  { key: "discovery", label: "商机", probability: 20 },
  { key: "solution", label: "方案设计", probability: 50 },
  { key: "negotiation", label: "招投标", probability: 80 },
  { key: "contract", label: "合同签订", probability: 90 },
  { key: "won", label: "赢单", probability: 100 },
];

export const BUSINESS_REGIONS = ["华东区域", "西南区域", "北京区域", "其他区域"];

export const BUSINESS_REGION_PROVINCE_CODES = {
  华东区域: ["310000", "320000", "330000", "340000", "350000", "360000", "370000"],
  西南区域: ["500000", "510000", "520000", "530000", "540000"],
  北京区域: ["110000"],
  其他区域: [
    "120000", "130000", "140000", "150000",
    "210000", "220000", "230000",
    "410000", "420000", "430000", "440000", "450000", "460000",
    "610000", "620000", "630000", "640000", "650000",
    "710000", "810000", "820000",
  ],
};

export function inferBusinessRegion(adcode) {
  const normalized = String(adcode ?? "").padStart(6, "0");
  const provinceAdcode = `${normalized.slice(0, 2)}0000`;
  return Object.entries(BUSINESS_REGION_PROVINCE_CODES).find(([, codes]) => codes.includes(provinceAdcode))?.[0] ?? null;
}

export const ROLE_PRESETS = {
  admin: { label: "管理员视角", scope: "全部数据" },
  presales: { label: "售前视角", scope: "全部数据" },
  sales: { label: "销售视角", scope: "仅本人数据" },
};
