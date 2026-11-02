import type { SystemMap } from "../../shared/map.ts";

export interface ScanRequest {
  name: string;
  files: { id: string; lang: string; file: File }[];
  configs: { id: string; text: string }[];
}

export type ScanResponse =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; map: SystemMap }
  | { type: "error"; message: string };
