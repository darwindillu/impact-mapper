// `scan --cards`: one-line AI summaries for the most connected non-test files,
// so the matcher can find files whose names don't say what they do. Cached by
// content hash, so a rescan only pays for files that changed.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { summarize } from "../shared/ai.ts";
import type { SystemMap } from "../shared/map.ts";

const CACHE_FILE = ".impact-mapper-cards.json";
const BATCH = 8;
const MAX_CHARS = 6000;

export async function addCards(map: SystemMap, sources: Map<string, string>, limit: number) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("--cards needs ANTHROPIC_API_KEY set.");

  const degree = new Map<string, number>();
  for (const e of map.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const chosen = map.files
    .filter((f) => !f.tags.includes("test") && !f.tags.includes("config"))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, limit);

  const cache: Record<string, string> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const todo: { id: string; code: string; hash: string }[] = [];
  for (const f of chosen) {
    const code = readFileSync(sources.get(f.id)!, "utf8");
    const hash = createHash("sha1").update(code).digest("hex");
    if (cache[hash]) f.card = cache[hash];
    else todo.push({ id: f.id, code: code.length > MAX_CHARS ? `${code.slice(0, MAX_CHARS)}\n…(truncated)` : code, hash });
  }

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    process.stderr.write(`\rSummarizing ${Math.min(i + BATCH, todo.length)}/${todo.length} files`);
    const cards = await summarize(apiKey, batch);
    for (const t of batch) {
      const card = cards.get(t.id);
      if (!card) continue;
      cache[t.hash] = card;
      map.files.find((f) => f.id === t.id)!.card = card;
    }
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  }
  if (todo.length) process.stderr.write("\n");
}
