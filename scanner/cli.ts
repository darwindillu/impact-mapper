#!/usr/bin/env node
// impact-mapper scan <dir...> [-o system-map.json] [--name "My app"] [--cards]
//
// Writes the structure of the code (files, routes, data, events, links) to a
// JSON file. Source code is read locally and never leaves the machine, except
// with --cards, which sends the most connected files to your own AI key for a
// one-line summary each.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scan } from "./build.ts";
import { addCards } from "./cards.ts";

function usage(): never {
  console.log(`Usage: impact-mapper scan <dir> [more dirs...] [options]

Options:
  -o, --out <file>   Output file (default: system-map.json)
  --name <name>      Name shown in the app (default: folder names)
  --cards            Add one-line AI summaries for the most connected files.
                     Needs ANTHROPIC_API_KEY.
  --cards-limit <n>  How many files to summarize (default: 120)
  --no-git           Skip the 12-month change history from git`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "scan") usage();
  const roots: string[] = [];
  let out = "system-map.json";
  let name: string | undefined;
  let cards = false;
  let cardsLimit = 120;
  let git = true;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") out = args[++i];
    else if (a === "--name") name = args[++i];
    else if (a === "--cards") cards = true;
    else if (a === "--cards-limit") cardsLimit = Number(args[++i]);
    else if (a === "--no-git") git = false;
    else if (a.startsWith("-")) usage();
    else roots.push(a);
  }
  if (roots.length === 0) usage();
  if (cards && !process.env.ANTHROPIC_API_KEY) throw new Error("--cards needs ANTHROPIC_API_KEY set.");

  const started = Date.now();
  const { map, sources } = await scan({
    roots,
    name,
    git,
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) process.stderr.write(`\rParsed ${done}/${total} files`);
    },
  });
  process.stderr.write("\n");
  if (cards) await addCards(map, sources, cardsLimit);

  writeFileSync(resolve(out), JSON.stringify(map));
  const byType = map.edges.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {});
  const langs = Object.entries(map.languages)
    .sort((a, b) => b[1] - a[1])
    .map(([l, n]) => `${l} ${n}`)
    .join(", ");
  console.log(`${map.files.length} files (${langs})`);
  console.log(
    `links: ${byType.import ?? 0} imports, ${byType.http ?? 0} HTTP, ${byType.data ?? 0} data, ${byType.event ?? 0} event`,
  );
  console.log(`wrote ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
