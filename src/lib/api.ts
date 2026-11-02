import type { Analysis } from "../../shared/ai.ts";
import type { AnalysisRequest } from "../../shared/request.ts";

const KEY_STORAGE = "impact-mapper.anthropic-key";

// The visitor's own key lives in this tab only (sessionStorage) and is sent
// with each request; the server never stores it.
export function getUserKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setUserKey(key: string) {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked: the key just won't survive a reload.
  }
}

export async function requestExplanation(req: AnalysisRequest): Promise<Analysis> {
  const key = getUserKey();
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-anthropic-key": key } : {}) },
    body: JSON.stringify(req),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The request failed (${res.status}).`);
  return body.analysis as Analysis;
}
