import { describe, expect, it } from "vitest";
import { parseImportCsv } from "./importService.js";

const headers = "项目名称,客户主体,关键联系人,联系人手机号,联系人邮箱,项目类型,经营区域,省份,城市,区县,行政区划代码,经度,纬度,金额（万元）,负责人,售前负责人,销售阶段,优先级,下一步动作,计划日期,预计成交日期";

describe("parseImportCsv", () => {
  it("accepts Beijing projects and blank lead amounts", () => {
    const csv = `${headers}\n北京项目,北京客户,,,,政府资源,北京区域,北京,北京,海淀区,110108,116.298056,39.959912,,测试用户,,商机,P2,,,`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("通过");
    expect(row.data.region).toBe("北京区域");
    expect(row.data.amount).toBe(0);
    expect(row.data.stage).toBe("discovery");
  });

  it("rejects unsupported regions before writing to the database", () => {
    const csv = `${headers}\n广州项目,广州客户,,,,政府资源,华南区域,广东,广州,天河区,440106,113.3612,23.1247,100,测试用户,,线索,P2,,,`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("需修正");
    expect(row.error).toContain("经营区域取值");
  });
});
