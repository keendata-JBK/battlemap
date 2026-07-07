export const REFERRAL_UNIT_FALLBACK = "未填写牵线单位";

export const REFERRAL_UNIT_COLORS = [
  "#20b8cd",
  "#ff9b3d",
  "#8b7cff",
  "#28c786",
  "#f56c8a",
  "#5aa7ff",
  "#d9b43b",
  "#b275e7",
];

export function buildReferralUnitColorMap(projects) {
  const units = Array.from(new Set(
    projects
      .filter((project) => project.category === "government")
      .map((project) => project.referralUnit?.trim() || REFERRAL_UNIT_FALLBACK),
  )).sort((left, right) => left.localeCompare(right, "zh-CN"));

  return Object.fromEntries(units.map((unit, index) => [
    unit,
    unit === REFERRAL_UNIT_FALLBACK ? "#8a98ac" : REFERRAL_UNIT_COLORS[index % REFERRAL_UNIT_COLORS.length],
  ]));
}

export function buildProjectSymbolOffsets(projects) {
  const groups = new Map();
  projects.forEach((project) => {
    const coordinates = project.coordinates ?? [];
    const coordinateKey = coordinates.length === 2
      ? `${Number(coordinates[0]).toFixed(4)}:${Number(coordinates[1]).toFixed(4)}`
      : "unknown";
    const key = project.adcode || coordinateKey;
    groups.set(key, [...(groups.get(key) ?? []), project]);
  });

  const offsets = {};
  groups.forEach((rows) => {
    const sorted = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    sorted.forEach((project, index) => {
      if (index === 0) {
        offsets[project.id] = [0, 0];
        return;
      }
      const position = index - 1;
      const ring = Math.floor(position / 8);
      const positionInRing = position % 8;
      const itemsInRing = Math.min(8, sorted.length - 1 - ring * 8);
      const angle = -Math.PI / 2 + (Math.PI * 2 * positionInRing) / Math.max(itemsInRing, 1);
      const radius = 22 + ring * 17;
      offsets[project.id] = [
        Math.round(Math.cos(angle) * radius),
        Math.round(Math.sin(angle) * radius),
      ];
    });
  });
  return offsets;
}

export function buildProvinceAggregates(projects, geoJson) {
  const featureByAdcode = new Map((geoJson?.features ?? []).map((feature) => [
    String(feature.properties?.adcode ?? "").padStart(6, "0"),
    feature,
  ]));
  const groups = new Map();

  projects.forEach((project) => {
    const projectAdcode = String(project.adcode ?? "").padStart(6, "0");
    const provinceAdcode = `${projectAdcode.slice(0, 2)}0000`;
    groups.set(provinceAdcode, [...(groups.get(provinceAdcode) ?? []), project]);
  });

  return [...groups.entries()].map(([provinceAdcode, rows]) => {
    const feature = featureByAdcode.get(provinceAdcode);
    const featureCoordinates = feature?.properties?.center ?? feature?.properties?.centroid;
    const coordinates = Array.isArray(featureCoordinates) && featureCoordinates.length >= 2
      ? featureCoordinates.slice(0, 2).map(Number)
      : [
          rows.reduce((sum, project) => sum + Number(project.coordinates?.[0] || 0), 0) / rows.length,
          rows.reduce((sum, project) => sum + Number(project.coordinates?.[1] || 0), 0) / rows.length,
        ];

    return {
      id: `province-${provinceAdcode}`,
      provinceAdcode,
      province: feature?.properties?.name ?? rows[0]?.province ?? provinceAdcode,
      coordinates,
      amount: rows.reduce((sum, project) => sum + Number(project.amount || 0), 0),
      projectCount: rows.length,
      featureProperties: feature?.properties ?? { adcode: provinceAdcode, name: rows[0]?.province, level: "province" },
    };
  }).sort((left, right) => right.amount - left.amount);
}
