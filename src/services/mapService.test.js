import { describe, expect, it } from "vitest";
import {
  buildDrillPath,
  createRegionBoundary,
  getBoundaryRequest,
  getProjectAdcode,
  isDrillItemInRegion,
  nextDrillItem,
  projectMatchesMapScope,
} from "./mapService.js";

describe("mapService", () => {
  it("filters the national boundary to East China", () => {
    const national = {
      type: "FeatureCollection",
      features: [
        { properties: { adcode: "330000", name: "浙江省" } },
        { properties: { adcode: "510000", name: "四川省" } },
      ],
    };
    expect(createRegionBoundary(national, "华东").features.map((feature) => feature.properties.name)).toEqual(["浙江省"]);
  });

  it("keeps a valid province-city-district hierarchy", () => {
    const sichuan = { adcode: "510000", name: "四川省", level: "province" };
    const chengdu = { adcode: "510100", name: "成都市", level: "city" };
    const jinniu = { adcode: "510106", name: "金牛区", level: "district" };
    const shandong = { adcode: "370000", name: "山东省", level: "province" };
    const jinan = { adcode: "370100", name: "济南市", level: "city" };

    expect(buildDrillPath([], sichuan)).toEqual([sichuan]);
    expect(buildDrillPath([sichuan], chengdu)).toEqual([sichuan, chengdu]);
    expect(buildDrillPath([sichuan, chengdu], jinniu)).toEqual([sichuan, chengdu, jinniu]);
    expect(buildDrillPath([sichuan], shandong)).toEqual([shandong]);
    expect(buildDrillPath([sichuan], jinan)).toEqual([sichuan]);
    expect(isDrillItemInRegion(sichuan, "西南")).toBe(true);
    expect(isDrillItemInRegion(shandong, "西南")).toBe(false);
  });

  it("matches projects at province, city and district scope", () => {
    const project = { id: "P2026001" };
    expect(getProjectAdcode(project)).toBe("330108");
    expect(projectMatchesMapScope(project, "华东", [{ adcode: "330000", level: "province" }])).toBe(true);
    expect(projectMatchesMapScope(project, "华东", [{ adcode: "330100", level: "city" }])).toBe(true);
    expect(projectMatchesMapScope(project, "华东", [{ adcode: "330108", level: "district" }])).toBe(true);
    expect(projectMatchesMapScope(project, "西南", [])).toBe(false);
  });

  it("builds drill items and boundary requests", () => {
    expect(nextDrillItem({ adcode: 330000, name: "浙江省", level: "province" })).toEqual({ adcode: "330000", name: "浙江省", level: "province" });
    expect(getBoundaryRequest([])).toEqual({ adcode: "100000", full: true });
    expect(getBoundaryRequest([{ adcode: "330100", level: "city" }])).toEqual({ adcode: "330100", full: true });
    expect(getBoundaryRequest([{ adcode: "330108", level: "district" }])).toEqual({ adcode: "330108", full: false });
  });
});
