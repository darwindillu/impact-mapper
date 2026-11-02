import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../shared/ai.ts";
import { analyze, type ImpactResult } from "../shared/analyze.ts";
import { buildFrd } from "../shared/frd.ts";
import { buildInsights, hotFiles, type Insights } from "../shared/insights.ts";
import { MAP_VERSION, type SystemMap } from "../shared/map.ts";
import { toMarkdown } from "../shared/markdown.ts";
import { buildRequest } from "../shared/request.ts";
import { vocabulary } from "../shared/vocabulary.ts";
import { FrdPanel } from "./components/FrdPanel.tsx";
import { ImpactGraph } from "./components/ImpactGraph.tsx";
import { NodeDetails } from "./components/NodeDetails.tsx";
import { Settings } from "./components/Settings.tsx";
import { fetchTicket, postToTicket, requestExplanation, requestFrd, requestTerms } from "./lib/api.ts";
import { AREA_ORDER, shortName } from "./lib/names.ts";
import { readSharedView, shareUrl, type SharedView } from "./lib/share.ts";
import { SAMPLES } from "./samples.ts";
import { canPickDirectory, fromFileList, pickDirectory, scanInWorker } from "./scan/folder.ts";
import type { ScanRequest } from "./scan/protocol.ts";

type Source =
  | { kind: "sample"; id: string }
  | { kind: "upload"; name: string }
  | { kind: "folder"; name: string }
  | { kind: "shared"; name: string };
type ScanState = { status: "idle" } | { status: "reading"; found: number } | { status: "parsing"; done: number; total: number };
type Tab = "gaps" | "edges" | "tests" | "risks";
type Mode = "feature" | "diff";

function isSystemMap(v: unknown): v is SystemMap {
  const m = v as SystemMap;
  return !!m && m.version === MAP_VERSION && Array.isArray(m.files) && Array.isArray(m.edges);
}

const errorText = (e: unknown, fallback = "The request failed.") => (e instanceof Error ? e.message : fallback);

