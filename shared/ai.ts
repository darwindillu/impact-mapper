// The AI half: Claude explains what the graph found. It only ever sees the
// structure (paths, names, routes, link chains), and every impact it reports
// must cite a file from that structure; anything else is dropped.
// Server-side only (the API route and the scanner), never in the browser.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { LIMITS, type AnalysisRequest } from "./request.ts";

export type { AnalysisRequest } from "./request.ts";

export const ANALYSIS_MODEL = "claude-opus-5-5";
export const CARD_MODEL = "claude-haiku-5-5";
// If a safety classifier declines a request, retry it server-side on the
// model Anthropic recommends for that case instead of failing.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

const AnalysisSchema = z.object({
  summary: z.string().describe("Two or three sentences: what the change touches and where the risk is."),
  impacts: z.array(
    z.object({
      file: z.string().describe("Exactly one of the file ids given. Never a file that was not given."),
      why: z.string().describe("One sentence, specific to this file."),
      change: z.enum(["must change", "may change", "verify only"]),
      risk: z.enum(["high", "medium", "low"]),
    }),
  ),
  gapQuestions: z.array(z.string()).describe("Questions the requirement leaves open, which a product owner must answer before coding."),
  edgeCases: z.array(z.string()),
  testCases: z.array(
    z.object({
      title: z.string(),
      steps: z.array(z.string()),
      expected: z.string(),
    }),
  ),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

const SYSTEM = `You review feature requirements against a map of an existing codebase, before any code is written.

You are given the requirement and the files a static analysis of the codebase linked to it: files that match it directly, files downstream (they depend on a matched file, so the change can break them) and files upstream (a matched file depends on them). Each file comes with its tags, symbols, routes, data stores, and the chain of links that put it in the list.

Work only from what is given. Cite files by their exact id. Do not mention or invent files, screens, endpoints or tables that are not in the list; if something the requirement needs seems to be missing from the codebase, say so as a gap question instead. Prefer specific, checkable statements over general advice. Keep each item to one or two sentences.`;

function validate(req: AnalysisRequest) {
  if (!req?.requirement?.trim()) throw new Error("The requirement is empty.");
  if (req.requirement.length > LIMITS.requirementChars) throw new Error(`Keep the requirement under ${LIMITS.requirementChars} characters.`);
  if (!Array.isArray(req.nodes) || req.nodes.length === 0) throw new Error("Nothing in the codebase matched this requirement.");
  if (req.nodes.length > LIMITS.nodes) throw new Error(`Send at most ${LIMITS.nodes} files.`);
  if (JSON.stringify(req).length > LIMITS.contextChars) throw new Error("The request is too large.");
}

export async function explain(apiKey: string, req: AnalysisRequest): Promise<Analysis> {
  validate(req);
  const client = new Anthropic({ apiKey });
  const files = req.nodes
    .map((n) => {
      const parts = [
        `- ${n.id} [${n.relation}, ${n.area}]`,
        n.symbols.length ? `  symbols: ${n.symbols.join(", ")}` : "",
        n.routes.length ? `  routes: ${n.routes.join("; ")}` : "",
        n.tables.length ? `  data: ${n.tables.join(", ")}` : "",
        n.card ? `  summary: ${n.card}` : "",
        `  why listed: ${n.why}`,
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n");
  const languages = Object.entries(req.languages).map(([l, n]) => `${l} (${n} files)`).join(", ");

  const response = await client.beta.messages.parse({
    model: ANALYSIS_MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Codebase: ${req.mapName} — ${languages}\n\nFiles linked to the requirement:\n${files}\n\nRequirement:\n<requirement>\n${req.requirement}\n</requirement>`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  const out = response.parsed_output;
  if (!out) throw new Error("The model's answer could not be read. Try again.");

  // The graph is the source of truth: drop any impact on a file it didn't give.
  const known = new Set(req.nodes.map((n) => n.id));
  return { ...out, impacts: out.impacts.filter((i) => known.has(i.file)) };
}

const CardsSchema = z.object({
  files: z.array(z.object({ id: z.string(), summary: z.string() })),
});

/** One-line summaries of source files, for `scan --cards`. */
export async function summarize(apiKey: string, files: { id: string; code: string }[]): Promise<Map<string, string>> {
  const client = new Anthropic({ apiKey });
  const body = files.map((f) => `<file id="${f.id}">\n${f.code}\n</file>`).join("\n\n");
  const response = await client.beta.messages.parse({
    model: CARD_MODEL,
    max_tokens: 4000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(CardsSchema) },
    system:
      "For each file, write one sentence (under 25 words) saying what it does and which data or endpoints it reads or writes. Use the file's own names. Return every file id given, unchanged.",
    messages: [{ role: "user", content: body }],
  });
  const known = new Set(files.map((f) => f.id));
  const out = new Map<string, string>();
  for (const f of response.parsed_output?.files ?? []) if (known.has(f.id)) out.set(f.id, f.summary.trim());
  return out;
}
