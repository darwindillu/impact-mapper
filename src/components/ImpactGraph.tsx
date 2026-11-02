import { useMemo } from "react";
import type { ImpactNode, ImpactResult } from "../../shared/analyze.ts";
import { AREA_ORDER, shortName } from "../lib/names.ts";

const SIZE = 640;
const C = SIZE / 2;
const RING = { direct: 125, near: 215, far: 290 };
const MAX_NODES = 48;

interface Placed {
  node: ImpactNode;
  x: number;
  y: number;
  angle: number;
  parent?: string;
}

const ringOf = (n: ImpactNode) => (n.relation === "direct" ? "direct" : n.depth <= 1 ? "near" : "far");

function place(result: ImpactResult): Placed[] {
  // Tests stay in the list; in the picture they would crowd out the code they test.
  const nodes = result.nodes
    .filter((n) => n.area !== "Tests")
    .sort((a, b) => (a.relation === "direct" ? 0 : 1) - (b.relation === "direct" ? 0 : 1) || b.score - a.score)
    .slice(0, MAX_NODES);
  const ids = new Set(nodes.map((n) => n.id));

  // Each area gets a slice of the circle sized by its busiest ring, and every
  // ring spreads its nodes across that slice: screens sit together on every
  // ring, and an area with many direct matches doesn't bunch up.
  const areas = AREA_ORDER.filter((a) => nodes.some((n) => n.area === a));
  const width = new Map(
    areas.map((a) => {
      const inArea = nodes.filter((n) => n.area === a);
      const busiest = Math.max(...(["direct", "near", "far"] as const).map((r) => inArea.filter((n) => ringOf(n) === r).length));
      return [a, busiest + 0.6]; // a little air between areas
    }),
  );
  const total = [...width.values()].reduce((s, w) => s + w, 0);
  const placed: Placed[] = [];
  let start = -Math.PI / 2;
  for (const area of areas) {
    const w = width.get(area)!;
    const span = (w / total) * Math.PI * 2;
    const gap = (span * 0.3) / w; // half the air on each side
    const usable = span - 2 * gap;
    for (const ring of ["direct", "near", "far"] as const) {
      const group = nodes.filter((n) => n.area === area && ringOf(n) === ring).sort((a, b) => b.score - a.score);
      group.forEach((node, i) => {
        const angle = start + gap + usable * ((i + 0.5) / group.length);
        const r = RING[ring];
        const last = node.path[node.path.length - 1];
        const parent = last ? (last.from === node.id ? last.to : last.from) : undefined;
        placed.push({
          node,
          angle,
          x: C + r * Math.cos(angle),
          y: C + r * Math.sin(angle),
          parent: parent && ids.has(parent) ? parent : undefined,
        });
      });
    }
    start += span;
  }
  return placed;
}

interface Props {
  result: ImpactResult;
  selected?: string;
  onSelect: (id: string) => void;
}

export function ImpactGraph({ result, selected, onSelect }: Props) {
  const placed = useMemo(() => place(result), [result]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  // The chain from the selected node back to the requirement.
  const chain = useMemo(() => {
    const set = new Set<string>();
    for (let id = selected; id && !set.has(id); id = byId.get(id)?.parent) set.add(id);
    return set;
  }, [selected, byId]);

  const hidden = result.nodes.filter((n) => n.area !== "Tests").length - placed.length;
  // Name the strongest matches that have room around them; the rest show
  // their name when selected or on hover.
  const labelled = useMemo(() => {
    const keep: Placed[] = [];
    for (const p of placed.filter((x) => x.node.relation === "direct").sort((a, b) => b.node.score - a.node.score)) {
      const room = keep.every((k) => Math.abs(Math.atan2(Math.sin(k.angle - p.angle), Math.cos(k.angle - p.angle))) > 0.42);
      if (room) keep.push(p);
      if (keep.length === 6) break;
    }
    return new Set(keep.map((p) => p.node.id));
  }, [placed]);
  const shownAreas = AREA_ORDER.filter((a) => placed.some((p) => p.node.area === a));

  return (
    <figure className="graph">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Impact map: the requirement in the middle, the files it touches around it"
      >
        {[RING.direct, RING.near, RING.far].map((r) => (
          <circle key={r} cx={C} cy={C} r={r} className="ring" />
        ))}
        {placed.map((p) => {
          const from = p.parent ? byId.get(p.parent)! : undefined;
          const x1 = from?.x ?? C;
          const y1 = from?.y ?? C;
          const active = chain.has(p.node.id) && (!p.parent || chain.has(p.parent));
          return (
            <line
              key={`l-${p.node.id}`}
              x1={x1}
              y1={y1}
              x2={p.x}
              y2={p.y}
              className={`link ${p.node.relation}${active ? " active" : ""}${p.node.path.some((s) => s.type === "http") && p.node.path[p.node.path.length - 1]?.type === "http" ? " http" : ""}`}
            />
          );
        })}
        <g className="center">
          <circle cx={C} cy={C} r={34} />
          <text x={C} y={C + 4} textAnchor="middle">
            Feature
          </text>
        </g>
        {placed.map((p) => {
          const r = p.node.relation === "direct" ? 9 : 6 + 3 * Math.min(1, p.node.score);
          const isSel = selected === p.node.id;
          return (
            <g
              key={p.node.id}
              className={`node area-${p.node.area.toLowerCase()} ${p.node.relation}${isSel ? " selected" : ""}`}
              transform={`translate(${p.x} ${p.y})`}
              onClick={() => onSelect(p.node.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(p.node.id)}
              tabIndex={0}
              role="button"
              aria-label={`${shortName(p.node.id)}, ${p.node.area}, ${p.node.relation}`}
            >
              <title>{`${p.node.id}\n${p.node.area} · ${p.node.relation}`}</title>
              {p.node.kind === "file" ? <circle r={r} /> : <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} />}
            </g>
          );
        })}
        {/* Labels last, so no node is drawn over them. */}
        <g className="labels" aria-hidden="true">
          {placed
            .filter((p) => labelled.has(p.node.id) || selected === p.node.id || chain.has(p.node.id))
            .map((p) => {
              const r = p.node.relation === "direct" ? 9 : 6 + 3 * Math.min(1, p.node.score);
              const right = Math.cos(p.angle) >= 0;
              return (
                <text key={`t-${p.node.id}`} x={p.x + (right ? r + 5 : -r - 5)} y={p.y + 4} textAnchor={right ? "start" : "end"}>
                  {shortName(p.node.id)}
                </text>
              );
            })}
        </g>
      </svg>
      <figcaption>
        <span className="legend">
          {shownAreas.map((a) => (
            <span key={a} className={`chip area-${a.toLowerCase()}`}>
              <i /> {a}
            </span>
          ))}
        </span>
        <span className="legend-rings">
          Inner ring: directly involved · outer rings: linked through the code · hollow: relied on · dashed line: an API call
          {hidden > 0 ? ` · ${hidden} more in the list` : ""} · tests are in the list only
        </span>
      </figcaption>
    </figure>
  );
}
