// The system map: what the scanner writes and the web app reads. It holds the
// structure of a codebase (files, symbols, routes, data, events and the links
// between them), never the source code itself.

export const MAP_VERSION = 1;

export type Tag =
  | "ui"
  | "api"
  | "data"
  | "service"
  | "report"
  | "notification"
  | "permission"
  | "test"
  | "config";

export type RouteRole = "serves" | "calls" | "mentions";

export interface RouteRef {
  /** Normalized path, params as ":p" (for example "/articles/:p/comments"). */
  path: string;
  method?: string;
  role: RouteRole;
}

export interface EventRef {
  name: string;
  role: "emits" | "listens";
}

export interface FileNode {
  /** Repo-relative path with forward slashes, prefixed by the root name when several roots are scanned. */
  id: string;
  lang: string;
  loc: number;
  tags: Tag[];
  symbols: string[];
  routes: RouteRef[];
  tables: string[];
  events: EventRef[];
  /** Optional one-line AI summary, written by `scan --cards`. */
  card?: string;
}

export type EdgeType = "import" | "http" | "data" | "event";

/** `from` depends on `to`: it imports it, calls it, or uses the data or event it names. */
export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  label?: string;
  /** 1 for parsed links; lower for guessed ones (dynamic URLs, fuzzy matches). */
  confidence: number;
}

export interface SystemMap {
  version: typeof MAP_VERSION;
  name: string;
  scannedAt: string;
  roots: string[];
  languages: Record<string, number>;
  files: FileNode[];
  /** Data stores and events that more than one file touches, as nodes "table:x" and "event:x". */
  resources: { id: string; kind: "table" | "event"; name: string }[];
  edges: Edge[];
}
