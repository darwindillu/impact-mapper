import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../shared/ai.ts";
import { buildRequest } from "../shared/request.ts";
import { analyze, describeStep, type ImpactNode, type ImpactResult } from "../shared/analyze.ts";
import { buildInsights } from "../shared/insights.ts";
import { MAP_VERSION, type SystemMap } from "../shared/map.ts";
import { ImpactGraph } from "./components/ImpactGraph.tsx";
import { AREA_ORDER, shortName } from "./lib/names.ts";
import { getUserKey, requestExplanation, setUserKey } from "./lib/api.ts";
import { toMarkdown } from "./lib/markdown.ts";
import { SAMPLES } from "./samples.ts";
import { canPickDirectory, fromFileList, pickDirectory, scanInWorker } from "./scan/folder.ts";
import type { ScanRequest } from "./scan/protocol.ts";

type Source = { kind: "sample"; id: string } | { kind: "upload"; name: string } | { kind: "folder"; name: string };
type ScanState =
  | { status: "idle" }
  | { status: "reading"; found: number }
  | { status: "parsing"; done: number; total: number };
type Tab = "gaps" | "edges" | "tests" | "risks";

function isSystemMap(v: unknown): v is SystemMap {
  const m = v as SystemMap;
  return !!m && m.version === MAP_VERSION && Array.isArray(m.files) && Array.isArray(m.edges);
}

