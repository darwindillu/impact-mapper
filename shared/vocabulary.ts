// The words a codebase uses for things, for synonym expansion: Claude picks
// from these, so a suggested term always exists in the code.

import { tokenize } from "./analyze.ts";
import type { SystemMap } from "./map.ts";

export function vocabulary(map: SystemMap, limit = 600): string[] {
  const df = new Map<string, number>();
  for (const f of map.files) {
    if (f.tags.includes("test")) continue;
    const words = new Set([
      ...tokenize(f.id.replace(/\.[a-z]+$/i, "")),
      ...f.symbols.flatMap(tokenize),
      ...f.tables.flatMap(tokenize),
      ...f.routes.flatMap((r) => tokenize(r.path.replace(/:p/g, ""))),
    ]);
    for (const w of words) if (w.length > 2) df.set(w, (df.get(w) ?? 0) + 1);
  }
  // Words used in a handful of files name concepts; words in half the files are plumbing.
  const max = Math.max(5, map.files.length * 0.3);
  return [...df]
    .filter(([, n]) => n >= 2 && n <= max)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}
