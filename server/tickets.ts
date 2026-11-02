// POST /api/ticket: read a ticket (or a pull request's changed files) from
// GitHub, Jira or Plane, or post the impact map back as a comment. Tokens come
// from the visitor's own settings in request headers and are never stored.
// Requests only go to the services' own hosts, never to an arbitrary URL.

import type { HandlerResult } from "./handler.ts";

export interface TicketRequest {
  action: "fetch" | "comment";
  /** A GitHub issue or PR URL, a Jira issue URL or key, or a Plane work-item URL or key. */
  ref: string;
  comment?: string;
  /** Jira site when `ref` is a bare key: "acme" or "acme.atlassian.net". */
  jiraSite?: string;
  /** Plane workspace slug when `ref` is a bare key, and the API base for self-hosted Plane. */
  planeWorkspace?: string;
  planeBase?: string;
}

export interface Ticket {
  source: "github" | "jira" | "plane";
  title: string;
  body: string;
  url: string;
  /** Pull requests only: the files they change. */
  files?: string[];
}

const fail = (status: number, error: string): HandlerResult => ({ status, body: { error } });

class TicketError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call(url: string, init: RequestInit, service: string): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new TicketError(401, `${service} refused the request. Check the token in Settings, and that it can read this ticket.`);
  if (res.status === 404) throw new TicketError(404, `${service} could not find that ticket. Check the link, or whether it is private and needs a token.`);
  if (!res.ok) throw new TicketError(502, `${service} returned an error (${res.status}).`);
  return res.status === 204 ? {} : res.json();
}

// --- GitHub -------------------------------------------------------------------

const GITHUB_REF = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/;

async function github(req: TicketRequest, headers: Headers, m: RegExpExecArray): Promise<HandlerResult> {
  const [, owner, repo, kind, num] = m;
  const token = headers.get("x-github-token")?.trim();
  const h: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "impact-mapper" };
  if (token) h.authorization = `Bearer ${token}`;
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  if (req.action === "comment") {
    if (!token) return fail(401, "Posting to GitHub needs a GitHub token in Settings.");
    const out = (await call(`${api}/issues/${num}/comments`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ body: req.comment }) }, "GitHub")) as { html_url?: string };
    return { status: 200, body: { posted: out.html_url ?? m[0] } };
  }

  const issue = (await call(`${api}/issues/${num}`, { headers: h }, "GitHub")) as { title: string; body: string | null; html_url: string };
  const ticket: Ticket = { source: "github", title: issue.title, body: issue.body ?? "", url: issue.html_url };
  if (kind === "pull") {
    const files: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = (await call(`${api}/pulls/${num}/files?per_page=100&page=${page}`, { headers: h }, "GitHub")) as { filename: string; status: string }[];
      files.push(...batch.filter((f) => f.status !== "removed").map((f) => f.filename));
      if (batch.length < 100) break;
    }
    ticket.files = files;
  }
  return { status: 200, body: { ticket } };
}

// --- Jira ---------------------------------------------------------------------

const JIRA_URL = /^https:\/\/([a-z0-9-]+\.atlassian\.net)\/browse\/([A-Z][A-Z0-9_]+-\d+)/i;
const ISSUE_KEY = /^([A-Z][A-Z0-9_]+-\d+)$/i;

/** Jira's description is a document tree (ADF); this flattens it to text. */
function adfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  const inner = (n.content ?? []).map(adfText).join("");
  return ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(n.type ?? "") ? `${inner}\n` : inner;
}

function toAdf(markdown: string) {
  const paragraphs = markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 200);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.slice(0, 30_000) }] })),
  };
}

async function jira(req: TicketRequest, headers: Headers, host: string, key: string): Promise<HandlerResult> {
  if (!/^[a-z0-9-]+\.atlassian\.net$/i.test(host)) return fail(400, "Only Jira Cloud sites (name.atlassian.net) are supported.");
  const email = headers.get("x-jira-email")?.trim();
  const token = headers.get("x-jira-token")?.trim();
  if (!email || !token) return fail(401, "Jira needs your email and an API token in Settings.");
  const h = { accept: "application/json", authorization: `Basic ${btoa(`${email}:${token}`)}` };
  const api = `https://${host}/rest/api/3/issue/${encodeURIComponent(key)}`;

  if (req.action === "comment") {
    await call(`${api}/comment`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ body: toAdf(req.comment ?? "") }) }, "Jira");
    return { status: 200, body: { posted: `https://${host}/browse/${key}` } };
  }
  const issue = (await call(`${api}?fields=summary,description`, { headers: h }, "Jira")) as { fields: { summary: string; description: unknown } };
  const ticket: Ticket = { source: "jira", title: issue.fields.summary, body: adfText(issue.fields.description).trim(), url: `https://${host}/browse/${key}` };
  return { status: 200, body: { ticket } };
}

