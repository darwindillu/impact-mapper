// Copies the tree-sitter runtime and grammars into public/grammars so the
// browser can scan a folder. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = "public/grammars";
const grammars = dirname(require.resolve("tree-sitter-wasms/package.json"));
const runtime = dirname(require.resolve("web-tree-sitter"));
const languages = ["typescript", "tsx", "javascript", "python", "java", "go", "c_sharp", "php", "ruby", "kotlin", "rust", "scala"];

mkdirSync(out, { recursive: true });
copyFileSync(join(runtime, "tree-sitter.wasm"), join(out, "tree-sitter.wasm"));
for (const l of languages) copyFileSync(join(grammars, "out", `tree-sitter-${l}.wasm`), join(out, `tree-sitter-${l}.wasm`));
// The user guide, linked from the in-app Help.
copyFileSync("docs/USER_GUIDE.md", "public/USER_GUIDE.md");
console.log(`copied ${languages.length} grammars to ${out}, and the user guide`);
