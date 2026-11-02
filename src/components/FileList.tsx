import { useMemo, useState } from "react";
import type { Analysis } from "../../shared/ai.ts";
import type { ImpactResult, Relation } from "../../shared/analyze.ts";
import { RELATION_BADGE, RELATION_LABEL } from "../lib/labels.ts";
import { AREA_ORDER, shortName } from "../lib/names.ts";

interface Props {
  result: ImpactResult;
  selected?: string;
  onSelect: (id: string) => void;
  ai?: Analysis;
  hot: Set<string>;
}

type Filter = "all" | Relation;

/** The files the change touches, grouped by area, with a filter and a search for long results. */
export function FileList({ result, selected, onSelect, ai, hot }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showTests, setShowTests] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: result.nodes.length, direct: 0, downstream: 0, upstream: 0 };
    for (const n of result.nodes) c[n.relation]++;
    return c;
  }, [result]);

  const q = query.trim().toLowerCase();
  const visible = result.nodes.filter((n) => (filter === "all" || n.relation === filter) && (!q || n.id.toLowerCase().includes(q)));

  return (
    <div className="file-list">
      <div className="list-tools">
        <div className="chips" role="group" aria-label="Show">
          {(["all", "direct", "downstream", "upstream"] as const).map((f) =>
            counts[f] || f === "all" ? (
              <button
                key={f}
                className={`chip-button${filter === f ? " active" : ""}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : RELATION_LABEL[f]} <span>{counts[f]}</span>
              </button>
            ) : null,
          )}
        </div>
        <input
          type="search"
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a file"
          aria-label="Find a file in the result"
        />
      </div>

      {visible.length === 0 && <p className="hint">No files match. Clear the search or choose All.</p>}
      <div className="list-scroll">
        {AREA_ORDER.map((area) => {
          const nodes = visible.filter((n) => n.area === area);
          if (!nodes.length) return null;
          // Tests matter to run, not to read first: folded until asked for, unless searched or filtered.
          const folded = area === "Tests" && !showTests && !q && filter === "all";
          if (folded) {
            return (
              <button key={area} className="link-button show-tests" onClick={() => setShowTests(true)}>
                Show {nodes.length} test file{nodes.length === 1 ? "" : "s"} to run
              </button>
            );
          }
          return (
            <div key={area} className="area">
              <h3 className={`area-${area.toLowerCase()}`}>
                <i /> {area} <span>{nodes.length}</span>
              </h3>
              <ul>
                {nodes.map((n) => {
                  const note = ai?.impacts.find((i) => i.file === n.id);
                  return (
                    <li key={n.id}>
                      <button
                        className={`file${selected === n.id ? " selected" : ""}`}
                        onClick={() => onSelect(n.id)}
                        aria-current={selected === n.id}
                      >
                        <span className={`badge ${n.relation}`}>{RELATION_BADGE[n.relation]}</span>
                        <span className="name" title={n.id}>
                          {shortName(n.id)}
                        </span>
                        {note ? (
                          <span className={`risk ${note.risk}`}>{note.change}</span>
                        ) : (
                          hot.has(n.id) && (
                            <span className="risk high" title="Many fix commits in the last 12 months">
                              often fixed
                            </span>
                          )
                        )}
                        <span className="dir">{n.id.slice(0, -shortName(n.id).length)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