export default function App() {
  const [source, setSource] = useState<Source>({ kind: "sample", id: SAMPLES[0].id });
  const [map, setMap] = useState<SystemMap>();
  const [mapError, setMapError] = useState<string>();
  const [requirement, setRequirement] = useState(SAMPLES[0].examples[0]);
  const [result, setResult] = useState<ImpactResult>();
  const [analyzedFor, setAnalyzedFor] = useState("");
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<Tab>("gaps");
  const [ai, setAi] = useState<Analysis>();
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiError, setAiError] = useState("");
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // React has no prop for webkitdirectory.
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const sample = source.kind === "sample" ? SAMPLES.find((s) => s.id === source.id) : undefined;

  useEffect(() => {
    if (!sample) return;
    let cancelled = false;
    fetch(sample.file)
      .then((r) => r.json())
      .then((m) => {
        if (cancelled) return;
        if (!isSystemMap(m)) throw new Error("bad map");
        setMap(m);
        setMapError(undefined);
      })
      .catch(() => !cancelled && setMapError("The sample map could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [sample]);

  const insights = useMemo(() => (map && result ? buildInsights(map, result) : undefined), [map, result]);
  const byId = useMemo(() => new Map((map?.files ?? []).map((f) => [f.id, f])), [map]);
  const linkCounts = useMemo(() => {
    const c = { import: 0, http: 0, data: 0, event: 0 };
    for (const e of map?.edges ?? []) c[e.type]++;
    return c;
  }, [map]);

  const reset = () => {
    setResult(undefined);
    setAi(undefined);
    setAiState("idle");
  };

  const run = () => {
    if (!map || !requirement.trim()) return;
    const r = analyze(map, requirement);
    setResult(r);
    setAnalyzedFor(requirement);
    setSelected(r.nodes[0]?.id);
    setAi(undefined);
    setAiState("idle");
    setTab("gaps");
  };

  const chooseSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)!;
    setSource({ kind: "sample", id });
    setRequirement(s.examples[0]);
    reset();
  };

  const upload = async (file: File) => {
    try {
      const m = JSON.parse(await file.text());
      if (!isSystemMap(m)) throw new Error();
      setMap(m);
      setSource({ kind: "upload", name: file.name });
      setMapError(undefined);
      reset();
    } catch {
      setMapError(`${file.name} is not a system map. Create one with: npx impact-mapper scan ./your-repo`);
    }
  };

  const scanFolder = async (getRequest: () => Promise<ScanRequest | undefined>) => {
    setMapError(undefined);
    setScan({ status: "reading", found: 0 });
    try {
      const req = await getRequest();
      if (!req) return; // cancelled
      if (!req.files.length) {
        setMapError(`No source files found in ${req.name}. Supported: TypeScript, JavaScript, Python, Java, Go, C#, PHP, Ruby.`);
        return;
      }
      setScan({ status: "parsing", done: 0, total: req.files.length });
      const m = await scanInWorker(req, (done, total) => setScan({ status: "parsing", done, total }));
      setMap(m);
      setSource({ kind: "folder", name: req.name });
      reset();
    } catch (e) {
      setMapError(`The folder could not be scanned: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setScan({ status: "idle" });
    }
  };

  const chooseFolder = () => {
    if (canPickDirectory()) scanFolder(() => pickDirectory((found) => setScan({ status: "reading", found })));
    else folderInput.current?.click();
  };

  const saveMap = () => {
    if (!map) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(map)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${map.name.replace(/[^\w.-]+/g, "-").toLowerCase() || "system"}-map.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const explain = async () => {
    if (!map || !result) return;
    setAiState("loading");
    setAiError("");
    try {
      setAi(await requestExplanation(buildRequest(map, analyzedFor, result)));
      setAiState("idle");
    } catch (e) {
      setAiState("error");
      setAiError(e instanceof Error ? e.message : "The request failed.");
    }
  };

  const copy = async () => {
    if (!map || !result || !insights) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(analyzedFor, map.name, result, insights, ai));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setAiError("The browser blocked copying to the clipboard.");
    }
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const selectedNode = result?.nodes.find((n) => n.id === selected);
  const stale = !!result && analyzedFor !== requirement;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="4" />
            <circle cx="16" cy="16" r="9.5" fill="none" />
            <circle cx="16" cy="16" r="14.5" fill="none" />
          </svg>
          <div>
            <h1>Impact Mapper</h1>
            <p>See what a feature will touch before anyone writes it.</p>
          </div>
        </div>
        <nav>
          <a href="#how">How it works</a>
          <button className="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </nav>
      </header>

      <main>
        <section className="panel input">
          <div className="field">
            <label htmlFor="codebase">Codebase</label>
            <div className="row">
              <select
                id="codebase"
                value={source.kind === "sample" ? source.id : source.kind}
                disabled={scan.status !== "idle"}
                onChange={(e) => {
                  if (e.target.value === "upload") fileInput.current?.click();
                  else if (e.target.value === "folder") chooseFolder();
                  else chooseSample(e.target.value);
                }}
              >
                {SAMPLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    Sample: {s.label}
                  </option>
                ))}
                <option value="folder">{source.kind === "folder" ? `Your folder: ${source.name}` : "Choose a folder on this computer…"}</option>
                <option value="upload">{source.kind === "upload" ? `Your map: ${source.name}` : "Upload a saved map…"}</option>
              </select>
              <button className="primary" onClick={chooseFolder} disabled={scan.status !== "idle"}>
                Choose folder
              </button>
              <button className="ghost" onClick={() => fileInput.current?.click()} disabled={scan.status !== "idle"}>
                Upload map
              </button>
              {source.kind === "folder" && map && (
                <button className="ghost" onClick={saveMap} title="Save this scan, so next time you can upload it instead of scanning again">
                  Save map
                </button>
              )}
              <input
                ref={folderInput}
                type="file"
                hidden
                onChange={(e) => {
                  const list = e.target.files;
                  if (list?.length) scanFolder(() => fromFileList(list));
                  e.target.value = "";
                }}
              />
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />
            </div>
            {scan.status !== "idle" && (
              <div className="scan-progress" role="status">
                <span>
                  {scan.status === "reading"
                    ? `Reading the folder… ${scan.found ? `${scan.found.toLocaleString()} source files so far` : ""}`
                    : `Parsing ${scan.done.toLocaleString()} of ${scan.total.toLocaleString()} files, on this computer`}
                </span>
                {scan.status === "parsing" && <progress max={scan.total} value={scan.done} />}
              </div>
            )}
            {mapError && <p className="error">{mapError}</p>}
            {map && scan.status === "idle" && (
              <p className="meta">
                {map.name} · {map.files.length} files ·{" "}
                {Object.entries(map.languages)
                  .sort((a, b) => b[1] - a[1])
                  .map(([l, n]) => `${l} ${n}`)
                  .join(", ")}{" "}
                · {linkCounts.import} imports, {linkCounts.http} API links
                {linkCounts.data ? `, ${linkCounts.data} data links` : ""}
                {linkCounts.event ? `, ${linkCounts.event} event links` : ""}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="req">Feature requirement</label>
            <textarea
              id="req"
              rows={4}
              value={requirement}
              maxLength={4000}
              onChange={(e) => setRequirement(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && run()}
              placeholder="Describe the feature in plain words, the way the ticket says it."
            />
            {sample && (
              <div className="examples">
                <span>Try:</span>
                {sample.examples.map((ex) => (
                  <button key={ex} className="example" onClick={() => setRequirement(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="actions">
            <button className="primary" onClick={run} disabled={!map}>
              Map the impact
            </button>
            {stale && <span className="hint">The requirement changed. Map it again to update the results.</span>}
          </div>
        </section>

        {result && result.nodes.length === 0 && (
          <section className="panel empty">
            <h2>Nothing in this codebase matched</h2>
            <p>
              No file, endpoint or data name shares a word with the requirement ({result.tokens.join(", ") || "no usable words"}). Use the names
              the product uses: "invoice" rather than "bill", "comment" rather than "reply".
            </p>
          </section>
        )}

        {result && result.nodes.length > 0 && insights && (
          <>
            <section className="summary">
              <div className="stat">
                <b>{result.stats.direct}</b> direct matches
              </div>
              <div className="stat down">
                <b>{result.stats.downstream}</b> downstream, could break
              </div>
              <div className="stat up">
                <b>{result.stats.upstream}</b> upstream, it relies on them
              </div>
              {result.stats.weak > 0 && (
                <div className="stat muted" title="Linked to the change only through shared plumbing, such as the API client">
                  <b>{result.stats.weak}</b> loosely linked, not listed
                </div>
              )}
              <div className="spacer" />
              <button className="ghost" onClick={copy}>
                {copied ? "Copied" : "Copy as Markdown"}
              </button>
            </section>

            <div className="results">
              <section className="panel graph-panel">
                <ImpactGraph result={result} selected={selected} onSelect={setSelected} />
                {selectedNode && <NodeDetails node={selectedNode} file={byId.get(selectedNode.id)} ai={ai} />}
              </section>

              <section className="panel areas">
                <h2>What it touches</h2>
                {AREA_ORDER.filter((a) => result.byArea[a]?.length).map((area) => (
                  <div key={area} className="area">
                    <h3 className={`area-${area.toLowerCase()}`}>
                      <i /> {area} <span>{result.byArea[area]!.length}</span>
                    </h3>
                    <ul>
                      {result.byArea[area]!.map((n) => {
                        const note = ai?.impacts.find((i) => i.file === n.id);
                        return (
                          <li key={n.id}>
                            <button className={`file${selected === n.id ? " selected" : ""}`} onClick={() => setSelected(n.id)}>
                              <span className={`badge ${n.relation}`}>{n.relation}</span>
                              <span className="name" title={n.id}>
                                {shortName(n.id)}
                              </span>
                              {note && <span className={`risk ${note.risk}`}>{note.change}</span>}
                              <span className="dir">{n.id.slice(0, -shortName(n.id).length)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            </div>

            <section className="panel checklist">
              <div className="checklist-head">
                <h2>Before you build</h2>
                <div className="ai-box">
                  <span className="hint">
                    {ai
                      ? "Explained by Claude from the graph above. Every file it cites is in the map."
                      : "Built from the code graph. Claude can explain it in the context of the requirement."}
                  </span>
                  <button className="primary" onClick={explain} disabled={aiState === "loading"}>
                    {aiState === "loading" ? "Asking Claude…" : ai ? "Ask again" : "Explain with Claude"}
                  </button>
                </div>
              </div>
              {aiState === "error" && (
                <p className="error">
                  {aiError}{" "}
                  {/Settings/.test(aiError) && (
                    <button className="link-button" onClick={() => setSettingsOpen(true)}>
                      Open Settings
                    </button>
                  )}
                </p>
              )}
              {ai && <p className="ai-summary">{ai.summary}</p>}
              <div className="tabs" role="tablist">
                {(
                  [
                    ["gaps", "Gap questions", ai?.gapQuestions.length ?? insights.gapQuestions.length],
                    ["edges", "Edge cases", ai?.edgeCases.length ?? insights.edgeCases.length],
                    ["tests", "Test cases", ai?.testCases.length ?? insights.testCases.length],
                    ["risks", "Risks", ai?.risks.length ?? insights.risks.length],
                  ] as const
                ).map(([id, label, count]) => (
                  <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                    {label} <span>{count}</span>
                  </button>
                ))}
              </div>
              <div className="tab-body" role="tabpanel">
                {tab === "gaps" && <Items items={ai ? ai.gapQuestions : insights.gapQuestions.map((i) => i.text)} />}
                {tab === "edges" && <Items items={ai ? ai.edgeCases : insights.edgeCases.map((i) => i.text)} />}
                {tab === "risks" && (
                  <Items items={ai ? ai.risks.map((r) => `${r.risk} Mitigation: ${r.mitigation}`) : insights.risks.map((i) => i.text)} />
                )}
                {tab === "tests" && (
                  <ol className="tests">
                    {(ai?.testCases ?? insights.testCases).map((t) => (
                      <li key={t.title}>
                        <b>{t.title}</b>
                        <ol>
                          {t.steps.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ol>
                        <p>
                          <em>Expected:</em> {t.expected}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          </>
        )}

        <section className="panel how" id="how">
          <h2>How it works</h2>
          <ol>
            <li>
              <b>Scan.</b> <b>Choose folder</b> parses every file in your browser with tree-sitter (TypeScript, JavaScript, Python, Java, Go, C#,
              PHP, Ruby) and records imports, definitions, routes served and called, data stores and events. Nothing is uploaded: the files are read
              on your computer, and only their structure is kept. The same scan runs from the command line for CI or very large repos.
            </li>
            <li>
              <b>Link.</b> Imports connect files inside a codebase. Matching route strings connect a screen's API call to the controller that serves
              it, across languages. Shared table and event names connect the rest.
            </li>
            <li>
              <b>Map.</b> The requirement's words find the files it is about. The graph then shows what depends on them (downstream, could break)
              and what they depend on (upstream).
            </li>
            <li>
              <b>Explain.</b> Optionally, Claude turns the result into gap questions, edge cases, tests and risks. It sees only the structure, and
              every file it cites must be one the graph found.
            </li>
          </ol>
        </section>
      </main>

      {settingsOpen && <Settings onClose={closeSettings} />}
    </div>
  );
}

function Items({ items }: { items: string[] }) {
  if (!items.length) return <p className="hint">Nothing here for this requirement.</p>;
  return (
    <ul className="items">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function NodeDetails({ node, file, ai }: { node: ImpactNode; file?: SystemMap["files"][number]; ai?: Analysis }) {
  const note = ai?.impacts.find((i) => i.file === node.id);
  const routes = file?.routes.filter((r) => r.role !== "mentions") ?? [];
  return (
    <aside className="details" aria-live="polite">
      <h3 title={node.id}>{shortName(node.id)}</h3>
      <p className="path">{node.id}</p>
      <p>
        <span className={`badge ${node.relation}`}>{node.relation}</span> {node.area}
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
      {node.relation === "direct" ? (
        <p>Matches the requirement on: {node.matched.join(", ")}</p>
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
      {file?.symbols.length ? <p className="small">Defines: {file.symbols.slice(0, 10).join(", ")}</p> : null}
      {file?.card && <p className="small">{file.card}</p>}
    </aside>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState(getUserKey());
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal(); // StrictMode runs this twice in dev
    // Covers Cancel, Save and the Escape key alike.
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onClose]);
  return (
    <dialog ref={dialog} className="settings">
      <h2>Settings</h2>
      <label htmlFor="key">Your Anthropic API key (optional)</label>
      <input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
      <p className="hint">
        Used only for "Explain with Claude". It is sent with each request and kept in this browser tab until you close it. Without one, the
        site's free demo allows a few explanations a day.
      </p>
      <div className="row end">
        <button className="ghost" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={() => {
            setUserKey(key.trim());
            dialog.current?.close();
          }}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
