// The deterministic half of the analysis: find the files a requirement is
// about, then follow the system map to everything upstream and downstream of
// them. No AI and no API key; the AI step only explains what this finds.

import type { Edge, EdgeType, FileNode, SystemMap, Tag } from "./map.ts";

export type Relation = "direct" | "downstream" | "upstream";
export type Area = "Screens" | "APIs" | "Data" | "Reports" | "Notifications" | "Permissions" | "Logic" | "Config" | "Tests";

export interface Step {
  from: string;
  to: string;
  type: EdgeType;
  label?: string;
}

export interface ImpactNode {
  id: string;
  kind: "file" | "table" | "event";
  relation: Relation;
  area: Area;
  score: number;
  depth: number;
  /** Why this node is in the result: matched words for direct hits, the link chain otherwise. */
  matched: string[];
  path: Step[];
  /** Imported by so many files that it was listed but not followed. */
  hub?: boolean;
}

export interface ImpactResult {
  tokens: string[];
  nodes: ImpactNode[];
  byArea: Partial<Record<Area, ImpactNode[]>>;
  /** `weak`: files linked to the change but too loosely to list (a screen that only shares the API client). */
  stats: { direct: number; downstream: number; upstream: number; files: number; weak: number };
}

const STOP = new Set(
  `a an the to of and or for in on with when should be is are was were will would can could must may might
  it its this that these those as by from at we our you your they their them i my me not no yes if then
  else into onto than so also each all any every some such only just more most less new add adding added
  allow allows able need needs want wants feature features option options user's page pages screen field
  fields button buttons show shows display displays list lists view views get set via use used using make
  ensure support supports like etc e g ie able value values item items data record records thing things
  index src app lib libs utils util helper helpers component components service services controller
  controllers model models test tests spec ts tsx js jsx py java go cs php rb main api module modules
  default common core base type types interface impl handler handlers route routes`.split(/\s+/),
);

export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(ses|xes|zes|ches|shes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  return w;
}

/** Words of a text or an identifier: "getUserEmail", "user_email" and "user-email" all give user, email. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w))
    .map(stem)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

const AREA_ORDER: [Tag, Area][] = [
  ["test", "Tests"],
  ["ui", "Screens"],
  ["permission", "Permissions"],
  ["notification", "Notifications"],
  ["report", "Reports"],
  ["api", "APIs"],
  ["data", "Data"],
  ["config", "Config"],
];

export function areaOf(tags: Tag[]): Area {
  for (const [tag, area] of AREA_ORDER) if (tags.includes(tag)) return area;
  return "Logic";
}

interface Indexed {
  file: FileNode;
  /** Best field weight per word. */
  weights: Map<string, number>;
  /** How many names in the file use the word. */
  counts: Map<string, number>;
}

const GENERIC_NAMES =
  /^(index|__init__|mod|main|models?|views?|urls|routes?|routers?|handlers?|controllers?|services?|serializers?|schemas?|types|admin|apps|forms|signals|renderers|backends|utils|helpers|api|repository|store|actions|reducers?)$/i;

// The file's own name says most about it; its folders a little less.
const FIELD_WEIGHT = { name: 5, folder: 2, table: 3, symbol: 2, route: 2, event: 2, card: 1 };

