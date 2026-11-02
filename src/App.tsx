import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../shared/ai.ts";
import { analyze, type ImpactResult } from "../shared/analyze.ts";
import { buildFrd } from "../shared/frd.ts";
import { buildInsights, hotFiles, type Insights } from "../shared/insights.ts";
import { MAP_VERSION, type SystemMap } from "../shared/map.ts";
import { toMarkdown } from "../shared/markdown.ts";
import { buildRequest } from "../shared/request.ts";
import { vocabulary } from "../shared/vocabulary.ts";
import { Checklist } from "./components/Checklist.tsx";
import { FileList } from "./components/FileList.tsx";
import { FrdPanel } from "./components/FrdPanel.tsx";
import { Help } from "./components/Help.tsx";
import { ImpactGraph } from "./components/ImpactGraph.tsx";
import { InfoTip } from "./components/InfoTip.tsx";
import { NodeDetails } from "./components/NodeDetails.tsx";
import { Settings } from "./components/Settings.tsx";
import { Step } from "./components/Step.tsx";
import { fetchTicket, postToTicket, requestExplanation, requestFrd, requestTerms } from "./lib/api.ts";
import { RELATION_HELP } from "./lib/labels.ts";
import { readSharedView, shareUrl, type SharedView } from "./lib/share.ts";
import { SAMPLES } from "./samples.ts";
import { canPickDirectory, fromFileList, pickDirectory, scanInWorker } from "./scan/folder.ts";
import type { ScanRequest } from "./scan/protocol.ts";

type Source =
  { kind: "sample"; id: string } | { kind: "upload"; name: string } | { kind: "folder"; name: string } | { kind: "shared"; name: string };
type ScanState = { status: "idle" } | { status: "reading"; found: number } | { status: "parsing"; done: number; total: number };
type Mode = "feature" | "diff";

function isSystemMap(v: unknown): v is SystemMap {
  const m = v as SystemMap;
  return !!m && m.version === MAP_VERSION && Array.isArray(m.files) && Array.isArray(m.edges);
}

