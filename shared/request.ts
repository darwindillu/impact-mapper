// What the browser sends to /api/analyze: the requirement and the slice of
// the map the graph walk kept. No SDK imports here; this file ships to the browser.

import type { Area, ImpactResult, Relation } from "./analyze.js";
import { describeStep } from "./analyze.js";
import type { SystemMap } from "./map.js";

export const LIMITS = { requirementChars: 4000, nodes: 60, contextChars: 120_000 };

export interface AnalysisRequest {
  requirement: string;
  mapName: string;
  languages: Record<string, number>;
  nodes: {
    id: string;
    relation: Relation;
    area: Area;
    tags: string[];
    symbols: string[];
    routes: string[];
    tables: string[];
    card?: string;
    why: string;
  }[];
}

export function buildRequest(map: SystemMap, requirement: string, result: ImpactResult): AnalysisRequest {
  const byId = new Map(map.files.map((f) => [f.id, f]));
  return {
    requirement,
    mapName: map.name,
    languages: map.languages,
    nodes: result.nodes.slice(0, LIMITS.nodes).map((n) => {
      const f = byId.get(n.id);
      return {
        id: n.id,
        relation: n.relation,
        area: n.area,
        tags: f?.tags ?? [n.kind],
        symbols: (f?.symbols ?? []).slice(0, 12),
        routes: (f?.routes ?? [])
          .filter((r) => r.role !== "mentions")
          .slice(0, 6)
          .map((r) => `${r.role} ${r.method ?? ""} ${r.path}`.replace(/\s+/g, " ")),
        tables: f?.tables ?? [],
        ...(f?.card ? { card: f.card } : {}),
        why: n.relation === "direct" ? `matches: ${n.matched.join(", ")}` : n.path.map(describeStep).join(" -> "),
      };
    }),
  };
}