function indexFile(file: FileNode): Indexed {
  const weights = new Map<string, number>();
  const counts = new Map<string, number>();
  const add = (text: string, w: number) => {
    for (const t of tokenize(text)) {
      weights.set(t, Math.max(weights.get(t) ?? 0, w));
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  };
  const path = file.id.replace(/\.[a-z]+$/i, "");
  const segs = path.split("/");
  const name = segs.pop()!;
  // profiles/models.py, articles/views.py, users/routers.go: with a generic
  // file name, the folder is the real name.
  const generic = GENERIC_NAMES.test(name);
  const folder = segs.pop() ?? "";
  add(segs.join("/"), FIELD_WEIGHT.folder);
  add(folder, generic ? FIELD_WEIGHT.name - 1 : FIELD_WEIGHT.folder);
  add(name, generic ? FIELD_WEIGHT.folder : FIELD_WEIGHT.name);
  for (const s of file.symbols) add(s, FIELD_WEIGHT.symbol);
  for (const r of file.routes) add(r.path.replace(/:p/g, ""), FIELD_WEIGHT.route);
  for (const t of file.tables) add(t, FIELD_WEIGHT.table);
  for (const e of file.events) add(e.name, FIELD_WEIGHT.event);
  if (file.card) add(file.card, FIELD_WEIGHT.card);
  return { file, weights, counts };
}

export interface AnalyzeOptions {
  maxSeeds?: number;
  maxNodes?: number;
  includeTests?: boolean;
}

export function analyze(map: SystemMap, requirement: string, opts: AnalyzeOptions = {}): ImpactResult {
  const { maxSeeds = 8, maxNodes = 45 } = opts;
  const reqTokens = [...new Set(tokenize(requirement))];
  const files = map.files.map(indexFile);
  const byId = new Map(map.files.map((f) => [f.id, f]));

  // Rare words matter more: "comment" says more than "user", which is everywhere.
  const df = new Map<string, number>();
  for (const f of files) for (const t of f.weights.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.max(0, Math.log(files.length / (df.get(t) ?? files.length)));

  const relevance = new Map<string, { score: number; matched: string[] }>();
  for (const f of files) {
    const matched = reqTokens.filter((t) => f.weights.has(t));
    if (!matched.length) continue;
    const score = matched.reduce((s, t) => s + f.weights.get(t)! * idf(t) ** 1.5 * (1 + Math.log(f.counts.get(t)!)), 0);
    // Several different words beat one word repeated across fields.
    relevance.set(f.file.id, { matched, score: score * (1 + 0.2 * (matched.length - 1)) });
  }

  // Empty package markers (__init__.py, index.js re-exports) are not where a change goes.
  const substantive = (f: FileNode) => f.loc > 5 || f.symbols.length > 0 || f.routes.length > 0;
  const scored = files
    .filter((f) => !f.file.tags.includes("test") && substantive(f.file) && relevance.has(f.file.id))
    .map((f) => ({ f, ...relevance.get(f.file.id)! }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.score ?? 0;
  const seedSet = new Set(scored.filter((s) => s.score >= top * 0.4).slice(0, maxSeeds));
  // A backend has more names than a screen, so it would take every slot. Each
  // codebase root and each area also gets its own best matches.
  const groupOf = (id: string) => `${map.roots.length > 1 ? id.split("/")[0] : ""}|${areaOf(byId.get(id)!.tags)}`;
  const perGroup = new Map<string, number>();
  for (const s of scored) {
    if (seedSet.size >= maxSeeds + 6 || s.score < top * 0.2) break;
    const g = groupOf(s.f.file.id);
    if ((perGroup.get(g) ?? 0) < 2) {
      perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
      seedSet.add(s);
    }
  }
  const seeds = [...seedSet];
  // How much a file is about the requirement itself, 0..1.
  const ownRelevance = (id: string) => Math.min(1, (relevance.get(id)?.score ?? 0) / (top || 1));

  const out = new Map<string, ImpactNode>();
  const areaFor = (id: string): Area => {
    if (id.startsWith("table:")) return "Data";
    if (id.startsWith("event:")) return "Notifications";
    return areaOf(byId.get(id)?.tags ?? []);
  };
  const kindFor = (id: string): ImpactNode["kind"] =>
    id.startsWith("table:") ? "table" : id.startsWith("event:") ? "event" : "file";

  for (const s of seeds) {
    out.set(s.f.file.id, {
      id: s.f.file.id,
      kind: "file",
      relation: "direct",
      area: areaFor(s.f.file.id),
      score: s.score / (top || 1),
      depth: 0,
      matched: s.matched,
      path: [],
    });
  }

  const forward = new Map<string, Edge[]>();
  const reverse = new Map<string, Edge[]>();
  for (const e of map.edges) {
    (forward.get(e.from) ?? forward.set(e.from, []).get(e.from)!).push(e);
    (reverse.get(e.to) ?? reverse.set(e.to, []).get(e.to)!).push(e);
  }
  // A file imported by a large share of the codebase (a utils barrel, a
  // shared client) would pull in everything; list it but don't go through it.
  const hubLimit = Math.max(12, map.files.length * 0.15);
  const isHub = (id: string) => (reverse.get(id)?.filter((e) => e.type === "import").length ?? 0) > hubLimit;

  const MIN_SCORE = 0.24;
  const skipped = new Set<string>();
  type Item = { id: string; score: number; depth: number; path: Step[] };
  const walk = (relation: Exclude<Relation, "direct">, maxDepth: number) => {
    const queue: Item[] = seeds.map((s) => ({ id: s.f.file.id, score: 1, depth: 0, path: [] }));
    const best = new Map<string, number>();
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.depth >= maxDepth) continue;
      const resource = kindFor(cur.id) !== "file";
      // Downstream follows who depends on a node; upstream follows what it
      // depends on. A data store or event is shared both ways.
      const next =
        relation === "downstream"
          ? [...(reverse.get(cur.id) ?? []).map((e) => ({ e, to: e.from })), ...(resource ? (forward.get(cur.id) ?? []).map((e) => ({ e, to: e.to })) : [])]
          : [...(forward.get(cur.id) ?? []).map((e) => ({ e, to: e.to })), ...(resource ? (reverse.get(cur.id) ?? []).map((e) => ({ e, to: e.from })) : [])];
      for (const { e, to } of next) {
        if (to === cur.id) continue;
        const existing = out.get(to);
        if (existing?.relation === "direct") continue;
        const decay = e.type === "import" ? 0.55 : 0.7; // cross-boundary links are rarer and more telling
        const reach = cur.score * decay * e.confidence;
        if ((best.get(to) ?? 0) >= reach) continue;
        best.set(to, reach);
        const step: Step = { from: e.from, to: e.to, type: e.type, ...(e.label ? { label: e.label } : {}) };
        const path = [...cur.path, step];
        const file = byId.get(to);
        const isTest = file?.tags.includes("test") ?? false;
        // Of twenty screens importing the API client, the one about comments
        // matters for a comments change; the login screen barely does.
        const own = relevance.get(to);
        const score = reach * (0.35 + 0.65 * ownRelevance(to));
        if (score >= MIN_SCORE && (!existing || existing.score < score)) {
          out.set(to, {
            id: to,
            kind: kindFor(to),
            relation,
            area: areaFor(to),
            score,
            depth: cur.depth + 1,
            matched: own?.matched ?? [],
            path,
            ...(isHub(to) ? { hub: true } : {}),
          });
        } else if (score < MIN_SCORE && kindFor(to) === "file") {
          skipped.add(to);
        }
        // Resources don't count as a hop: a table links its readers and writers directly.
        const depth = kindFor(to) === "file" ? cur.depth + 1 : cur.depth;
        if (!isHub(to) && !isTest) queue.push({ id: to, score: reach, depth, path });
      }
    }
  };
  walk("downstream", 3);
  walk("upstream", 1);

  const nodes = [...out.values()]
    .filter((n) => opts.includeTests !== false || n.area !== "Tests")
    .sort((a, b) => (a.relation === "direct" ? -1 : 0) - (b.relation === "direct" ? -1 : 0) || b.score - a.score);
  const kept = [...nodes.filter((n) => n.relation === "direct"), ...nodes.filter((n) => n.relation !== "direct").slice(0, maxNodes)];

  const byArea: ImpactResult["byArea"] = {};
  for (const n of kept) (byArea[n.area] ??= []).push(n);
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    tokens: reqTokens,
    nodes: kept,
    byArea,
    stats: {
      direct: kept.filter((n) => n.relation === "direct").length,
      downstream: kept.filter((n) => n.relation === "downstream").length,
      upstream: kept.filter((n) => n.relation === "upstream").length,
      files: kept.filter((n) => n.kind === "file").length,
      weak: [...skipped].filter((id) => !keptIds.has(id)).length,
    },
  };
}

/** One readable line per link: "ArticleList.tsx calls GET /articles (served by views.py)". */
export function describeStep(step: Step): string {
  const name = (id: string) => id.replace(/^(table|event):/, "").split("/").pop()!;
  switch (step.type) {
    case "import":
      return `${name(step.from)} imports ${name(step.to)}`;
    case "http":
      return `${name(step.from)} calls ${step.label ?? "an endpoint"} in ${name(step.to)}`;
    case "data":
      return `${name(step.from)} uses the ${step.label ?? name(step.to)} data`;
    case "event":
      return step.from.startsWith("event:")
        ? `${name(step.to)} emits ${step.label}`
        : `${name(step.from)} listens for ${step.label}`;
  }
}
