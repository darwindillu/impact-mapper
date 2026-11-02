import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyze, matchPaths } from "../shared/analyze.ts";
import { buildFrd } from "../shared/frd.ts";
import { buildInsights } from "../shared/insights.ts";
import type { SystemMap } from "../shared/map.ts";
import { vocabulary } from "../shared/vocabulary.ts";
import { handleTicket } from "../server/tickets.ts";

const spring = JSON.parse(readFileSync("public/samples/react-spring.json", "utf8")) as SystemMap;

test("diff mode starts from changed files, whatever root git printed them from", () => {
  const { ids, unmatched } = matchPaths(spring, ["src/main/java/io/spring/api/CommentsApi.java", "README.md"]);
  assert.deepEqual(ids, ["spring-boot-realworld-example-app/src/main/java/io/spring/api/CommentsApi.java"]);
  assert.deepEqual(unmatched, ["README.md"]);
  const r = analyze(spring, "", { changedFiles: ["src/main/java/io/spring/api/CommentsApi.java"] });
  assert.equal(r.stats.direct, 1);
  assert.ok(r.nodes.some((n) => n.id.endsWith("src/agent.js") && n.relation === "downstream"), "the React client that calls it");
});

test("the FRD draft has every section and lists the affected files", () => {
  const req = "Let users edit their own comments on an article.";
  const r = analyze(spring, req);
  const frd = buildFrd(spring, req, r, buildInsights(spring, r));
  const sections = frd.match(/^## .*/gm) ?? [];
  assert.equal(sections.length, 11);
  assert.ok(frd.includes("CommentsApi.java"));
});

test("the vocabulary holds concept words, not plumbing", () => {
  const v = vocabulary(spring);
  assert.ok(v.includes("comment") && v.includes("articl"));
  assert.ok(!v.includes("index"));
});

test("ticket references are checked before any request is made", async () => {
  const none = await handleTicket({ action: "fetch", ref: "https://example.com/x" }, new Headers());
  assert.equal(none.status, 400);
  const bareKey = await handleTicket({ action: "fetch", ref: "ABC-12" }, new Headers());
  assert.match(String((bareKey.body as { error: string }).error), /Jira site or Plane workspace/);
  const selfHosted = await handleTicket({ action: "fetch", ref: "ABC-12", planeWorkspace: "w", planeBase: "https://10.0.0.5" }, new Headers({ "x-plane-key": "k" }));
  assert.equal(selfHosted.status, 400, "private addresses are refused");
  const jira = await handleTicket({ action: "fetch", ref: "https://evil.example.com/browse/ABC-1" }, new Headers());
  assert.equal(jira.status, 400);
});