const WELCOME_KEY = "impact-mapper.welcome";
const errorText = (e: unknown, fallback = "The request failed.") => (e instanceof Error ? e.message : fallback);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function App() {
  const [source, setSource] = useState<Source>({ kind: "sample", id: SAMPLES[0].id });
  const [map, setMap] = useState<SystemMap>();
  const [mapError, setMapError] = useState<string>();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [requirement, setRequirement] = useState(SAMPLES[0].examples[0]);
  const [mode, setMode] = useState<Mode>("feature");
  const [changedText, setChangedText] = useState("");
  const [related, setRelated] = useState(false);
  // Related words from Claude for the last mapped requirement.
  const [extraTerms, setExtraTerms] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "terms" | "ticket" | "post" | "share">("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [resultNotice, setResultNotice] = useState<{ text: string; error?: boolean }>();
  const [result, setResult] = useState<ImpactResult>();
  const [analyzed, setAnalyzed] = useState<{ text: string; mode: Mode }>({ text: "", mode: "feature" });
  const [selected, setSelected] = useState<string>();
  const [ai, setAi] = useState<Analysis>();
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [frdOpen, setFrdOpen] = useState(false);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketInput, setTicketInput] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  // A shared link's snapshot carries its own checklist; there's no full map to rebuild it from.
  const [sharedInsights, setSharedInsights] = useState<Insights>();
  const [pendingRun, setPendingRun] = useState(false);
  // The "new here?" banner, until dismissed (remembered in this browser).
  const [welcome, setWelcome] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) !== "dismissed";
    } catch {
      return true;
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrollToResults = useRef(false);

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
      .catch(() => !cancelled && setMapError("The sample could not be loaded. Reload the page to try again."));
    return () => {
      cancelled = true;
    };
  }, [sample]);

  const runWith = useCallback((m: SystemMap, runMode: Mode, text: string, terms: string[]) => {
    const r = runMode === "feature" ? analyze(m, text, { extraTerms: terms }) : analyze(m, "", { changedFiles: text.split(/\r?\n|,/) });
    setResult(r);
    setAnalyzed({ text, mode: runMode });
    setSelected(r.nodes[0]?.id);
    setAi(undefined);
    setSharedInsights(undefined);
    setFrdOpen(false);
    setResultNotice(undefined);
    scrollToResults.current = true;
  }, []);

  // Bring the result into view after mapping.
  useEffect(() => {
    if (result && scrollToResults.current) {
      scrollToResults.current = false;
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  // Open a shared link: re-run a sample, or show a snapshot.
  useEffect(() => {
    readSharedView(location.hash).then((view?: SharedView) => {
      if (!view) return;
      setWelcome(false);
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

  const computedInsights = useMemo(
    () => (map && result && source.kind !== "shared" ? buildInsights(map, result) : undefined),
    [map, result, source],
  );
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
    setSharedInsights(undefined);
    setFrdOpen(false);
    setExtraTerms([]);
    setResultNotice(undefined);
    history.replaceState(null, "", location.pathname);
  };

  const run = async () => {
    const text = mode === "feature" ? requirement : changedText;
    if (!map || source.kind === "shared") return;
    if (!text.trim()) {
      setNotice({ text: mode === "feature" ? "Describe the feature first." : "Paste the changed file paths first.", error: true });
      return;
    }
    setNotice(undefined);
    let terms: string[] = [];
    if (mode === "feature" && related) {
      setBusy("terms");
      try {
        terms = await requestTerms(requirement, vocabulary(map));
      } catch (e) {
        setNotice({ text: `Related words are unavailable (${errorText(e)}), so only your own words were used.`, error: true });
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
    setChooserOpen(false);
    reset();
  };

  const upload = async (file: File) => {
    try {
      const m = JSON.parse(await file.text());
      if (!isSystemMap(m)) throw new Error();
      setMap(m);
      setSource({ kind: "upload", name: file.name });
      setMapError(undefined);
      setChooserOpen(false);
      reset();
    } catch {
      setMapError(`${file.name} is not an Impact Mapper map. Use a file saved with Save map, or made by the command line.`);
    }
  };

  const scanFolder = async (getRequest: () => Promise<ScanRequest | undefined>) => {
    setMapError(undefined);
    setScan({ status: "reading", found: 0 });
    try {
      const req = await getRequest();
      if (!req) return; // cancelled
      if (!req.files.length) {
        setMapError(`No source files found in "${req.name}". Pick the repository's main folder, not a subfolder like docs.`);
        return;
      }
      setScan({ status: "parsing", done: 0, total: req.files.length });
      const m = await scanInWorker(req, (done, total) => setScan({ status: "parsing", done, total }));
      setMap(m);
      setSource({ kind: "folder", name: req.name });
      setChooserOpen(false);
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

  const saveMap = () =>
    map && download(`${map.name.replace(/[^\w.-]+/g, "-").toLowerCase() || "system"}-map.json`, JSON.stringify(map), "application/json");

  // What Claude reads as "the requirement": in diff mode, the changed files.
  const aiRequirement = analyzed.mode === "feature" ? analyzed.text : `These files changed:\n${analyzed.text}`;
  const explain = async () => {
    if (!map || !result) throw new Error("Map something first.");
    const a = await requestExplanation(buildRequest(map, aiRequirement, result));
    setAi(a);
  };

  const markdown = () => (map && result && insights ? toMarkdown(analyzed.text, map.name, result, insights, ai) : "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setResultNotice({ text: "The browser blocked copying to the clipboard. Allow clipboard access for this site.", error: true });
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
        setNotice({ text: `Imported pull request "${t.title}" with ${plural(t.files.length, "changed file")}. Click Map the impact.` });
      } else {
        setMode("feature");
        setNotice({ text: `Imported "${t.title}". Check the text below, then click Map the impact.` });
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
      setResultNotice({ text: `Posted the impact map to ${where}.` });
    } catch (e) {
      setResultNotice({ text: errorText(e), error: true });
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
                .map((f) => ({
                  id: f.id,
                  tags: f.tags,
                  symbols: f.symbols.slice(0, 10),
                  routes: f.routes.filter((r) => r.role !== "mentions").slice(0, 6),
                  tables: f.tables,
                  churn: f.churn,
                })),
            },
          };
      await navigator.clipboard.writeText(await shareUrl(view));
      setResultNotice({
        text: sample
          ? "Link copied. It opens this sample with the same input."
          : "Link copied. It includes this codebase's file paths (never its code), so share it only with people who may see them.",
      });
    } catch (e) {
      setResultNotice({ text: `The link could not be created: ${errorText(e)}`, error: true });
    } finally {
      setBusy("");
    }
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const dismissWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, "dismissed");
    } catch {
      // Storage blocked: the banner comes back next visit.
    }
  };

  const selectedNode = result?.nodes.find((n) => n.id === selected);
  const stale =
    !!result && source.kind !== "shared" && (analyzed.mode !== mode || analyzed.text !== (mode === "feature" ? requirement : changedText));
  const scanning = scan.status !== "idle";
  const codebaseLabel =
    source.kind === "sample"
      ? `Sample: ${sample?.label ?? ""}`
      : source.kind === "folder"
        ? `Your folder: ${source.name}`
        : source.kind === "upload"
          ? `Saved map: ${source.name}`
          : `Shared result: ${source.name}`;
  const showChooser = chooserOpen || (!map && !scanning);

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
            <p>See what a change will touch, before anyone writes it.</p>
          </div>
        </div>
        <nav>
          <button className="ghost" onClick={() => setHelpOpen(true)}>
            Help
          </button>
          <button className="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </nav>
      </header>

      <main>
        {welcome && (
          <section className="welcome" aria-label="Getting started">
            <p>
              <b>New here?</b> A sample is loaded: go to step 2 and click <b>Map the impact</b>. Then use <b>Use your own code</b> in step
              1. Nothing is uploaded.
            </p>
            <div className="row">
              <button className="ghost" onClick={() => setHelpOpen(true)}>
                Open the 2-minute guide
              </button>
              <button className="link-button" onClick={dismissWelcome}>
                Don't show again
              </button>
            </div>
          </section>
        )}

        {/* Step 1: the code */}
        <Step
          n={1}
          title="Choose the code"
          aside={
            <InfoTip label="choosing the code">
              The tool maps a codebase it has read. <b>Choose a folder</b> reads a repository in your browser; nothing is uploaded, and
              Chrome or Edge skip node_modules so it takes seconds. <b>Open a saved map</b> loads a scan saved earlier or made by the
              command line.
            </InfoTip>
          }
        >
          {scanning ? (
            <div className="scan-progress" role="status">
              <span>
                {scan.status === "reading"
                  ? `Reading the folder… ${scan.found ? `${scan.found.toLocaleString()} source files so far` : ""}`
                  : `Reading ${scan.done.toLocaleString()} of ${scan.total.toLocaleString()} files, on this computer`}
              </span>
              {scan.status === "parsing" && <progress max={scan.total} value={scan.done} />}
            </div>
          ) : (
            map && (
              <div className="codebase-card">
                <div>
                  <b>{codebaseLabel}</b>
                  {source.kind === "shared" ? (
                    <p className="meta">Viewing a shared result. To map something new, choose the same code yourself.</p>
                  ) : (
                    <p className="meta">
                      {plural(map.files.length, "file")} ·{" "}
                      {Object.entries(map.languages)
                        .sort((a, b) => b[1] - a[1])
                        .map(([l]) => l)
                        .join(", ")}{" "}
                      · {linkCounts.import.toLocaleString()} imports, {linkCounts.http.toLocaleString()} frontend-to-API links
                    </p>
                  )}
                </div>
                <div className="row">
                  {source.kind === "folder" && (
                    <button
                      className="ghost"
                      onClick={saveMap}
                      title="Download this scan, so next time you can open it instead of scanning again"
                    >
                      Save map
                    </button>
                  )}
                  {!showChooser && (
                    <button className={source.kind === "sample" ? "primary" : "ghost"} onClick={() => setChooserOpen(true)}>
                      {source.kind === "sample" ? "Use your own code" : "Change"}
                    </button>
                  )}
                </div>
              </div>
            )
          )}

          {showChooser && !scanning && (
            <div className="options" role="group" aria-label="Where the code comes from">
              <div className="option">
                <h3>Choose a folder</h3>
                <p>Scan a repository on this computer. It is read in your browser and never uploaded.</p>
                <button className="primary" onClick={chooseFolder}>
                  Choose folder
                </button>
              </div>
              <div className="option">
                <h3>Open a saved map</h3>
                <p>A .json file from Save map, or from the command-line scan.</p>
                <button className="ghost" onClick={() => fileInput.current?.click()}>
                  Open map
                </button>
              </div>
              <div className="option">
                <h3>Try a sample</h3>
                <p>The same app with a React frontend and one of three backends.</p>
                <select
                  aria-label="Sample codebase"
                  value={sample?.id ?? ""}
                  onChange={(e) => e.target.value && chooseSample(e.target.value)}
                >
                  <option value="" disabled>
                    Pick a sample
                  </option>
                  {SAMPLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              {map && (
                <button className="link-button options-cancel" onClick={() => setChooserOpen(false)}>
                  Keep using {codebaseLabel}
                </button>
              )}
            </div>
          )}
          {mapError && (
            <p className="error" role="alert">
              {mapError}
            </p>
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
        </Step>

        {/* Step 2: the change */}
        <Step n={2} title="Describe the change">
          <div className="label-row">
            <div className="mode-switch" role="tablist" aria-label="What to map">
              <button
                role="tab"
                aria-selected={mode === "feature"}
                className={mode === "feature" ? "active" : ""}
                onClick={() => setMode("feature")}
              >
                A feature
              </button>
              <button
                role="tab"
                aria-selected={mode === "diff"}
                className={mode === "diff" ? "active" : ""}
                onClick={() => setMode("diff")}
              >
                Changed files
              </button>
            </div>
            <InfoTip label="feature or changed files">
              <b>A feature</b>: what someone wants built. The tool finds the files it is about from its words and any quoted UI text.{" "}
              <b>Changed files</b>: what a branch or pull request changed. The tool starts from those files and shows what they could break.
            </InfoTip>
            <button className="link-button ticket-toggle" onClick={() => setTicketOpen(!ticketOpen)} aria-expanded={ticketOpen}>
              {ticketOpen ? "Hide ticket import" : "Import from a ticket"}
            </button>
          </div>

          {ticketOpen && (
            <div className="ticket-row">
              <label htmlFor="ticket" className="sr-only">
                Ticket link or key
              </label>
              <input
                id="ticket"
                className="grow"
                value={ticketInput}
                onChange={(e) => setTicketInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && importTicket()}
                placeholder="Paste a GitHub issue or pull request, Jira or Plane link"
              />
              <button className="ghost" onClick={importTicket} disabled={busy === "ticket" || !ticketInput.trim()}>
                {busy === "ticket" ? "Importing…" : "Import"}
              </button>
              <InfoTip label="ticket import">
                The title and description become the requirement; a pull request also fills in its changed files. Private tickets, Jira and
                Plane need a token in Settings. A bare key like ABC-12 needs your Jira site or Plane workspace in Settings.
              </InfoTip>
            </div>
          )}

          <label htmlFor="req" className="sr-only">
            {mode === "feature" ? "The feature, in plain words" : "Changed file paths, one per line"}
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
                ? 'Describe the feature the way the ticket says it. Quote messages or labels from the screen, like "Assignee is required".'
                : "Paste the changed file paths, one per line, for example the output of: git diff --name-only origin/main...HEAD"
            }
          />
          {mode === "feature" && sample && (
            <div className="examples">
              <span>Examples:</span>
              {sample.examples.map((ex) => (
                <button key={ex} className="example" onClick={() => setRequirement(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}

          <div className="actions">
            <button className="primary big" onClick={run} disabled={!map || busy === "terms" || source.kind === "shared" || scanning}>
              {busy === "terms" ? "Finding related words…" : "Map the impact"}
            </button>
            <span className="hint keys">or press Ctrl + Enter</span>
            {mode === "feature" && (
              <span className="related">
                <label className="check">
                  <input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} /> Also search related words with
                  Claude
                </label>
                <InfoTip label="related words">
                  Claude suggests the words this codebase uses for the same things, for example <i>favorite</i> for "bookmark", picking only
                  words that exist in the code. Needs an Anthropic key in Settings, or the site's free allowance.
                </InfoTip>
              </span>
            )}
          </div>
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
        </Step>

        {/* Step 3: the impact */}
        {result && (
          <div ref={resultsRef} className="results-anchor">
            <Step
              n={3}
              title="The impact"
              aside={
                result.nodes.length > 0 && insights ? (
                  <div className="toolbar" role="toolbar" aria-label="Use this result">
                    <button className="ghost" onClick={() => setFrdOpen(!frdOpen)} aria-expanded={frdOpen} disabled={!map}>
                      {frdOpen ? "Hide FRD" : "Draft FRD"}
                    </button>
                    <button className="ghost" onClick={share} disabled={busy === "share"}>
                      Share link
                    </button>
                    {ticketRef && (
                      <button
                        className="ghost"
                        onClick={postBack}
                        disabled={busy === "post"}
                        title={`Add the impact map as a comment on ${ticketRef}`}
                      >
                        {busy === "post" ? "Posting…" : "Post to ticket"}
                      </button>
                    )}
                    <button className="ghost" onClick={copy}>
                      {copied ? "Copied" : "Copy as Markdown"}
                    </button>
                  </div>
                ) : undefined
              }
            >
              {result.nodes.length === 0 ? (
                <div className="empty">
                  <h3>Nothing in this codebase matched</h3>
                  {analyzed.mode === "diff" ? (
                    <p>None of the changed files are in this codebase. Check that step 1 has the same repository the files came from.</p>
                  ) : (
                    <>
                      <p>No file, endpoint, data name or UI text shares a word with the description. Try one of these:</p>
                      <ul>
                        <li>Use the names the product uses: "work order", not "job".</li>
                        <li>Quote a message or label from the screen.</li>
                        <li>Tick "Also search related words with Claude".</li>
                      </ul>
                    </>
                  )}
                </div>
              ) : (
                insights && (
                  <>
                    <div className="headline">
                      <p>
                        <b>
                          {analyzed.mode === "diff"
                            ? `${plural(result.stats.direct, "changed file")}`
                            : `${plural(result.stats.direct, "file")} directly involved`}
                          .
                        </b>{" "}
                        <span className="down-text">{result.stats.downstream} more could break</span>, and{" "}
                        <span className="up-text">{result.stats.upstream} are relied on</span>.
                        {result.stats.weak > 0 && (
                          <span className="muted"> {result.stats.weak} loosely linked files are counted but not listed.</span>
                        )}
                      </p>
                      <InfoTip label="this summary">
                        <b>Directly involved</b>: {RELATION_HELP.direct} <b>Could break</b>: {RELATION_HELP.downstream} <b>Relied on</b>:{" "}
                        {RELATION_HELP.upstream} <b>Loosely linked</b>: connected only through shared plumbing, such as an API client every
                        screen uses. Click any file to see why it is included.
                      </InfoTip>
                    </div>
                    {stale && (
                      <p className="warning" role="status">
                        This result is for the earlier input. Click <b>Map the impact</b> again to update it.
                      </p>
                    )}
                    {extraTerms.length > 0 && (
                      <p className="hint terms">
                        Also searched:{" "}
                        {extraTerms.map((t) => (
                          <span key={t} className="term">
                            {t}
                          </span>
                        ))}
                      </p>
                    )}
                    {result.unmatched?.length ? (
                      <p className="hint">
                        Not in this codebase (deleted, docs or unsupported): {result.unmatched.slice(0, 5).join(", ")}
                        {result.unmatched.length > 5 ? ` and ${result.unmatched.length - 5} more` : ""}
                      </p>
                    ) : null}
                    {resultNotice && (
                      <p className={resultNotice.error ? "error" : "notice"} role="status">
                        {resultNotice.text}{" "}
                        {resultNotice.error && /Settings/.test(resultNotice.text) && (
                          <button className="link-button" onClick={() => setSettingsOpen(true)}>
                            Open Settings
                          </button>
                        )}
                      </p>
                    )}

                    {frdOpen && map && (
                      <FrdPanel
                        draft={buildFrd(map, aiRequirement, result, insights)}
                        onAskClaude={async () => (await requestFrd(buildRequest(map, aiRequirement, result))).markdown}
                        onClose={() => setFrdOpen(false)}
                      />
                    )}

                    <div className="results">
                      <section className="sub-panel" aria-label="Files">
                        <FileList result={result} selected={selected} onSelect={setSelected} ai={ai} hot={hot} />
                      </section>
                      <section className="sub-panel graph-panel" aria-label="Map and file details">
                        {selectedNode && <NodeDetails node={selectedNode} file={byId.get(selectedNode.id)} ai={ai} words={result.words} />}
                        <ImpactGraph result={result} selected={selected} onSelect={setSelected} />
                      </section>
                    </div>
                  </>
                )
              )}
            </Step>

            {result.nodes.length > 0 && insights && (
              <Checklist
                insights={insights}
                ai={ai}
                canAsk={source.kind !== "shared"}
                onAsk={explain}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            )}
          </div>
        )}

        <footer className="foot">
          <button className="link-button" onClick={() => setHelpOpen(true)}>
            How it works and help
          </button>
          <span aria-hidden="true">·</span>
          <a href="/USER_GUIDE.md" target="_blank" rel="noreferrer">
            Full user guide
          </a>
        </footer>
      </main>

      {settingsOpen && <Settings onClose={closeSettings} />}
      {helpOpen && <Help onClose={closeHelp} />}
    </div>
  );
}