export default function App() {
  const [source, setSource] = useState<Source>({ kind: "sample", id: SAMPLES[0].id });
  const [map, setMap] = useState<SystemMap>();
  const [mapError, setMapError] = useState<string>();
  const [requirement, setRequirement] = useState(SAMPLES[0].examples[0]);
  const [mode, setMode] = useState<Mode>("feature");
  const [changedText, setChangedText] = useState("");
  const [related, setRelated] = useState(false);
  // Related words from Claude for the last mapped requirement.
  const [extraTerms, setExtraTerms] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "terms" | "ticket" | "post" | "share">("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [result, setResult] = useState<ImpactResult>();
  const [analyzed, setAnalyzed] = useState<{ text: string; mode: Mode }>({ text: "", mode: "feature" });
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<Tab>("gaps");
  const [ai, setAi] = useState<Analysis>();
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiError, setAiError] = useState("");
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [frdOpen, setFrdOpen] = useState(false);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [ticketInput, setTicketInput] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  // A shared link's snapshot carries its own checklist; there's no full map to rebuild it from.
  const [sharedInsights, setSharedInsights] = useState<Insights>();
  const [pendingRun, setPendingRun] = useState(false);
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

  const runWith = useCallback(
    (m: SystemMap, runMode: Mode, text: string, terms: string[]) => {
      const r = runMode === "feature" ? analyze(m, text, { extraTerms: terms }) : analyze(m, "", { changedFiles: text.split(/\r?\n|,/) });
      setResult(r);
      setAnalyzed({ text, mode: runMode });
      setSelected(r.nodes[0]?.id);
      setAi(undefined);
      setAiState("idle");
      setSharedInsights(undefined);
      setFrdOpen(false);
      setTab("gaps");
    },
    [],
  );

  // Open a shared link: re-run a sample, or show a snapshot.
  useEffect(() => {
    readSharedView(location.hash).then((view?: SharedView) => {
      if (!view) return;
      setMode(view.mode);
      if (view.mode === "feature") setRequirement(view.text);
      else setChangedText(view.text);
      if (view.sample && SAMPLES.some((s) => s.id === view.sample)) {
        setSource({ kind: "sample", id: view.sample });
        setPendingRun(true);
      } else if (view.snapshot) {
        const files = view.snapshot.files.map((f) => ({ ...f, lang: "", loc: 0, events: [] }));
        setMap({ version: MAP_VERSION, name: view.mapName, scannedAt: "", roots: [], languages: {}, files, resources: [], edges: [] });
        setSource({ kind: "shared", name: view.mapName });
        setResult(view.snapshot.result);
        setAnalyzed({ text: view.text, mode: view.mode });
        setSelected(view.snapshot.result.nodes[0]?.id);
        setSharedInsights(view.snapshot.insights);
        setAi(view.snapshot.ai);
      }
    });
  }, []);

  useEffect(() => {
    if (pendingRun && map) {
      setPendingRun(false);
      runWith(map, mode, mode === "feature" ? requirement : changedText, []);
    }
  }, [pendingRun, map, mode, requirement, changedText, runWith]);

  const computedInsights = useMemo(() => (map && result && source.kind !== "shared" ? buildInsights(map, result) : undefined), [map, result, source]);
  const insights = sharedInsights ?? computedInsights;
  const hot = useMemo(() => new Set(map && result ? hotFiles(map, result).map((n) => n.id) : []), [map, result]);
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
    setSharedInsights(undefined);
    setFrdOpen(false);
    setExtraTerms([]);
    history.replaceState(null, "", location.pathname);
  };

  const run = async () => {
    const text = mode === "feature" ? requirement : changedText;
    if (!map || !text.trim() || source.kind === "shared") return;
    setNotice(undefined);
    let terms: string[] = [];
    if (mode === "feature" && related) {
      setBusy("terms");
      try {
        terms = await requestTerms(requirement, vocabulary(map));
      } catch (e) {
        setNotice({ text: `Related words are unavailable (${errorText(e)}), so only the requirement's own words were used.`, error: true });
      } finally {
        setBusy("");
      }
    }
    setExtraTerms(terms);
    runWith(map, mode, text, terms);
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
      setMapError(`${file.name} is not a system map. Create one with Choose folder, or: impact-mapper scan ./your-repo`);
    }
  };

  const scanFolder = async (getRequest: () => Promise<ScanRequest | undefined>) => {
    setMapError(undefined);
    setScan({ status: "reading", found: 0 });
    try {
      const req = await getRequest();
      if (!req) return; // cancelled
      if (!req.files.length) {
        setMapError(`No source files found in ${req.name}.`);
        return;
      }
      setScan({ status: "parsing", done: 0, total: req.files.length });
      const m = await scanInWorker(req, (done, total) => setScan({ status: "parsing", done, total }));
      setMap(m);
      setSource({ kind: "folder", name: req.name });
      reset();
    } catch (e) {
      setMapError(`The folder could not be scanned: ${errorText(e, "unknown error")}`);
    } finally {
      setScan({ status: "idle" });
    }
  };

  const chooseFolder = () => {
    if (canPickDirectory()) scanFolder(() => pickDirectory((found) => setScan({ status: "reading", found })));
    else folderInput.current?.click();
  };

  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveMap = () => map && download(`${map.name.replace(/[^\w.-]+/g, "-").toLowerCase() || "system"}-map.json`, JSON.stringify(map), "application/json");

  // What Claude reads as "the requirement": in diff mode, the changed files.
  const aiRequirement = analyzed.mode === "feature" ? analyzed.text : `These files changed:\n${analyzed.text}`;

  const explain = async () => {
    if (!map || !result) return;
    setAiState("loading");
    setAiError("");
    try {
      setAi(await requestExplanation(buildRequest(map, aiRequirement, result)));
      setAiState("idle");
    } catch (e) {
      setAiState("error");
      setAiError(errorText(e));
    }
  };

  const markdown = () => (map && result && insights ? toMarkdown(analyzed.text, map.name, result, insights, ai) : "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice({ text: "The browser blocked copying to the clipboard.", error: true });
    }
  };

  const importTicket = async () => {
    if (!ticketInput.trim()) return;
    setBusy("ticket");
    setNotice(undefined);
    try {
      const t = await fetchTicket(ticketInput.trim());
      setTicketRef(ticketInput.trim());
      setRequirement(`${t.title}\n\n${t.body}`.trim().slice(0, 4000));
      if (t.files?.length) {
        setChangedText(t.files.join("\n"));
        setMode("diff");
        setNotice({ text: `Imported pull request "${t.title}" with ${t.files.length} changed files.` });
      } else {
        setMode("feature");
        setNotice({ text: `Imported "${t.title}".` });
      }
    } catch (e) {
      setNotice({ text: errorText(e), error: true });
    } finally {
      setBusy("");
    }
  };

  const postBack = async () => {
    setBusy("post");
    try {
      const where = await postToTicket(ticketRef, markdown());
      setNotice({ text: `Posted the impact map to ${where}.` });
    } catch (e) {
      setNotice({ text: errorText(e), error: true });
    } finally {
      setBusy("");
    }
  };

  const share = async () => {
    if (!map || !result || !insights) return;
    setBusy("share");
    try {
      const base = { v: 1 as const, mode: analyzed.mode, text: analyzed.text, mapName: map.name };
      const view: SharedView = sample
        ? { ...base, sample: sample.id }
        : {
            ...base,
            snapshot: {
              result,
              insights,
              ai,
              files: result.nodes
                .map((n) => byId.get(n.id))
                .filter((f) => !!f)
                .map((f) => ({ id: f.id, tags: f.tags, symbols: f.symbols.slice(0, 10), routes: f.routes.filter((r) => r.role !== "mentions").slice(0, 6), tables: f.tables, churn: f.churn })),
            },
          };
      const url = await shareUrl(view);
      await navigator.clipboard.writeText(url);
      setNotice({
        text: sample
          ? "Link copied. It opens this sample with the same input."
          : "Link copied. It holds this result, including file paths, so share it only with people who may see this codebase's structure.",
      });
    } catch (e) {
      setNotice({ text: `The link could not be created: ${errorText(e)}`, error: true });
    } finally {
      setBusy("");
    }
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const selectedNode = result?.nodes.find((n) => n.id === selected);
  const stale = !!result && source.kind !== "shared" && (analyzed.mode !== mode || analyzed.text !== (mode === "feature" ? requirement : changedText));

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
                {source.kind === "shared" && <option value="shared">Shared result: {source.name}</option>}
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
            {map && scan.status === "idle" && source.kind !== "shared" && (
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
            {source.kind === "shared" && (
              <p className="meta">
                A shared result for {source.name}. To change it, map the same codebase yourself: choose its folder or upload its map.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="ticket">Import from a ticket (optional)</label>
            <div className="row">
              <input
                id="ticket"
                className="grow"
                value={ticketInput}
                onChange={(e) => setTicketInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && importTicket()}
                placeholder="GitHub issue or pull request link, Jira link or key, Plane link or key"
              />
              <button className="ghost" onClick={importTicket} disabled={busy === "ticket" || !ticketInput.trim()}>
                {busy === "ticket" ? "Importing…" : "Import"}
              </button>
            </div>
          </div>

          <div className="field">
            <div className="mode-switch" role="tablist" aria-label="What to map">
              <button role="tab" aria-selected={mode === "feature"} className={mode === "feature" ? "active" : ""} onClick={() => setMode("feature")}>
                Feature requirement
              </button>
              <button role="tab" aria-selected={mode === "diff"} className={mode === "diff" ? "active" : ""} onClick={() => setMode("diff")}>
                Changed files
              </button>
            </div>
            <label htmlFor="req" className="sr-only">
              {mode === "feature" ? "Feature requirement" : "Changed files"}
            </label>
            <textarea
              id="req"
              rows={mode === "feature" ? 4 : 6}
              value={mode === "feature" ? requirement : changedText}
              maxLength={mode === "feature" ? 4000 : 100_000}
              onChange={(e) => (mode === "feature" ? setRequirement(e.target.value) : setChangedText(e.target.value))}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && run()}
              placeholder={
                mode === "feature"
                  ? "Describe the feature in plain words, the way the ticket says it."
                  : "Paste the changed file paths, one per line: the output of git diff --name-only, or the file list of a pull request."
              }
            />
            {mode === "diff" && (
              <p className="hint">
                Shows what the changed files could break. From a terminal: <code>git diff --name-only origin/main...HEAD</code>
              </p>
            )}
            {mode === "feature" && sample && (
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
            <button className="primary" onClick={run} disabled={!map || busy === "terms" || source.kind === "shared"}>
              {busy === "terms" ? "Finding related words…" : "Map the impact"}
            </button>
            {mode === "feature" && (
              <label className="check" title="Claude suggests words this codebase uses for the same things, such as 'favorite' for 'bookmark'">
                <input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} /> Also search related words (Claude)
              </label>
            )}
            {stale && <span className="hint">The input changed. Map it again to update the results.</span>}
          </div>
          {extraTerms.length > 0 && result && (
            <p className="hint terms">
              Also searched: {extraTerms.map((t) => (
                <span key={t} className="term">
                  {t}
                </span>
              ))}
            </p>
          )}
          {result?.unmatched?.length ? (
            <p className="hint">
              Not in the map: {result.unmatched.slice(0, 5).join(", ")}
              {result.unmatched.length > 5 ? ` and ${result.unmatched.length - 5} more` : ""}
            </p>
          ) : null}
          {notice && (
            <p className={notice.error ? "error" : "notice"} role="status">
              {notice.text}{" "}
              {notice.error && /Settings/.test(notice.text) && (
                <button className="link-button" onClick={() => setSettingsOpen(true)}>
                  Open Settings
                </button>
              )}
            </p>
          )}
        </section>

        {result && result.nodes.length === 0 && (
          <section className="panel empty">
            <h2>Nothing in this codebase matched</h2>
            <p>
              {analyzed.mode === "diff"
                ? "None of the changed files are in this map. Check that the map is of the same repository."
                : `No file, endpoint, data name or UI text shares a word with the requirement (${result.tokens.join(", ") || "no usable words"}). Use the names the product uses, or tick "Also search related words".`}
            </p>
          </section>
        )}

        {result && result.nodes.length > 0 && insights && (
          <>
            <section className="summary">
              <div className="stat">
                <b>{result.stats.direct}</b> {analyzed.mode === "diff" ? "changed" : "direct matches"}
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
              <button className="ghost" onClick={() => setFrdOpen(true)} disabled={!map}>
                Draft FRD
              </button>
              <button className="ghost" onClick={share} disabled={busy === "share"}>
                Copy share link
              </button>
              {ticketRef && (
                <button className="ghost" onClick={postBack} disabled={busy === "post"} title={`Post the impact map as a comment on ${ticketRef}`}>
                  {busy === "post" ? "Posting…" : "Post to ticket"}
                </button>
              )}
              <button className="ghost" onClick={copy}>
                {copied ? "Copied" : "Copy as Markdown"}
              </button>
            </section>

            {frdOpen && map && (
              <FrdPanel
                draft={buildFrd(map, aiRequirement, result, insights)}
                onAskClaude={async () => (await requestFrd(buildRequest(map, aiRequirement, result))).markdown}
                onClose={() => setFrdOpen(false)}
              />
            )}

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
                  {source.kind !== "shared" && (
                    <button className="primary" onClick={explain} disabled={aiState === "loading"}>
                      {aiState === "loading" ? "Asking Claude…" : ai ? "Ask again" : "Explain with Claude"}
                    </button>
                  )}
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
              <b>Scan.</b> <b>Choose folder</b> parses every file in your browser with tree-sitter (TypeScript, JavaScript, Python, Java, Kotlin,
              Scala, Go, Rust, C#, PHP, Ruby, Vue and Svelte) and records imports, definitions, routes, data, fields, UI text and events. Nothing is
              uploaded: only the structure is kept. The command-line scan adds 12 months of git history.
            </li>
            <li>
              <b>Link.</b> Imports connect files inside a codebase. Matching route strings connect a screen's API call to the controller that serves
              it, across languages, including prefixes set in another file. Shared tables, fields and events connect the rest.
            </li>
            <li>
              <b>Map.</b> A requirement's words and quoted UI text find the files it is about; a list of changed files can be the starting point
              instead. The graph then shows what depends on them (downstream, could break) and what they depend on (upstream).
            </li>
            <li>
              <b>Explain.</b> Optionally, Claude suggests the codebase's own words for the requirement, explains the result, and drafts an FRD. It
              sees only the structure, and every file it cites must be one the graph found.
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
