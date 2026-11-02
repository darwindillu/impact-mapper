// Share links with no server: the analysis is compressed into the URL's #hash,
// which browsers never send to a server. A sample's link holds just the input
// and is re-run on open; for the visitor's own codebase it holds a snapshot of
// the result (file paths and links, never source code).

import type { Analysis } from "../../shared/ai.ts";
import type { ImpactResult } from "../../shared/analyze.ts";
import type { Insights } from "../../shared/insights.ts";
import type { FileNode } from "../../shared/map.ts";

export interface SharedView {
  v: 1;
  mode: "feature" | "diff";
  text: string;
  mapName: string;
  sample?: string;
  snapshot?: {
    result: ImpactResult;
    insights: Insights;
    files: Pick<FileNode, "id" | "tags" | "symbols" | "routes" | "tables" | "churn">[];
    ai?: Analysis;
  };
}

const PREFIX = "#view=";

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function shareUrl(view: SharedView): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(view)), new CompressionStream("deflate-raw"));
  // String.fromCharCode(...bytes) overflows the stack on large arrays; chunk it.
  let binary = "";
  for (let i = 0; i < packed.length; i += 0x8000) binary += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}${location.pathname}${PREFIX}${encoded}`;
}

export async function readSharedView(hash: string): Promise<SharedView | undefined> {
  if (!hash.startsWith(PREFIX)) return undefined;
  try {
    const bytes = await pipe(fromBase64Url(hash.slice(PREFIX.length)), new DecompressionStream("deflate-raw"));
    const view = JSON.parse(new TextDecoder().decode(bytes)) as SharedView;
    return view.v === 1 ? view : undefined;
  } catch {
    return undefined;
  }
}
