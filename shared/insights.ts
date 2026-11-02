// Checklists built from the graph alone, so the tool is useful with no AI key.
// Each item names the files that prompted it.

import type { ImpactNode, ImpactResult } from "./analyze.ts";
import { describeStep } from "./analyze.ts";
import type { SystemMap } from "./map.ts";

export interface Insight {
  text: string;
  files: string[];
}

export interface Insights {
  gapQuestions: Insight[];
  edgeCases: Insight[];
  testCases: { title: string; steps: string[]; expected: string; files: string[] }[];
  risks: Insight[];
}

const short = (id: string) => id.replace(/^(table|event):/, "").split("/").slice(-2).join("/");
const list = (nodes: ImpactNode[], n = 3) =>
  nodes.slice(0, n).map((x) => short(x.id)).join(", ") + (nodes.length > n ? ` and ${nodes.length - n} more` : "");

export function buildInsights(map: SystemMap, result: ImpactResult): Insights {
  const byId = new Map(map.files.map((f) => [f.id, f]));
  const of = (area: string) => result.byArea[area as keyof typeof result.byArea] ?? [];
  const direct = result.nodes.filter((n) => n.relation === "direct");
  const downstream = result.nodes.filter((n) => n.relation === "downstream");
  const screens = of("Screens");
  const apis = of("APIs");
  const data = of("Data");
  const perms = of("Permissions");
  const notify = of("Notifications");
  const reports = of("Reports");
  const tests = of("Tests");

  const gapQuestions: Insight[] = [];
  const edgeCases: Insight[] = [];
  const testCases: Insights["testCases"] = [];
  const risks: Insight[] = [];

  // Screens that are not part of the request but sit on the same code.
  const sideScreens = screens.filter((n) => n.relation !== "direct");
  if (sideScreens.length) {
    gapQuestions.push({
      text: `Should ${list(sideScreens)} change as well? They use code this feature touches${sideScreens[0].path.length ? ` (${describeStep(sideScreens[0].path[sideScreens[0].path.length - 1])})` : ""}.`,
      files: sideScreens.map((n) => n.id),
    });
  }

  if (perms.length) {
    gapQuestions.push({
      text: `Who is allowed to do this? Access is decided in ${list(perms)}; say which roles get the new capability and what everyone else sees.`,
      files: perms.map((n) => n.id),
    });
    testCases.push({
      title: "A user without permission is refused",
      steps: ["Sign in as a user who should not have access", "Try the new action from the screen and directly through the API"],
      expected: "The action is refused with a clear message, and nothing changes in the data.",
      files: perms.map((n) => n.id),
    });
  } else if (apis.length) {
    gapQuestions.push({
      text: `No access-control code is linked to ${list(apis.filter((n) => n.relation === "direct").length ? apis.filter((n) => n.relation === "direct") : apis, 2)}. Who may use it, and where is that enforced?`,
      files: apis.map((n) => n.id),
    });
  }

  if (data.length) {
    gapQuestions.push({
      text: `Does the stored data change (${list(data)})? If a field is added or its meaning changes, what happens to existing records?`,
      files: data.map((n) => n.id),
    });
    edgeCases.push({
      text: `Records created before this change, which lack any new field, still load and display in ${list(screens.length ? screens : data, 2)}.`,
      files: data.map((n) => n.id),
    });
  }

  if (notify.length) {
    gapQuestions.push({
      text: `${list(notify)} send messages or events. Should this change notify anyone, and with what content?`,
      files: notify.map((n) => n.id),
    });
  }
  if (reports.length) {
    gapQuestions.push({
      text: `Reports or exports read this area (${list(reports)}). Should they include the change?`,
      files: reports.map((n) => n.id),
    });
  }

  // API contract: every caller of a changed endpoint.
  const httpCallers = result.nodes.filter((n) => n.path.some((s) => s.type === "http"));
  const callersByApi = new Map<string, ImpactNode[]>();
  for (const n of httpCallers) {
    const step = n.path.find((s) => s.type === "http")!;
    (callersByApi.get(step.to) ?? callersByApi.set(step.to, []).get(step.to)!).push(n);
  }
  const directApis = apis.filter((n) => n.relation === "direct");
  for (const api of directApis.slice(0, 3)) {
    const callers = map.edges
      .filter((e) => e.type === "http" && e.to === api.id && !byId.get(e.from)?.tags.includes("test"))
      .map((e) => e.from);
    const f = byId.get(api.id);
    const served = f?.routes.filter((r) => r.role === "serves").map((r) => `${r.method ?? ""} ${r.path}`.trim()) ?? [];
    if (callers.length > 1) {
      risks.push({
        text: `${short(api.id)} is called from ${callers.length} places (${callers.slice(0, 3).map(short).join(", ")}). Changing its request or response shape breaks every one of them unless the change is backward compatible.`,
        files: [api.id, ...callers],
      });
    }
    if (served.length) {
      testCases.push({
        title: `Endpoint contract: ${served.slice(0, 2).join(", ")}`,
        steps: ["Call the endpoint with a valid request", "Call it with missing and invalid fields", "Call it for a record that does not exist"],
        expected: "Valid requests succeed with the documented shape; invalid ones fail with a 4xx and a readable message; nothing is half-saved.",
        files: [api.id],
      });
    }
  }

  if (screens.length) {
    edgeCases.push({
      text: `Loading, empty and error states in ${list(screens.filter((n) => n.relation === "direct").length ? screens.filter((n) => n.relation === "direct") : screens, 2)}: slow network, no records yet, and a failed save.`,
      files: screens.map((n) => n.id),
    });
    edgeCases.push({
      text: "Two people change the same record at the same time; the later save must not silently overwrite the earlier one.",
      files: direct.map((n) => n.id),
    });
    const mainScreen = screens.find((n) => n.relation === "direct") ?? screens[0];
    testCases.push({
      title: `Happy path in ${short(mainScreen.id)}`,
      steps: ["Open the screen as a normal user", "Complete the new flow end to end", "Reload the page"],
      expected: "The change is visible, saved, and still there after reload.",
      files: [mainScreen.id],
    });
  }

  const hubs = result.nodes.filter((n) => n.hub);
  if (hubs.length) {
    risks.push({
      text: `${list(hubs)} ${hubs.length === 1 ? "is" : "are"} shared by much of the codebase. Edit ${hubs.length === 1 ? "it" : "them"} only if needed, and run the full test suite after.`,
      files: hubs.map((n) => n.id),
    });
  }
  if (downstream.length > 15) {
    risks.push({
      text: `${downstream.length} files depend on the code this touches. Keep the change behind a clear interface so most of them do not need to change.`,
      files: downstream.slice(0, 10).map((n) => n.id),
    });
  }
  if (tests.length) {
    testCases.push({
      title: "Run the existing tests that cover this area",
      steps: tests.slice(0, 6).map((t) => short(t.id)),
      expected: "They pass, or each failure is an intended behaviour change and the test is updated with it.",
      files: tests.map((n) => n.id),
    });
  } else {
    risks.push({ text: "No tests are linked to the files this touches. Add tests with the change.", files: direct.map((n) => n.id) });
  }

  return { gapQuestions, edgeCases, testCases, risks };
}
