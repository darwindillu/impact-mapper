import { useState } from "react";
import type { Analysis } from "../../shared/ai.ts";
import type { Insights } from "../../shared/insights.ts";
import { InfoTip } from "./InfoTip.tsx";

type Tab = "gaps" | "edges" | "tests" | "risks";

interface Props {
  insights: Insights;
  ai?: Analysis;
  /** False for a shared result, which is read-only. */
  canAsk: boolean;
  onAsk: () => Promise<void>;
  onOpenSettings: () => void;
}

/** "Before you build": open questions, edge cases, test cases and risks. */
export function Checklist({ insights, ai, canAsk, onAsk, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("gaps");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState("");

  const ask = async () => {
    setState("loading");
    setError("");
    try {
      await onAsk();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setState("idle");
    }
  };

  const tabs: [Tab, string, number][] = [
    ["gaps", "Open questions", ai?.gapQuestions.length ?? insights.gapQuestions.length],
    ["edges", "Edge cases", ai?.edgeCases.length ?? insights.edgeCases.length],
    ["tests", "Test cases", ai?.testCases.length ?? insights.testCases.length],
    ["risks", "Risks", ai?.risks.length ?? insights.risks.length],
  ];

  return (
    <section className="panel checklist" aria-labelledby="checklist-title">
      <div className="checklist-head">
        <div className="label-row">
          <h2 id="checklist-title">Before you build</h2>
          <InfoTip label="Before you build">
            Questions the description leaves open, edge cases, test cases and risks, each based on what the map found. Without Claude they come
            from rules; <b>Explain with Claude</b> rewrites them for this change and marks each file must change, may change or verify only.
          </InfoTip>
        </div>
        {canAsk && (
          <div className="ai-box">
            <span className="hint">{ai ? "Written by Claude from the map above." : "From the code map. Claude can tailor it to this change."}</span>
            <button className="primary" onClick={ask} disabled={state === "loading"}>
              {state === "loading" ? "Asking Claude…" : ai ? "Ask again" : "Explain with Claude"}
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          {/Settings/.test(error) && (
            <button className="link-button" onClick={onOpenSettings}>
              Open Settings
            </button>
          )}
        </p>
      )}
      {ai && <p className="ai-summary">{ai.summary}</p>}
      <div className="tabs" role="tablist" aria-label="Checklist">
        {tabs.map(([id, label, count]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label} <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel">
        {tab === "gaps" && <Items items={ai ? ai.gapQuestions : insights.gapQuestions.map((i) => i.text)} />}
        {tab === "edges" && <Items items={ai ? ai.edgeCases : insights.edgeCases.map((i) => i.text)} />}
        {tab === "risks" && <Items items={ai ? ai.risks.map((r) => `${r.risk} Mitigation: ${r.mitigation}`) : insights.risks.map((i) => i.text)} />}
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
  );
}

function Items({ items }: { items: string[] }) {
  if (!items.length) return <p className="hint">Nothing here for this change.</p>;
  return (
    <ul className="items">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}
