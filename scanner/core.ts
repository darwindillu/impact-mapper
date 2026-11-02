// The scan itself, independent of where files come from: the CLI reads them
// from disk, the web app from a folder the user picks. Callers run
// Parser.init() first and say how to load a grammar.

import Parser from "web-tree-sitter";
import { MAP_VERSION, type Edge, type FileNode, type SystemMap, type Tag } from "../shared/map.ts";
import { extractFacts, type FileFacts } from "./extract.ts";
import { LANGUAGES, familyOf } from "./languages.ts";
import { Resolver } from "./resolve.ts";
import { routeScore } from "./routes.ts";

const posixDir = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");

export interface ScanInput {
  name: string;
  /** Display names of the scanned roots. */
  roots: string[];
  /** Source files, read lazily so a big repo isn't all in memory at once. */
  files: { id: string; lang: string; read: () => Promise<string> }[];
  /** package.json, tsconfig.json, jsconfig.json and go.mod files, for import resolution. */
  configs: { id: string; text: string }[];
  /** Grammar name ("typescript", "c_sharp") to a loaded tree-sitter language. */
  loadLanguage: (grammar: string) => Promise<Parser.Language>;
  onProgress?: (done: number, total: number) => void;
}

const TAG_RULES: [Tag, RegExp][] = [
  ["test", /(^|\/)(tests?|__tests__|spec|e2e|cypress)\/|[._-](test|spec)\.[a-z]+$|_test\.go$|Tests?\.(java|cs)$/i],
  ["config", /(^|\/)(config|settings|conf)(\/|\.|$)|\.config\.[a-z]+$|(^|\/)(setup|manage|wsgi|asgi)\.py$/i],
  ["ui", /\.(tsx|jsx|vue|svelte)$|(^|\/)(components?|pages?|screens?|views|layouts?|widgets|ui|templates|app\/.*\/page)\//i],
  ["api", /(^|\/)(controllers?|routes?|routers?|handlers?|api|endpoints?|resolvers?|viewsets?)(\/|\.|$)|(^|\/)(views|urls|serializers)\.py$|Controller\.(java|cs|php|ts|js)$/i],
  ["data", /(^|\/)(models?|entit(y|ies)|schemas?|migrations?|repositor(y|ies)|dao|db|database|prisma)(\/|\.|$)|Repository\.(java|cs|ts)$/i],
  ["report", /report|export|pdf|csv|xlsx|excel|dashboard|analytic|chart|print/i],
  // "author" and a plain email field are not auth or notifications.
  ["notification", /notif|mailer|mail(service|sender|job|template)|send_?(mail|email)|sms|push_?notif|webhook|alert/i],
  ["permission", /permission|(^|[^a-z])auth(?!or)|authori[sz]|authenticat|guard|polic(y|ies)|acl|rbac|access_?control|security|roles?(\/|\.|$)/i],
];

function tagsFor(id: string, facts: FileFacts): Tag[] {
  const tags = new Set<Tag>();
  for (const [tag, re] of TAG_RULES) {
    // Cross-cutting concerns show in names as often as in folders.
    const target = ["report", "notification", "permission"].includes(tag) ? `${id} ${facts.symbols.slice(0, 15).join(" ")}` : id;
    if (re.test(target)) tags.add(tag);
  }
  if (tags.has("ui") && /\.py$/.test(id)) tags.delete("ui"); // Django views are endpoints
  if (facts.routes.some((r) => r.role === "serves")) tags.add("api");
  if (facts.tables.length) tags.add("data");
  if (![...tags].some((t) => ["ui", "api", "data", "test", "config"].includes(t))) tags.add("service");
  if (tags.has("test")) return ["test"];
  return [...tags];
}

export async function scanSources(input: ScanInput): Promise<SystemMap> {
  const parsers = new Map<string, Parser>();
  const parserFor = async (lang: string) => {
    let p = parsers.get(lang);
    if (!p) {
      p = new Parser();
      p.setLanguage(await input.loadLanguage(LANGUAGES[lang].grammar));
      parsers.set(lang, p);
    }
    return p;
  };

  const facts = new Map<string, FileFacts & { lang: string; loc: number }>();
  let done = 0;
  for (const src of input.files) {
    let text = "";
    try {
      text = await src.read();
      const tree = (await parserFor(src.lang)).parse(text);
      facts.set(src.id, { ...extractFacts(tree, src.lang), lang: src.lang, loc: text.split("\n").length });
      tree.delete();
    } catch {
      // A file that can't be read or parsed is still a node; it just has no facts.
      facts.set(src.id, { imports: [], namespaces: [], symbols: [], routes: [], tables: [], events: [], lang: src.lang, loc: text.split("\n").length });
    }
    input.onProgress?.(++done, input.files.length);
  }
  for (const p of parsers.values()) p.delete();

  const resolver = new Resolver(
    [...facts].map(([id, f]) => ({ id, namespaces: f.namespaces })),
    input.configs,
  );

  const edges: Edge[] = [];
  const edgeByKey = new Map<string, Edge>();
  const addEdge = (e: Edge) => {
    if (e.from === e.to) return;
    const key = `${e.from}|${e.to}|${e.type}`;
    const existing = edgeByKey.get(key);
    if (!existing) {
      edgeByKey.set(key, e);
      edges.push(e);
      return;
    }
    // One edge per file pair; it lists every route or table that links them.
    existing.confidence = Math.max(existing.confidence, e.confidence);
    const labels = new Set((existing.label ?? "").split(", ").filter(Boolean));
    if (e.label && labels.size < 6) labels.add(e.label);
    if (labels.size) existing.label = [...labels].join(", ");
  };

  for (const [id, f] of facts) {
    for (const spec of f.imports) {
      for (const to of resolver.resolve(id, spec, f.lang)) addEdge({ from: id, to, type: "import", confidence: 1 });
    }
  }

  const tags = new Map([...facts].map(([id, f]) => [id, tagsFor(id, f)]));

  // HTTP: a call or route mention in one file -> the file serving that route.
  // Tests declare routes to exercise them; they don't serve them.
  const served = [...facts]
    .filter(([id]) => !tags.get(id)!.includes("test"))
    .flatMap(([id, f]) => f.routes.filter((r) => r.role === "serves").map((r) => ({ id, ...r })));
  const sameMethod = (a?: string, b?: string) => !a || !b || a === b;
  for (const [id, f] of facts) {
    for (const r of f.routes) {
      if (r.role === "serves") continue;
      // Keep only the closest server routes for this call.
      const best = (candidates: { s: (typeof served)[number]; score: number }[]) => {
        const max = Math.max(-1, ...candidates.map((c) => c.score));
        return max < 0 ? [] : candidates.filter((c) => c.score === max).map((c) => c.s);
      };
      const eligible = served.filter((s) => s.id !== id && sameMethod(r.method, s.method));
      let hits = best(eligible.map((s) => ({ s, score: routeScore(r.path, s.path) })));
      let confidence = r.role === "calls" ? (r.path.includes(":p") ? 0.8 : 1) : 0.5;
      if (hits.length === 0) {
        // A prefix set elsewhere (Gin's Group("/users"), Express's
        // use("/users", router)) usually matches the router's folder name.
        hits = best(
          eligible.map((s) => {
            const folder = posixDir(s.id).split("/").pop()!.toLowerCase();
            const prefixed = `/${folder}${s.path === "/" ? "" : s.path}`;
            return { s, score: s.path.startsWith(`/${folder}`) ? -1 : routeScore(r.path, prefixed) };
          }),
        );
        confidence *= 0.7;
      }
      if (hits.length === 0 || hits.length > 4) continue; // too generic to trust
      for (const s of hits) {
        addEdge({ from: id, to: s.id, type: "http", label: `${r.method ?? s.method ?? ""} ${r.path}`.trim(), confidence });
      }
    }
  }

  // Data stores and events become shared nodes when more than one file uses them.
  const resources: SystemMap["resources"] = [];
  const tableUsers = new Map<string, string[]>();
  const emitters = new Map<string, string[]>();
  const listeners = new Map<string, string[]>();
  for (const [id, f] of facts) {
    for (const t of f.tables) (tableUsers.get(t) ?? tableUsers.set(t, []).get(t)!).push(id);
    for (const e of f.events) {
      const m = e.role === "emits" ? emitters : listeners;
      (m.get(e.name) ?? m.set(e.name, []).get(e.name)!).push(id);
    }
  }
  for (const [table, users] of tableUsers) {
    if (users.length < 2) continue;
    resources.push({ id: `table:${table}`, kind: "table", name: table });
    for (const u of users) addEdge({ from: u, to: `table:${table}`, type: "data", label: table, confidence: 0.9 });
  }
  for (const [event, from] of emitters) {
    const to = (listeners.get(event) ?? []).filter((l) => !from.includes(l));
    if (to.length === 0) continue;
    resources.push({ id: `event:${event}`, kind: "event", name: event });
    for (const l of to) addEdge({ from: l, to: `event:${event}`, type: "event", label: event, confidence: 0.8 });
    for (const e of from) addEdge({ from: `event:${event}`, to: e, type: "event", label: event, confidence: 0.8 });
  }

  const files: FileNode[] = [...facts].map(([id, f]) => ({
    id,
    lang: familyOf(f.lang),
    loc: f.loc,
    tags: tags.get(id)!,
    symbols: f.symbols,
    routes: f.routes,
    tables: f.tables,
    events: f.events,
  }));
  const languages: Record<string, number> = {};
  for (const f of files) languages[f.lang] = (languages[f.lang] ?? 0) + 1;

  return {
    version: MAP_VERSION,
    name: input.name,
    scannedAt: new Date().toISOString(),
    roots: input.roots,
    languages,
    files,
    resources,
    edges,
  };
}
