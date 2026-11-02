// What the extension does, without the editor: scan a workspace, then map a
// requirement or the working tree's changes. Kept free of the vscode module
// so it can be tested with plain Node.

import { analyze, type ImpactResult } from "../../shared/analyze.ts";
import { buildInsights } from "../../shared/insights.ts";
import type { SystemMap } from "../../shared/map.ts";
import { toMarkdown } from "../../shared/markdown.ts";
import { scan } from "../../scanner/build.ts";
import { changedFiles } from "../../scanner/diff.ts";

export interface Mapped {
  result: ImpactResult;
  markdown: string;
}

export async function scanWorkspace(folder: string, grammarDir: string | undefined, onProgress?: (done: number, total: number) => void): Promise<SystemMap> {
  return (await scan({ roots: [folder], grammarDir, onProgress })).map;
}

export function mapRequirement(map: SystemMap, requirement: string): Mapped {
  const result = analyze(map, requirement);
  return { result, markdown: toMarkdown(requirement, map.name, result, buildInsights(map, result)) };
}

/** The impact of uncommitted changes, or of the branch against `base`. */
export function mapChanges(map: SystemMap, folder: string, base?: string): Mapped & { files: string[] } {
  const files = changedFiles(folder, base);
  const result = analyze(map, "", { changedFiles: files });
  return { files, result, markdown: toMarkdown(files.join("\n"), map.name, result, buildInsights(map, result)) };
}
