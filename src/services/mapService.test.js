import { describe, expect, it } from "vitest";
import {
  createRegionBoundary,
  getBoundaryRequest,
  getProjectAdcode,
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
