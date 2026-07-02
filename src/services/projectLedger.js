const STAGE_ORDER = ["won", "contract", "negotiation", "solution", "discovery", "lead", "lost"];
const HEALTH_ORDER = ["green", "yellow", "red", "gray"];

const stageRank = new Map(STAGE_ORDER.map((stage, index) => [stage, index]));
const healthRank = new Map(HEALTH_ORDER.map((health, index) => [health, index]));

export function sortProjectLedger(projects) {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const stageDifference = (stageRank.get(left.project.stage) ?? Number.MAX_SAFE_INTEGER)
        - (stageRank.get(right.project.stage) ?? Number.MAX_SAFE_INTEGER);
      if (stageDifference) return stageDifference;

      const healthDifference = (healthRank.get(left.project.health) ?? Number.MAX_SAFE_INTEGER)
        - (healthRank.get(right.project.health) ?? Number.MAX_SAFE_INTEGER);
      return healthDifference || left.index - right.index;
    })
    .map(({ project }) => project);
}

