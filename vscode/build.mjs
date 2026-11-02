// Bundles the extension (no node_modules at run time) and copies the parser files next to it.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = "dist";
mkdirSync(join(out, "grammars"), { recursive: true });
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(out, "extension.js"),
  external: ["vscode"],
  logLevel: "warning",
  // scanner/build.ts only reads import.meta when no grammarDir is given; the extension always gives one.
  logOverride: { "empty-import-meta": "silent" },
});
const grammars = join(dirname(require.resolve("tree-sitter-wasms/package.json", { paths: [".."] })), "out");
const runtime = dirname(require.resolve("web-tree-sitter", { paths: [".."] }));
copyFileSync(join(runtime, "tree-sitter.wasm"), join(out, "grammars", "tree-sitter.wasm"));
for (const l of ["typescript", "tsx", "javascript", "python", "java", "go", "c_sharp", "php", "ruby", "kotlin", "rust", "scala"]) {
  copyFileSync(join(grammars, `tree-sitter-${l}.wasm`), join(out, "grammars", `tree-sitter-${l}.wasm`));
}
console.log("built vscode/dist");
