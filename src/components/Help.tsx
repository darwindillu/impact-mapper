import { useEffect, useRef } from "react";

// The in-app guide: enough to get anyone started and unstuck. The full guide
// (setup, tokens, CLI, hosting) is docs/USER_GUIDE.md, served at /USER_GUIDE.md.

const TROUBLE: [string, string][] = [
  ["Codebase only shows samples", "A browser can't see your disk until you pick a folder. Click Choose folder, or Upload map if you have a saved scan."],
  ["\"No source files found\"", "Pick the repository's root folder, not a subfolder like docs. Supported: TypeScript, JavaScript, Python, Java, Kotlin, Scala, Go, Rust, C#, PHP, Ruby, Vue, Svelte."],
  ["The scan stays on \"Reading the folder…\"", "The browser is listing a very large folder. Use Chrome or Edge, which skip node_modules, or scan with the command line and upload the map."],
  ["\"Nothing in this codebase matched\"", "No word of the requirement appears in the code. Use the product's own names, quote a message or label from the screen, or tick Also search related words."],
  ["A file I expected is missing", "It may use other words than the requirement. Name its screen or module, quote its UI text, tick Also search related words, or map the changed files if the change exists."],
  ["An unrelated file is listed", "Click it: the panel says exactly which words matched or which link brought it in. Files reached only through an import are usually low risk."],
  ["\"AI is not set up\" or \"key was rejected\"", "Claude features need an Anthropic API key. Add yours in Settings → Claude; ask your team if the company provides one."],
  ["\"The free demo allows N a day\"", "You used today's allowance on the site's key. Add your own key in Settings, or try again tomorrow."],
  ["A ticket won't import", "Check the link. Private GitHub repos, Jira and Plane need a token in Settings; a bare key like ABC-12 also needs the Jira site or Plane workspace."],
  ["\"Post to ticket\" fails", "Posting needs a token that may comment: on GitHub, Issues read and write."],
  ["No \"often fixed\" flags", "They need git history, which only the command-line scan reads."],
  ["A share link opens the start page", "The link was cut off. Copy it again and paste it whole."],
];

export function Help({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal(); // StrictMode runs this twice in dev
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [onClose]);

  return (
    <dialog ref={dialog} className="help" aria-labelledby="help-title">
      <div className="help-head">
        <h2 id="help-title">Help</h2>
        <button className="ghost" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>

      <h3>Get started in two minutes</h3>
      <ol>
        <li>
          Click <b>Map the impact</b> on the sample to see what a result looks like.
        </li>
        <li>
          Load your code: <b>Choose folder</b> and pick the repository (use Chrome or Edge). Nothing is uploaded; the files are read in your
          browser. <b>Save map</b> keeps the scan for next time.
        </li>
        <li>
          Paste a requirement, the way the ticket says it, or switch to <b>Changed files</b> and paste <code>git diff --name-only</code> output.
        </li>
        <li>Click a file to see why it is included. Use the tabs under Before you build, then Copy as Markdown or Draft FRD.</li>
      </ol>

      <h3>Reading the result</h3>
      <dl className="help-terms">
        <dt>Directly involved</dt>
        <dd>What the description is about, or the files the branch changed.</dd>
        <dt>Could break</dt>
        <dd>Depends on a directly involved file (imports it, calls its API, uses its data), so the change can break it.</dd>
        <dt>Relied on</dt>
        <dd>A directly involved file depends on it. It usually stays as it is, but the feature may need something new from it.</dd>
        <dt>Loosely linked</dt>
        <dd>Connected only through shared plumbing, such as an API client every screen uses. Counted, not listed.</dd>
        <dt>Often fixed</dt>
        <dd>Needed many bug fixes in the last 12 months (command-line scans only). Review it carefully.</dd>
      </dl>
      <p className="hint">
        Every listed link is real: an import, a matching route, a shared table or field. The tool can still miss files that use other words or
        connect only at run time, so treat the result as a strong starting point.
      </p>

      <h3>Better results</h3>
      <ul>
        <li>Use the product's names: "work order", not "job".</li>
        <li>
          Quote messages and labels from the screen, like <code>"Assignee is required"</code>: the tool searches the app's own text.
        </li>
        <li>Name the screen or module if you know it.</li>
        <li>Tick Also search related words when the code may use different names (needs Claude).</li>
      </ul>

      <h3>What leaves your computer</h3>
      <ul>
        <li>Scanning, mapping, the checklist, the FRD draft and Markdown: nothing.</li>
        <li>Claude features: the requirement and the found files' names, routes and links, never source code.</li>
        <li>Tickets: the link and your token go to that service, through the app's server.</li>
        <li>Keys and tokens in Settings stay in this browser tab and are forgotten when you close it.</li>
      </ul>

      <h3>Something not working?</h3>
      <div className="trouble">
        {TROUBLE.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>

      <p className="hint">
        The <a href="/USER_GUIDE.md" target="_blank" rel="noreferrer">full guide</a> covers every feature, getting GitHub, Jira and Plane tokens,
        the command line, the GitHub Action, VS Code, and hosting the tool for a team.
      </p>
    </dialog>
  );
}
