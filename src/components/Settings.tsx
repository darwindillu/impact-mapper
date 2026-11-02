import { useEffect, useRef, useState } from "react";
import { getCredentials, setCredentials, type Credentials } from "../lib/api.ts";

const FIELDS: { section: string; hint: string; items: { key: keyof Credentials; label: string; secret?: boolean; placeholder?: string }[] }[] = [
  {
    section: "Claude",
    hint: 'For "Explain with Claude", the FRD draft and related words. Without a key, the site\'s free demo allows a few a day.',
    items: [{ key: "anthropicKey", label: "Anthropic API key", secret: true, placeholder: "sk-ant-…" }],
  },
  {
    section: "GitHub",
    hint: "Public issues and pull requests need no token. A token is needed for private repositories and to post comments.",
    items: [{ key: "githubToken", label: "Personal access token", secret: true, placeholder: "github_pat_…" }],
  },
  {
    section: "Jira Cloud",
    hint: "An API token from id.atlassian.com, with the email you sign in with.",
    items: [
      { key: "jiraSite", label: "Site", placeholder: "yourcompany.atlassian.net" },
      { key: "jiraEmail", label: "Email" },
      { key: "jiraToken", label: "API token", secret: true },
    ],
  },
  {
    section: "Plane",
    hint: "An API key from Plane's workspace settings. Leave the address empty for Plane Cloud.",
    items: [
      { key: "planeWorkspace", label: "Workspace slug", placeholder: "my-team" },
      { key: "planeKey", label: "API key", secret: true },
      { key: "planeBase", label: "API address (self-hosted only)", placeholder: "https://plane.example.com" },
    ],
  },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<Credentials>(getCredentials());
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
      <p className="hint">
        Everything here stays in this browser tab until you close it, and is sent only with the requests that need it. Nothing is stored on the
        server.
      </p>
      {FIELDS.map((group) => (
        <fieldset key={group.section}>
          <legend>{group.section}</legend>
          {group.items.map((f) => (
            <label key={f.key} className="setting">
              <span>{f.label}</span>
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key]}
                placeholder={f.placeholder}
                autoComplete="off"
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </label>
          ))}
          <p className="hint">{group.hint}</p>
        </fieldset>
      ))}
      <div className="row end">
        <button className="ghost" onClick={() => dialog.current?.close()}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={() => {
            setCredentials(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])) as unknown as Credentials);
            dialog.current?.close();
          }}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
