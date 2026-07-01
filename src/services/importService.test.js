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

  it("normalizes other Chinese provinces to other region", () => {
    const csv = `${headers}\n广州项目,广州客户,,,,政府资源,华南区域,广东,广州,天河区,440106,113.3612,23.1247,100,测试用户,,线索,P2,,,`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("通过");
    expect(row.data.region).toBe("其他区域");
  });

  it("rejects unsupported region values when the adcode cannot be classified", () => {
    const csv = `${headers}\n未知项目,未知客户,,,,政府资源,华南区域,未知省,未知市,未知区,990106,113.3612,23.1247,100,测试用户,,线索,P2,,,`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("需修正");
    expect(row.error).toContain("经营区域取值");
  });

  it("accepts Hubei projects categorized as other region", () => {
    const csv = `${headers}\n武汉项目,武汉客户,,,,产业资源,其他区域,湖北,武汉,武昌区,420106,114.316464,30.55418,300,测试用户,,方案设计,P1,,,`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("通过");
    expect(row.data.region).toBe("其他区域");
  });

  it("requires an integrator for indirect contracts and parses delivery partners", () => {
    const extendedHeaders = `${headers},是否直签,集成商,交付伙伴`;
    const csv = `${extendedHeaders}\n南京项目,南京客户,,,,平台资源,华东区域,江苏,南京,建邺区,320105,118.7316,32.0039,500,测试用户,,方案设计,P1,,,,否,华东系统集成有限公司,伙伴甲、伙伴乙`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("通过");
    expect(row.data.isDirectContract).toBe(false);
    expect(row.data.integrator).toBe("华东系统集成有限公司");
    expect(row.data.deliveryPartners).toEqual(["伙伴甲", "伙伴乙"]);
  });

  it("rejects an indirect contract without an integrator", () => {
    const extendedHeaders = `${headers},是否直签,集成商,交付伙伴`;
    const csv = `${extendedHeaders}\n南京项目,南京客户,,,,平台资源,华东区域,江苏,南京,建邺区,320105,118.7316,32.0039,500,测试用户,,方案设计,P1,,,,否,,伙伴甲`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("需修正");
    expect(row.error).toContain("非直签项目需填写集成商");
  });

  it("accepts lost projects as a terminal sales stage", () => {
    const csv = `${headers}\n丢单项目,测试客户,,,,单体项目,华东区域,江苏,南京,玄武区,320102,118.7977,32.0486,200,测试用户,,丢单,P2,,,`;
    const [row] = parseImportCsv(csv);
    expect(row.status).toBe("通过");
    expect(row.data.stage).toBe("lost");
  });
});
