// impact-mapper diff: the impact of the files a branch or working tree changed.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyze } from "../shared/analyze.ts";
import { buildInsights } from "../shared/insights.ts";
import type { SystemMap } from "../shared/map.ts";
import { toMarkdown } from "../shared/markdown.ts";
import { scan } from "./build.ts";

export interface DiffOptions {
  repo: string;
  /** Compare the branch with this ref (merge base), e.g. origin/main. Without it: uncommitted changes. */
  base?: string;
  /** Use this list instead of asking git. */
  files?: string[];
  mapFile?: string;
  format: "md" | "json";
  out?: string;
}

export function changedFiles(repo: string, base?: string): string[] {
  const args = base ? ["diff", "--name-only", "--relative", `${base}...HEAD`] : ["diff", "--name-only", "--relative", "HEAD"];
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).split("\n").filter(Boolean);
}

export async function runDiff(opts: DiffOptions): Promise<void> {
  const files = opts.files ?? changedFiles(opts.repo, opts.base);
  const map: SystemMap = opts.mapFile
    ? JSON.parse(readFileSync(resolve(opts.mapFile), "utf8"))
    : (await scan({ roots: [opts.repo] })).map;
  if (!files.length) {
    emit(opts, opts.format === "json" ? "[]" : "No changed files.");
    return;
  }
  const result = analyze(map, "", { changedFiles: files });
  if (opts.format === "json") {
    emit(opts, JSON.stringify(result, null, 2));
    return;
  }
  emit(opts, toMarkdown(files.join("\n"), map.name, result, buildInsights(map, result)));
}

function emit(opts: DiffOptions, text: string) {
  if (opts.out) writeFileSync(resolve(opts.out), text);
  else process.stdout.write(`${text}\n`);
}
