import { useState } from "react";

interface Props {
  /** The draft built from the graph. */
  draft: string;
  onAskClaude: () => Promise<string>;
  onClose: () => void;
}

export function FrdPanel({ draft, onAskClaude, onClose }: Props) {
  const [text, setText] = useState(draft);
  const [byClaude, setByClaude] = useState(false);
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const ask = async () => {
    setState("loading");
    setError("");
    try {
      setText(await onAskClaude());
      setByClaude(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setState("idle");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "frd-draft.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel frd" aria-label="FRD draft">
      <div className="checklist-head">
        <h2>FRD draft</h2>
        <div className="ai-box">
          <span className="hint">{byClaude ? "Written by Claude from the graph." : "Built from the code graph. Edit it here before you share it."}</span>
          <button className="primary" onClick={ask} disabled={state === "loading"}>
            {state === "loading" ? "Writing…" : byClaude ? "Write again" : "Write with Claude"}
          </button>
          <button
            className="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(text).catch(() => setError("The browser blocked copying to the clipboard."));
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="ghost" onClick={download}>
            Download .md
          </button>
          <button className="ghost" onClick={onClose} aria-label="Close the FRD draft">
            Close
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <textarea className="frd-text" value={text} onChange={(e) => setText(e.target.value)} rows={24} spellCheck />
    </section>
  );
}
