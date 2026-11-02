// Dev helper: npx tsx scripts/try-insights.ts <map.json> "<requirement>"
import { readFileSync } from "node:fs";
import { analyze } from "../shared/analyze.ts";
import { buildInsights } from "../shared/insights.ts";
import type { SystemMap } from "../shared/map.ts";

const [mapFile, requirement] = process.argv.slice(2);
const map = JSON.parse(readFileSync(mapFile, "utf8")) as SystemMap;
const out = buildInsights(map, analyze(map, requirement));
for (const [k, v] of Object.entries(out)) {
  console.log(`\n${k}`);
  for (const i of v) console.log("  -", "title" in i ? `${i.title}: ${i.steps.join(" / ")} => ${i.expected}` : i.text);
}
