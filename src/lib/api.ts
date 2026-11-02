import type { Analysis } from "../../shared/ai.ts";
import type { AnalysisRequest } from "../../shared/request.ts";

// What the visitor enters in Settings. It lives in this tab only
// (sessionStorage) and goes to our API with each request; the server never
// stores it.
export interface Credentials {
  anthropicKey: string;
  githubToken: string;
  jiraSite: string;
  jiraEmail: string;
  jiraToken: string;
  planeWorkspace: string;
  planeKey: string;
  planeBase: string;
}

const STORAGE = "impact-mapper.credentials";
export const EMPTY_CREDENTIALS: Credentials = {
  anthropicKey: "",
  githubToken: "",
  jiraSite: "",
  jiraEmail: "",
  jiraToken: "",
  planeWorkspace: "",
  planeKey: "",
  planeBase: "",
};

export function getCredentials(): Credentials {
  try {
    return { ...EMPTY_CREDENTIALS, ...JSON.parse(sessionStorage.getItem(STORAGE) ?? "{}") };
  } catch {
    return { ...EMPTY_CREDENTIALS };
  }
}

export function setCredentials(c: Credentials) {
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(c));
  } catch {
    // Storage blocked: the settings just won't survive a reload.
  }
}

function headers(): Record<string, string> {
  const c = getCredentials();
  const h: Record<string, string> = { "content-type": "application/json" };
  if (c.anthropicKey) h["x-anthropic-key"] = c.anthropicKey;
  if (c.githubToken) h["x-github-token"] = c.githubToken;
  if (c.jiraEmail) h["x-jira-email"] = c.jiraEmail;
  if (c.jiraToken) h["x-jira-token"] = c.jiraToken;
  if (c.planeKey) h["x-plane-key"] = c.planeKey;
  return h;
}

async function post<T>(route: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${route}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `The request failed (${res.status}).`);
  return json as T;
}

export const requestExplanation = async (req: AnalysisRequest) => (await post<{ analysis: Analysis }>("analyze", req)).analysis;

export const requestFrd = async (req: AnalysisRequest) => (await post<{ frd: { title: string; markdown: string } }>("frd", req)).frd;

export const requestTerms = async (requirement: string, vocabulary: string[]) =>
  (await post<{ terms: string[] }>("expand", { requirement, vocabulary })).terms;

export interface Ticket {
  source: "github" | "jira" | "plane";
  title: string;
  body: string;
  url: string;
  files?: string[];
}

const ticketContext = () => {
  const c = getCredentials();
  return { jiraSite: c.jiraSite || undefined, planeWorkspace: c.planeWorkspace || undefined, planeBase: c.planeBase || undefined };
};

export const fetchTicket = async (ref: string) =>
  (await post<{ ticket: Ticket }>("ticket", { action: "fetch", ref, ...ticketContext() })).ticket;

export const postToTicket = async (ref: string, comment: string) =>
  (await post<{ posted: string }>("ticket", { action: "comment", ref, comment, ...ticketContext() })).posted;
