// Measures how well the analysis finds the files a change really touched.
//
//   npx tsx scripts/eval.ts <map.json> <cases.json> <repo dir>
//
// Each case is { ticket, commit, requirement }. The files that commit changed
// (and that are in the map, tests excluded) are the answer key. Reported per
// case and overall:
//   recall@10 / recall@all: share of changed files in the top 10 / anywhere in the result
//   hit@5: whether any changed file is in the top 5 (does the user land in the right place?)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { analyze } from "../shared/analyze.ts";
import type { SystemMap } from "../shared/map.ts";

const [mapFile, casesFile, repo, ...flags] = process.argv.slice(2);
const verbose = flags.includes("-v");
const map = JSON.parse(readFileSync(mapFile, "utf8")) as SystemMap;
const cases = JSON.parse(readFileSync(casesFile, "utf8")) as { ticket: string; commit: string; requirement: string; extraTerms?: string[] }[];
const ids = new Set(map.files.filter((f) => !f.tags.includes("test")).map((f) => f.id));

const changedFiles = (commit: string) =>
  execFileSync("git", ["-C", repo, "show", "--name-only", "--pretty=format:", commit], { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => ids.has(s));

let r10 = 0;
let rAll = 0;
let hit5 = 0;
let counted = 0;
for (const c of cases) {
  const truth = changedFiles(c.commit);
  if (!truth.length) {
    console.log(`${c.ticket}: no changed source files in the map, skipped`);
    continue;
  }
  counted++;
  const result = analyze(map, c.requirement, { extraTerms: c.extraTerms });
  // Ranked as a user reads them: direct matches first, then by score.
  const files = result.nodes.filter((n) => n.kind === "file" && n.area !== "Tests");
  const ranked = (flags.includes("--by-score") ? [...files].sort((a, b) => b.score - a.score) : files).map((n) => n.id);
  const inTop = (k: number) => truth.filter((t) => ranked.slice(0, k).includes(t)).length;
  const caseR10 = inTop(10) / truth.length;
  const caseAll = truth.filter((t) => ranked.includes(t)).length / truth.length;
  const caseHit = inTop(5) > 0;
  r10 += caseR10;
  rAll += caseAll;
  hit5 += caseHit ? 1 : 0;
  console.log(
    `${c.ticket.padEnd(9)} changed ${String(truth.length).padStart(2)}  recall@10 ${(caseR10 * 100).toFixed(0).padStart(3)}%  recall@all ${(caseAll * 100).toFixed(0).padStart(3)}%  hit@5 ${caseHit ? "yes" : "no "}  (${ranked.length} listed)`,
  );
  if (verbose) {
    for (const t of truth) console.log(`    ${ranked.includes(t) ? `#${ranked.indexOf(t) + 1}`.padEnd(5) : "miss "} ${t}`);
  }
}
console.log(
  `\n${counted} cases  recall@10 ${((r10 / counted) * 100).toFixed(0)}%  recall@all ${((rAll / counted) * 100).toFixed(0)}%  hit@5 ${hit5}/${counted}`,
);