// --- Plane --------------------------------------------------------------------

const PLANE_URL = /^https:\/\/([\w.-]+)\/([\w-]+)\/browse\/([A-Z][A-Z0-9]*-\d+)/i;

/** https only, and never a private address: the base is user-supplied for self-hosted Plane. */
function safeBase(base: string): string | undefined {
  try {
    const u = new URL(base);
    const host = u.hostname;
    const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[?::1\]?$)/i.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    return u.protocol === "https:" && !privateHost ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

async function plane(req: TicketRequest, headers: Headers, workspace: string, key: string, baseInput?: string): Promise<HandlerResult> {
  const base = safeBase(baseInput || "https://api.plane.so");
  if (!base) return fail(400, "The Plane API address must be an https address on the internet.");
  const apiKey = headers.get("x-plane-key")?.trim();
  if (!apiKey) return fail(401, "Plane needs an API key in Settings.");
  const h = { accept: "application/json", "x-api-key": apiKey };
  const ws = encodeURIComponent(workspace);

  // Newer Plane calls them work items, older versions issues.
  let item: { id: string; project: string; name: string; description_stripped?: string; description_html?: string } | undefined;
  let lastError: unknown;
  for (const path of [`work-items/${key}`, `issues/${key}`]) {
    try {
      item = (await call(`${base}/api/v1/workspaces/${ws}/${path}/`, { headers: h }, "Plane")) as typeof item;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!item) throw lastError;

  if (req.action === "comment") {
    const html = `<pre>${(req.comment ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
    await call(
      `${base}/api/v1/workspaces/${ws}/projects/${item.project}/issues/${item.id}/comments/`,
      { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ comment_html: html }) },
      "Plane",
    );
    return { status: 200, body: { posted: key } };
  }
  const body = item.description_stripped ?? htmlToText(item.description_html ?? "");
  const ticket: Ticket = { source: "plane", title: item.name, body, url: `${key}` };
  return { status: 200, body: { ticket } };
}

// ------------------------------------------------------------------------------

export async function handleTicket(input: unknown, headers: Headers): Promise<HandlerResult> {
  const req = input as TicketRequest;
  const ref = String(req?.ref ?? "").trim();
  if (!ref) return fail(400, "Paste a ticket link or key.");
  if (req.action === "comment" && !req.comment?.trim()) return fail(400, "There is nothing to post.");
  if (req.action !== "fetch" && req.action !== "comment") return fail(400, "Unknown ticket action.");

  try {
    const gh = GITHUB_REF.exec(ref);
    if (gh) return await github(req, headers, gh);
    const jiraUrl = JIRA_URL.exec(ref);
    if (jiraUrl) return await jira(req, headers, jiraUrl[1], jiraUrl[2].toUpperCase());
    const planeUrl = PLANE_URL.exec(ref);
    if (planeUrl && !planeUrl[1].endsWith("atlassian.net") && planeUrl[1] !== "github.com") {
      return await plane(req, headers, planeUrl[2], planeUrl[3].toUpperCase(), req.planeBase);
    }
    if (ISSUE_KEY.test(ref)) {
      if (req.jiraSite) return await jira(req, headers, req.jiraSite.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^([a-z0-9-]+)$/i, "$1.atlassian.net"), ref.toUpperCase());
      if (req.planeWorkspace) return await plane(req, headers, req.planeWorkspace, ref.toUpperCase(), req.planeBase);
      return fail(400, "For a bare key like ABC-123, set your Jira site or Plane workspace in Settings, or paste the full link.");
    }
    return fail(400, "That doesn't look like a GitHub, Jira or Plane ticket link.");
  } catch (e) {
    if (e instanceof TicketError) return fail(e.status, e.message);
    return fail(502, "The ticket service could not be reached.");
  }
}
