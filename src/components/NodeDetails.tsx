import type { Analysis } from "../../shared/ai.ts";
import { describeStep, type ImpactNode } from "../../shared/analyze.ts";
import type { FileNode } from "../../shared/map.ts";
import { RELATION_BADGE, RELATION_HELP } from "../lib/labels.ts";
import { shortName } from "../lib/names.ts";

export function NodeDetails({
  node,
  file,
  ai,
  words,
}: {
  node: ImpactNode;
  file?: Partial<FileNode>;
  ai?: Analysis;
  words?: Record<string, string>;
}) {
  const note = ai?.impacts.find((i) => i.file === node.id);
  const routes = file?.routes?.filter((r) => r.role !== "mentions") ?? [];
  return (
    <aside className="details" aria-live="polite">
      <h3 title={node.id}>{shortName(node.id)}</h3>
      <p className="path">{node.id}</p>
      <p>
        <span className={`badge ${node.relation}`}>{RELATION_BADGE[node.relation]}</span> {node.area}
        {node.hub && <span className="badge hub">shared by much of the code</span>}
      </p>
      {note && (
        <p className={`note ${note.risk}`}>
          <b>
            {note.change}, {note.risk} risk.
          </b>{" "}
          {note.why}
        </p>
      )}
      <p className="small">{RELATION_HELP[node.relation]}</p>
      {node.relation === "direct" ? (
        <p>
          {node.matched.includes("changed")
            ? "Changed in this diff."
            : `Matches the description on: ${node.matched.map((m) => words?.[m] ?? m).join(", ")}`}
        </p>
      ) : (
        <ol className="chain">
          {node.path.map((s, i) => (
            <li key={i}>{describeStep(s)}</li>
          ))}
        </ol>
      )}
      {routes.length > 0 && (
        <p className="small">
          {routes
            .slice(0, 6)
            .map((r) => `${r.role} ${r.method ?? ""} ${r.path}`.replace(/\s+/g, " "))
            .join(" · ")}
        </p>
      )}
      {file?.symbols?.length ? <p className="small">Defines: {file.symbols.slice(0, 10).join(", ")}</p> : null}
      {file?.card && <p className="small">{file.card}</p>}
      {file?.churn && (
        <p className="small">
          Changed in {file.churn.commits} commit{file.churn.commits === 1 ? "" : "s"} in the last 12 months, {file.churn.fixes} of them
          fixes.
        </p>
      )}
    </aside>
  );
}
