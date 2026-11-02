// A functional requirement document (FRD) draft built from the graph alone,
// with the same sections Claude's version uses. It lists what the code says;
// the parts only a person can decide are left as open questions.

import { describeStep, type ImpactNode, type ImpactResult } from "./analyze.ts";
import type { Insights } from "./insights.ts";
import type { SystemMap } from "./map.ts";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const short = (id: string) => id.replace(/^(table|event):/, "").split("/").slice(-2).join("/");

function why(n: ImpactNode): string {
  if (n.relation === "direct") return n.matched.includes("changed") ? "changed" : `mentions ${n.matched.join(", ")}`;
  return n.path.map(describeStep).join(" → ");
}

export function buildFrd(map: SystemMap, requirement: string, result: ImpactResult, insights: Insights): string {
  const byId = new Map(map.files.map((f) => [f.id, f]));
  const area = (a: string) => result.byArea[a as keyof typeof result.byArea] ?? [];
  const changed = result.nodes.filter((n) => n.matched.includes("changed"));
  const firstLine = changed.length
    ? `Change to ${short(changed[0].id)}${changed.length > 1 ? ` and ${changed.length - 1} more file${changed.length > 2 ? "s" : ""}` : ""}`
    : requirement.split(/\n|\. /)[0].trim().slice(0, 90);
  const out: string[] = [`# FRD: ${firstLine || "Feature"}`, "", `_Draft generated from the code graph of ${map.name}. Review every section before use._`, ""];

  out.push("## 1. Overview", "", requirement.trim(), "");

  const direct = result.nodes.filter((n) => n.relation === "direct" && n.kind === "file");
  out.push("## 2. Scope", "", "**In scope** (code the requirement is about):", "");
  for (const n of direct.slice(0, 12)) out.push(`- \`${n.id}\``);
  out.push("", "**Out of scope:** _to be decided — see Open questions._", "");

  out.push("## 3. Affected areas", "", "| Area | File | Relation | Why |", "|---|---|---|---|");
  for (const n of result.nodes.filter((x) => x.area !== "Tests")) {
    out.push(`| ${n.area} | \`${cell(short(n.id))}\` | ${n.relation} | ${cell(why(n))} |`);
  }
  out.push("");

  out.push("## 4. Functional requirements", "");
  const screens = area("Screens").filter((n) => n.relation === "direct");
  const apis = area("APIs").filter((n) => n.relation === "direct");
  let fr = 1;
  for (const s of screens.slice(0, 4)) out.push(`- **FR-${fr++}** ${short(s.id)}: _describe what the user sees and does here._`);
  for (const a of apis.slice(0, 4)) {
    const routes = byId.get(a.id)?.routes.filter((r) => r.role === "serves").map((r) => `${r.method ?? ""} ${r.path}`.trim()) ?? [];
    out.push(`- **FR-${fr++}** ${short(a.id)}${routes.length ? ` (${routes.slice(0, 3).join(", ")})` : ""}: _describe the request, the response and the validation._`);
  }
  if (fr === 1) out.push("- **FR-1** _No screen or endpoint matched directly; describe the expected behaviour._");
  out.push("");

  const data = area("Data");
  out.push("## 5. Data changes", "");
  if (data.length) {
    for (const n of data.slice(0, 10)) out.push(`- \`${short(n.id)}\` (${n.relation}): _new or changed fields, and what happens to existing records._`);
  } else out.push("Does not apply: no data store is linked to this change.");
  out.push("");

  const perms = area("Permissions");
  out.push("## 6. Permissions", "");
  if (perms.length) for (const n of perms.slice(0, 6)) out.push(`- Access is decided in \`${short(n.id)}\`. _Say which roles may use the new behaviour._`);
  else out.push("No access-control code is linked. _Say who may use this, and where it is enforced._");
  out.push("");

  const notify = area("Notifications");
  out.push("## 7. Notifications", "");
  if (notify.length) for (const n of notify.slice(0, 6)) out.push(`- \`${short(n.id)}\`: _should this change send or alter a message?_`);
  else out.push("Does not apply: no notification code is linked.");
  out.push("");

  out.push("## 8. Edge cases", "", ...insights.edgeCases.map((i) => `- ${i.text}`), "");
  out.push("## 9. Open questions", "", ...insights.gapQuestions.map((i) => `- ${i.text}`), "");

  out.push("## 10. Test plan", "");
  insights.testCases.forEach((t, i) => {
    out.push(`**TC-${i + 1}: ${t.title}**`, "", ...t.steps.map((s, j) => `${j + 1}. ${s}`), "", `Expected: ${t.expected}`, "");
  });

  out.push("## 11. Risks and rollout", "", ...insights.risks.map((i) => `- ${i.text}`), "");
  return out.join("\n");
}
