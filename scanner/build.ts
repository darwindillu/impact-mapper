// The CLI's scan: walks folders on disk and hands the files to the core.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import Parser from "web-tree-sitter";
import type { SystemMap } from "../shared/map.ts";
import { scanSources, type ScanInput } from "./core.ts";
import { CONFIG_FILES, keepDir, keepFile } from "./languages.ts";


export interface ScanOptions {
  roots: string[];
  name?: string;
  /** Add per-file change history from git when a root is a repository (default true). */
  git?: boolean;
  /**
   * Folder holding tree-sitter.wasm and the tree-sitter-<lang>.wasm grammars,
   * for bundles without node_modules (the VS Code extension). Default: the
   * installed packages.
   */
  grammarDir?: string;
  onProgress?: (done: number, total: number) => void;
}

export async function scan({ roots, name, git = true, grammarDir: bundled, onProgress }: ScanOptions): Promise<{ map: SystemMap; sources: Map<string, string> }> {
  await Parser.init(bundled ? { locateFile: () => join(bundled, "tree-sitter.wasm") } : undefined);
  // Resolved lazily: a CommonJS bundle (the VS Code extension) has no import.meta and passes grammarDir.
  const grammarDir = bundled ?? join(dirname(createRequire(import.meta.url).resolve("tree-sitter-wasms/package.json")), "out");

  const files: ScanInput["files"] = [];
  const configs: ScanInput["configs"] = [];
  const sources = new Map<string, string>();
  const absRoots = roots.map((r) => resolve(r));
  for (const root of absRoots) {
    const prefix = absRoots.length > 1 ? basename(root) : "";
    const visit = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = join(dir, entry);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        const rel = relative(root, abs).split(sep).join("/");
        const id = prefix ? `${prefix}/${rel}` : rel;
        if (st.isDirectory()) {
          if (keepDir(entry)) visit(abs);
        } else if (CONFIG_FILES.includes(entry)) {
          configs.push({ id, text: readFileSync(abs, "utf8") });
        } else {
          const lang = keepFile(entry, st.size);
          if (!lang) continue;
          files.push({ id, lang, read: () => readFile(abs, "utf8") });
          sources.set(id, abs);
        }
      }
    };
    visit(root);
  }

  const map = await scanSources({
    name: name ?? absRoots.map((r) => basename(r)).join(" + "),
    roots: absRoots.map((r) => basename(r)),
    files,
    configs,
    loadLanguage: (grammar) => Parser.Language.load(join(grammarDir, `tree-sitter-${grammar}.wasm`)),
    onProgress,
  });
  if (git) addChurn(map, absRoots);
  return { map, sources };
}

const FIX_COMMIT = /^(fix|bug|hotfix|revert)\b|\bfix(es|ed)?\b/i;

/** How often each file changed in the last 12 months, and how many of those changes were fixes. */
function addChurn(map: SystemMap, roots: string[]) {
  const byId = new Map(map.files.map((f) => [f.id, f]));
  for (const root of roots) {
    const prefix = roots.length > 1 ? `${basename(root)}/` : "";
    let log: string;
    try {
      log = execFileSync("git", ["-C", root, "log", "--since=12 months ago", "--no-merges", "--name-only", "--relative", "--pretty=format:%x00%s"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue; // not a git repository
    }
    for (const commit of log.split("\0").slice(1)) {
      const [subject, ...paths] = commit.split("\n");
      const fix = FIX_COMMIT.test(subject);
      for (const p of paths) {
        const f = p && byId.get(prefix + p.trim());
        if (!f) continue;
        f.churn ??= { commits: 0, fixes: 0 };
        f.churn.commits++;
        if (fix) f.churn.fixes++;
      }
    }
  }
}
