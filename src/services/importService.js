import { BUSINESS_REGIONS, CATEGORY_META, STAGES } from "../data.js";

const HEALTH_KEYS = new Set(["green", "yellow", "red", "gray"]);

export function parseCsvLine(line) {
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

export function parseImportCsv(content) {
  const lines = String(content).replace(/^\ufeff/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const categoryMap = Object.fromEntries(Object.entries(CATEGORY_META).map(([key, meta]) => [meta.label, key]));
  const stageMap = {
    ...Object.fromEntries(STAGES.map((stage) => [stage.label, stage.key])),
    需求挖掘: "discovery",
    "方案/标书": "solution",
    商务谈判: "negotiation",
  };
  const healthMap = { 正常: "green", 关注: "yellow", 高风险: "red", 暂停: "gray" };
  return lines.slice(1, 10001).map((line, index) => {
    const values = parseCsvLine(line);
    const source = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    const data = {
      name: source["项目名称"], account: source["客户主体"], contactName: source["关键联系人"] || "", contactMobile: source["联系人手机号"] || "", contactEmail: source["联系人邮箱"] || "", category: categoryMap[source["项目类型"]] ?? source["项目类型"],
      region: source["经营区域"], province: source["省份"], city: source["城市"], district: source["区县"], adcode: source["行政区划代码"],
      coordinates: [Number(source["经度"]), Number(source["纬度"])], amount: Number(source["金额（万元）"] || 0), owner: source["负责人"], presales: source["售前负责人"] || "",
      stage: stageMap[source["销售阶段"]] ?? source["销售阶段"], health: (healthMap[source["健康度"]] ?? source["健康度"]) || "green", priority: source["优先级"] || "P2",
      nextAction: source["下一步动作"] || "", nextActionDate: source["计划日期"] || "", expectedClose: source["预计成交日期"] || "",
      source: source["数据来源"] || "批量导入", risk: source["风险说明"] || "未填写",
    };
    const missing = ["name", "account", "category", "region", "province", "city", "district", "adcode", "owner", "stage"].filter((key) => !data[key]);
    if (!/^\d{6}$/.test(data.adcode || "")) missing.push("行政区划代码格式");
    if (!Number.isFinite(data.coordinates[0]) || data.coordinates[0] < 73 || data.coordinates[0] > 136 || !Number.isFinite(data.coordinates[1]) || data.coordinates[1] < 3 || data.coordinates[1] > 54) missing.push("地图坐标");
    if (!Object.hasOwn(CATEGORY_META, data.category)) missing.push("项目类型取值");
    if (!BUSINESS_REGIONS.includes(data.region)) missing.push("经营区域取值");
    if (!STAGES.some((stage) => stage.key === data.stage)) missing.push("销售阶段取值");
    if (!HEALTH_KEYS.has(data.health)) missing.push("健康度取值");
    return { row: index + 2, data, status: missing.length ? "需修正" : "通过", error: [...new Set(missing)].join("、") };
  });
}
