// The CLI's scan: walks folders on disk and hands the files to the core.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import Parser from "web-tree-sitter";
import type { SystemMap } from "../shared/map.ts";
import { scanSources, type ScanInput } from "./core.ts";
import { CONFIG_FILES, keepDir, keepFile } from "./languages.ts";

const require = createRequire(import.meta.url);

export interface ScanOptions {
  roots: string[];
  name?: string;
  onProgress?: (done: number, total: number) => void;
}

export async function scan({ roots, name, onProgress }: ScanOptions): Promise<{ map: SystemMap; sources: Map<string, string> }> {
  await Parser.init();
  const grammarDir = join(dirname(require.resolve("tree-sitter-wasms/package.json")), "out");

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
  return { map, sources };
}
