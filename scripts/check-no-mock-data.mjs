import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const srcRoot = join(root, "src");
const forbidden = [
  "INITIAL_PROJECTS",
  "INITIAL_ALERTS",
  "battlemap-projects",
  "battlemap-alerts",
  "历史 Excel 台账",
  "CRM 接口",
  "华东大区项目清单_0628.csv",
  "94.2<small>分",
];

function filesIn(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const violations = [];
for (const file of filesIn(srcRoot).filter((path) => /\.(js|jsx)$/.test(path))) {
  const content = readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (content.includes(marker)) violations.push(`${relative(root, file)}: ${marker}`);
  }
}

if (violations.length) {
  console.error("检测到生产代码中的模拟数据标记：");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("生产数据源检查通过：未发现已知模拟业务数据。");
