// The API, shared by the Vercel functions and the Vite dev server:
//   POST /api/analyze  Claude's explanation of an impact map
//   POST /api/frd      Claude's FRD draft
//   POST /api/expand   related words the codebase uses (synonyms)
//   POST /api/ticket   fetch a ticket from GitHub, Jira or Plane, or comment on it
// Uses the visitor's own Anthropic key when they give one (sent per request,
// never stored), else the site's key with a small per-IP daily quota.

import { APIError } from "@anthropic-ai/sdk";
import { draftFrd, expandTerms, explain } from "../shared/ai.js";
import type { AnalysisRequest } from "../shared/request.js";
import { handleTicket } from "./tickets.js";

const DEMO_PER_DAY = Number(process.env.DEMO_REQUESTS_PER_DAY ?? 5);
const MAX_BODY = 200_000;

// Per instance and best effort: enough to stop a casual loop, not an attacker.
// The real cap is the monthly spend limit on the site's key. Synonyms are
// cheap (Haiku), so they get a larger, separate allowance.
const used = new Map<string, { day: string; count: number }>();

function takeQuota(key: string, limit: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const entry = used.get(key);
  if (!entry || entry.day !== day) {
    used.set(key, { day, count: 1 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

const fail = (status: number, error: string): HandlerResult => ({ status, body: { error } });

export async function handleApi(route: string, rawBody: string, headers: Headers, ip: string): Promise<HandlerResult> {
  if (rawBody.length > MAX_BODY) return fail(413, "The request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, "The request is not valid JSON.");
  }

  if (route === "ticket") return handleTicket(body, headers);
  if (!["analyze", "frd", "expand"].includes(route)) return fail(404, "Unknown endpoint.");

  const userKey = headers.get("x-anthropic-key")?.trim();
  const siteKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = userKey || siteKey;
  if (!apiKey) return fail(503, "AI is not set up on this site. Add your own Anthropic API key in Settings.");
  if (!userKey) {
    const limit = route === "expand" ? DEMO_PER_DAY * 4 : DEMO_PER_DAY;
    if (!takeQuota(`${route === "expand" ? "expand" : "ai"}:${ip}`, limit)) {
      return fail(429, `The free demo allows ${limit} of these a day. Add your own Anthropic API key in Settings to keep going.`);
    }
  }

  try {
    if (route === "analyze") return { status: 200, body: { analysis: await explain(apiKey, body as AnalysisRequest) } };
    if (route === "frd") return { status: 200, body: { frd: await draftFrd(apiKey, body as AnalysisRequest) } };
    const { requirement, vocabulary } = body as { requirement: string; vocabulary: string[] };
    if (!Array.isArray(vocabulary)) return fail(400, "The vocabulary is missing.");
    return { status: 200, body: { terms: await expandTerms(apiKey, String(requirement ?? ""), vocabulary.map(String)) } };
  } catch (e) {
    if (e instanceof APIError) {
      if (e.status === 401) return fail(401, "That Anthropic API key was rejected. Check it in Settings.");
      if (e.status === 429) return fail(429, "Claude is rate-limiting this key right now. Wait a minute and try again.");
      return fail(502, `Claude returned an error (${e.status}). Try again in a moment.`);
    }
    // Validation errors from shared/ai.ts are meant for the user.
    return fail(400, e instanceof Error ? e.message : "The request failed.");
  }
}
