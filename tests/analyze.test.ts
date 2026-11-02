import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze, tokenize } from "../shared/analyze.ts";
import type { SystemMap } from "../shared/map.ts";

const load = (name: string) => JSON.parse(readFileSync(`public/samples/${name}.json`, "utf8")) as SystemMap;

test("tokenizes identifiers and plain words the same way", () => {
  assert.deepEqual(tokenize("getUserEmail"), ["user", "email"]);
  assert.deepEqual(tokenize("user_emails"), ["user", "email"]);
  assert.deepEqual(tokenize("Let users edit comments"), ["let", "user", "edit", "comment"]);
});

test("finds the backend, frontend and permission code for a comments change (Spring Boot)", () => {
  const r = analyze(load("react-spring"), "Let users edit their own comments on an article.");
  const ids = r.nodes.map((n) => n.id);
  assert.ok(ids[0].endsWith("api/CommentsApi.java"), `top match was ${ids[0]}`);
  assert.ok(ids.some((id) => id.endsWith("components/Article/Comment.js")), "frontend comment screen");
  assert.ok(ids.some((id) => id.endsWith("AuthorizationService.java")), "authorization rule for 'their own'");
  assert.ok(ids.some((id) => id.endsWith("CommentsApiTest.java")), "existing tests");
});

test("links the React client to the Go router through the API (Gin)", () => {
  const map = load("react-golang");
  const http = map.edges.filter((e) => e.type === "http" && e.from.endsWith("src/agent.js")).map((e) => e.to);
  assert.ok(http.some((id) => id.endsWith("articles/routers.go")));
  assert.ok(http.some((id) => id.endsWith("users/routers.go")));
});

test("returns nothing, not noise, for a requirement unrelated to the code", () => {
  const r = analyze(load("react-django"), "Integrate the payroll export with the HR system.");
  assert.equal(r.nodes.length, 0);
});
