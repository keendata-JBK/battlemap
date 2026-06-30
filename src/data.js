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

export const BUSINESS_REGIONS = ["华东区域", "西南区域", "北京区域"];

export const ROLE_PRESETS = {
  admin: { label: "管理员视角", scope: "全部数据" },
  presales: { label: "售前视角", scope: "全部数据" },
  sales: { label: "销售视角", scope: "仅本人数据" },
};
