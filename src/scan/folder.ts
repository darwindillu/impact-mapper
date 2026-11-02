// Reading a folder the user picks, and scanning it in a worker. Chrome and
// Edge have showDirectoryPicker, which can skip node_modules without listing
// it; other browsers use <input webkitdirectory>, which lists everything first.

import { CONFIG_FILES, keepDir, keepFile } from "../../scanner/languages.ts";
import type { SystemMap } from "../../shared/map.ts";
import type { ScanRequest, ScanResponse } from "./protocol.ts";

interface DirHandle {
  name: string;
  kind: "directory";
  values(): AsyncIterable<DirHandle | FileHandle>;
}
interface FileHandle {
  name: string;
  kind: "file";
  getFile(): Promise<File>;
}
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { mode?: "read" }) => Promise<DirHandle> };

export const canPickDirectory = () => typeof (window as PickerWindow).showDirectoryPicker === "function";

/** Opens the folder picker; undefined if the user cancels. */
export async function pickDirectory(onFound: (count: number) => void): Promise<ScanRequest | undefined> {
  let root: DirHandle;
  try {
    root = await (window as PickerWindow).showDirectoryPicker!({ mode: "read" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return undefined;
    throw e;
  }
  const req: ScanRequest = { name: root.name, files: [], configs: [] };
  const visit = async (dir: DirHandle, prefix: string) => {
    for await (const entry of dir.values()) {
      const id = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (keepDir(entry.name)) await visit(entry, id);
      } else if (CONFIG_FILES.includes(entry.name)) {
        req.configs.push({ id, text: await (await entry.getFile()).text() });
      } else {
        const file = await entry.getFile();
        const lang = keepFile(entry.name, file.size);
        if (lang) {
          req.files.push({ id, lang, file });
          if (req.files.length % 100 === 0) onFound(req.files.length);
        }
      }
    }
  };
  await visit(root, "");
  return req;
}

/** The same, from an <input type="file" webkitdirectory> selection. */
export async function fromFileList(list: FileList): Promise<ScanRequest | undefined> {
  const all = [...list];
  if (!all.length) return undefined;
  const name = all[0].webkitRelativePath.split("/")[0];
  const req: ScanRequest = { name, files: [], configs: [] };
  for (const file of all) {
    const parts = file.webkitRelativePath.split("/").slice(1); // drop the folder's own name
    if (!parts.slice(0, -1).every(keepDir)) continue;
    const id = parts.join("/");
    const fileName = parts[parts.length - 1];
    if (CONFIG_FILES.includes(fileName)) req.configs.push({ id, text: await file.text() });
    else {
      const lang = keepFile(fileName, file.size);
      if (lang) req.files.push({ id, lang, file });
    }
  }
  return req;
}

export function scanInWorker(req: ScanRequest, onProgress: (done: number, total: number) => void): Promise<SystemMap> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ScanResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") return onProgress(msg.done, msg.total);
      worker.terminate();
      if (msg.type === "done") resolve(msg.map);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "The scan failed."));
    };
    worker.postMessage(req);
  });
}
