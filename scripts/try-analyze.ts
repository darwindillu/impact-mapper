// Dev helper: npx tsx scripts/try-analyze.ts <map.json> "<requirement>"
import { readFileSync } from "node:fs";
import { analyze, describeStep } from "../shared/analyze.ts";
import type { SystemMap } from "../shared/map.ts";

const [mapFile, requirement] = process.argv.slice(2);
const map = JSON.parse(readFileSync(mapFile, "utf8")) as SystemMap;
const result = analyze(map, requirement);
console.log("tokens:", result.tokens.join(", "));
console.log("stats:", result.stats);
for (const [area, nodes] of Object.entries(result.byArea)) {
  console.log(`\n${area}`);
  for (const n of nodes!) {
    const why = n.relation === "direct" ? `matches ${n.matched.join(", ")}` : n.path.map(describeStep).join(" → ");
    console.log(`  ${n.relation.padEnd(10)} ${n.score.toFixed(2)} ${n.id}${n.hub ? " (hub)" : ""}\n             ${why}`);
  }
}
