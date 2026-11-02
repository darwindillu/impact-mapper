// POST /api/analyze, shared by the Vercel function and the Vite dev server.
// Uses the visitor's own Anthropic key when they give one (sent per request,
// never stored), else the site's key with a small per-IP daily quota.

import { APIError } from "@anthropic-ai/sdk";
import { explain, type AnalysisRequest } from "../shared/ai.ts";

const DEMO_PER_DAY = Number(process.env.DEMO_REQUESTS_PER_DAY ?? 5);
const MAX_BODY = 200_000;

// Per instance and best effort: enough to stop a casual loop, not an attacker.
// The real cap is the monthly spend limit on the site's key.
const used = new Map<string, { day: string; count: number }>();

function takeQuota(ip: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const entry = used.get(ip);
  if (!entry || entry.day !== day) {
    used.set(ip, { day, count: 1 });
    return true;
  }
  if (entry.count >= DEMO_PER_DAY) return false;
  entry.count++;
  return true;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function handleAnalyze(rawBody: string, headers: Headers, ip: string): Promise<HandlerResult> {
  if (rawBody.length > MAX_BODY) return { status: 413, body: { error: "The request is too large." } };
  let req: AnalysisRequest;
  try {
    req = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "The request is not valid JSON." } };
  }

  const userKey = headers.get("x-anthropic-key")?.trim();
  const siteKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = userKey || siteKey;
  if (!apiKey) {
    return { status: 503, body: { error: "AI explanations are not set up on this site. Add your own Anthropic API key in Settings." } };
  }
  if (!userKey && !takeQuota(ip)) {
    return {
      status: 429,
      body: { error: `The free demo allows ${DEMO_PER_DAY} AI explanations a day. Add your own Anthropic API key in Settings to keep going.` },
    };
  }

  try {
    return { status: 200, body: { analysis: await explain(apiKey, req), usedOwnKey: Boolean(userKey) } };
  } catch (e) {
    if (e instanceof APIError) {
      if (e.status === 401) return { status: 401, body: { error: "That Anthropic API key was rejected. Check it in Settings." } };
      if (e.status === 429) return { status: 429, body: { error: "Claude is rate-limiting this key right now. Wait a minute and try again." } };
      return { status: 502, body: { error: `Claude returned an error (${e.status}). Try again in a moment.` } };
    }
    // Validation errors from explain() are meant for the user.
    return { status: 400, body: { error: e instanceof Error ? e.message : "The analysis failed." } };
  }
}
