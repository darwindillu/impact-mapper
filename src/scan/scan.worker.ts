// Scans a picked folder inside the browser, off the main thread. The files
// are read and parsed here; nothing leaves the machine.

import Parser from "web-tree-sitter";
import { scanSources } from "../../scanner/core.ts";
import type { ScanRequest, ScanResponse } from "./protocol.ts";

// This file runs as a worker, but the app's types are the DOM's.
const post = (msg: ScanResponse) => (self as unknown as { postMessage(m: ScanResponse): void }).postMessage(msg);
let ready: Promise<void> | undefined;

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { name, files, configs } = e.data;
  try {
    ready ??= Parser.init({ locateFile: () => "/grammars/tree-sitter.wasm" });
    await ready;
    let last = 0;
    const map = await scanSources({
      name,
      roots: [name],
      files: files.map((f) => ({ id: f.id, lang: f.lang, read: () => f.file.text() })),
      configs,
      loadLanguage: (grammar) => Parser.Language.load(`/grammars/tree-sitter-${grammar}.wasm`),
      onProgress: (done, total) => {
        const now = Date.now();
        if (now - last > 100 || done === total) {
          last = now;
          post({ type: "progress", done, total });
        }
      },
    });
    post({ type: "done", map });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : "The scan failed." });
  }
};
