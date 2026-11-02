// Per-language facts the extractor needs. Everything else is shared: the
// extractor walks tree-sitter syntax trees generically, so adding a language
// is mostly one entry here plus its grammar file.

export interface LanguageSpec {
  /** Grammar file name in tree-sitter-wasms/out, without "tree-sitter-" and ".wasm". */
  grammar: string;
  extensions: string[];
}

export const LANGUAGES: Record<string, LanguageSpec> = {
  typescript: { grammar: "typescript", extensions: [".ts", ".mts", ".cts"] },
  tsx: { grammar: "tsx", extensions: [".tsx"] },
  javascript: { grammar: "javascript", extensions: [".js", ".jsx", ".mjs", ".cjs"] },
  python: { grammar: "python", extensions: [".py"] },
  java: { grammar: "java", extensions: [".java"] },
  go: { grammar: "go", extensions: [".go"] },
  csharp: { grammar: "c_sharp", extensions: [".cs"] },
  php: { grammar: "php", extensions: [".php"] },
  ruby: { grammar: "ruby", extensions: [".rb"] },
  kotlin: { grammar: "kotlin", extensions: [".kt", ".kts"] },
  rust: { grammar: "rust", extensions: [".rs"] },
  scala: { grammar: "scala", extensions: [".scala"] },
  // Single-file components: their <script> is parsed as TypeScript or JavaScript.
  vue: { grammar: "typescript", extensions: [".vue"] },
  svelte: { grammar: "typescript", extensions: [".svelte"] },
};

/**
 * For a .vue or .svelte file: its script as TypeScript/JavaScript, and its
 * template's visible text. Other files pass through.
 */
export function prepareSource(lang: string, text: string): { lang: string; code: string; templateText: string[] } {
  if (lang !== "vue" && lang !== "svelte") return { lang, code: text, templateText: [] };
  const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const ts = scripts.some((m) => /lang=["']?ts/.test(m[1]));
  const template = text.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, "");
  const templateText = [...template.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter((s) => s.includes(" "));
  return { lang: ts ? "typescript" : "javascript", code: scripts.map((m) => m[2]).join("\n"), templateText };
}

export function languageFor(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts") || /\.min\.(js|mjs|cjs)$/.test(lower)) return undefined;
  for (const [name, spec] of Object.entries(LANGUAGES)) {
    if (spec.extensions.some((ext) => lower.endsWith(ext))) return name;
  }
  return undefined;
}

/** Display name for the language counts in the map ("tsx" counts as TypeScript). */
export function familyOf(lang: string): string {
  return lang === "tsx" ? "typescript" : lang;
}

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  "vendor",
  "target",
  "bin",
  "obj",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".idea",
  ".vscode",
  "public",
  "static",
]);

export const MAX_FILE_BYTES = 400_000;

/** Read for import resolution (aliases, workspace packages, Go modules). */
export const CONFIG_FILES = ["package.json", "tsconfig.json", "jsconfig.json", "go.mod"];

export function keepDir(name: string): boolean {
  return !name.startsWith(".") && !IGNORED_DIRS.has(name);
}

/** The file's language when it should be scanned, else undefined. */
export function keepFile(name: string, size: number): string | undefined {
  if (name.startsWith(".") || size > MAX_FILE_BYTES) return undefined;
  return languageFor(name);
}
