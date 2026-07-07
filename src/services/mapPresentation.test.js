import { describe, expect, it } from "vitest";
import {
  buildProjectSymbolOffsets,
  buildProvinceAggregates,
  buildReferralUnitColorMap,
  REFERRAL_UNIT_FALLBACK,
} from "./mapPresentation.js";

describe("mapPresentation", () => {
  it("spreads projects sharing an administrative district", () => {
    const offsets = buildProjectSymbolOffsets([
      { id: "p1", adcode: "510106", coordinates: [104.04, 30.69] },
      { id: "p2", adcode: "510106", coordinates: [104.04, 30.69] },
      { id: "p3", adcode: "510106", coordinates: [104.04, 30.69] },
      { id: "p4", adcode: "510107", coordinates: [104.06, 30.64] },
    ]);

    expect(offsets.p1).toEqual([0, 0]);
    expect(offsets.p2).not.toEqual(offsets.p1);
    expect(offsets.p3).not.toEqual(offsets.p2);
    expect(offsets.p4).toEqual([0, 0]);
  });

  it("assigns distinct referral-unit colors and a neutral fallback", () => {
    const colors = buildReferralUnitColorMap([
      { category: "government", referralUnit: "金牛区政府" },
      { category: "government", referralUnit: "成都市经信局" },
      { category: "government", referralUnit: "" },
      { category: "industry", referralUnit: "金牛区政府" },
    ]);

    expect(colors["金牛区政府"]).not.toBe(colors["成都市经信局"]);
    expect(colors[REFERRAL_UNIT_FALLBACK]).toBe("#8a98ac");
  });

  it("aggregates projects by province with amount and project count", () => {
    const aggregates = buildProvinceAggregates([
      { adcode: "510106", province: "四川省", amount: 300, coordinates: [104.04, 30.69] },
      { adcode: "510107", province: "四川省", amount: 700, coordinates: [104.07, 30.63] },
      { adcode: "330106", province: "浙江省", amount: 500, coordinates: [120.13, 30.27] },
    ], {
      features: [
        { properties: { adcode: "510000", name: "四川省", level: "province", center: [102.69, 30.63] } },
        { properties: { adcode: "330000", name: "浙江省", level: "province", center: [120.15, 29.28] } },
      ],
    });

    expect(aggregates[0]).toMatchObject({ province: "四川省", amount: 1000, projectCount: 2, coordinates: [102.69, 30.63] });
    expect(aggregates[1]).toMatchObject({ province: "浙江省", amount: 500, projectCount: 1 });
  });
});
