// Turns an import specifier ("./api", "@/lib/x", "app.models", "a.b.C",
// "github.com/org/repo/pkg", "App\\Models\\User") into the repo files it names.
// Imports of third-party packages resolve to nothing and are dropped.

import { dirname, join, normalize } from "./paths.ts";

const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"];

function stripExt(p: string): string {
  return p.replace(/\.[a-z0-9]+$/i, "");
}

interface ConfigJson {
  name?: string;
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
}

// tsconfig.json allows comments and trailing commas.
function parseJsonLoose(raw: string): ConfigJson | undefined {
  try {
    const text = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class Resolver {
  private byNoExt = new Map<string, string>();
  private byBase = new Map<string, string[]>();
  private byDir = new Map<string, string[]>();
  private byNamespace = new Map<string, string[]>();
  private aliases: { prefix: string; from: string; to: string[] }[] = [];
  private packages = new Map<string, string>();
  private goModules: { prefix: string; module: string }[] = [];

  /**
   * `configs`: every package.json, tsconfig.json, jsconfig.json and go.mod in
   * the scan, by file id, so monorepo packages and path aliases resolve.
   */
  constructor(files: { id: string; namespaces: string[] }[], configs: { id: string; text: string }[]) {
    for (const f of files) {
      const key = stripExt(f.id).toLowerCase();
      this.byNoExt.set(key, f.id);
      const base = key.split("/").pop()!;
      (this.byBase.get(base) ?? this.byBase.set(base, []).get(base)!).push(f.id);
      const dir = dirname(f.id).toLowerCase();
      (this.byDir.get(dir) ?? this.byDir.set(dir, []).get(dir)!).push(f.id);
      for (const ns of f.namespaces) {
        (this.byNamespace.get(ns) ?? this.byNamespace.set(ns, []).get(ns)!).push(f.id);
      }
    }
    for (const c of configs) this.readConfig(c.id, c.text);
  }

  private readConfig(id: string, text: string) {
    const dir = dirname(id);
    const idDir = dir === "." ? "" : dir;
    const file = id.split("/").pop();
    if (file === "package.json") {
      // The root package.json names the repo itself, not an importable package.
      const name = parseJsonLoose(text)?.name;
      if (name && idDir) this.packages.set(name, idDir);
    } else if (file === "tsconfig.json" || file === "jsconfig.json") {
      const opts = parseJsonLoose(text)?.compilerOptions;
      if (!opts) return;
      const base = join(idDir || ".", opts.baseUrl ?? ".");
      for (const [pattern, targets] of Object.entries(opts.paths ?? {})) {
        this.aliases.push({
          prefix: idDir,
          from: pattern.replace(/\*$/, ""),
          to: targets.map((t) => join(base, t.replace(/\*$/, ""))),
        });
      }
    } else if (file === "go.mod") {
      const mod = /^module\s+(\S+)/m.exec(text)?.[1];
      if (mod) this.goModules.push({ prefix: idDir, module: mod });
    }
  }

  private exact(pathNoExt: string): string[] {
    const p = normalize(pathNoExt).toLowerCase().replace(/^\.\//, "");
    const hit = this.byNoExt.get(p) ?? this.byNoExt.get(`${p}/index`) ?? this.byNoExt.get(`${p}/__init__`);
    return hit ? [hit] : [];
  }

  /** Files whose path ends with the given segments ("a/b/c" matches "src/a/b/c.py"). */
  private suffix(pathNoExt: string, from: string): string[] {
    const p = pathNoExt.toLowerCase().replace(/^\/+/, "");
    const base = p.split("/").pop()!;
    const candidates = [
      ...(this.byBase.get(base) ?? []),
      ...(this.byBase.get("__init__") ?? []).filter((id) => stripExt(id).toLowerCase().endsWith(`${p}/__init__`)),
    ];
    const hits = candidates.filter((id) => {
      const k = stripExt(id).toLowerCase().replace(/\/__init__$/, "");
      return k === p || k.endsWith(`/${p}`);
    });
    // Same root first: a monorepo can hold two "models.py".
    const root = from.split("/")[0];
    const same = hits.filter((h) => h.split("/")[0] === root);
    return (same.length ? same : hits).slice(0, 3);
  }

  resolve(from: string, spec: string, lang: string): string[] {
    const dir = dirname(from);
    switch (lang) {
      case "typescript":
      case "tsx":
      case "javascript": {
        const withoutExt = (s: string) => (JS_EXTS.some((e) => s.endsWith(e)) ? stripExt(s) : s);
        if (spec.startsWith(".")) return this.exact(withoutExt(join(dir, spec)));
        for (const a of this.aliases) {
          if (a.prefix && !from.startsWith(a.prefix)) continue;
          if (a.from && spec.startsWith(a.from)) {
            for (const t of a.to) {
              const hit = this.exact(withoutExt(join(t, spec.slice(a.from.length))));
              if (hit.length) return hit;
            }
          }
        }
        // "@/x" and "~/x" conventionally mean the nearest src/ folder.
        if (/^[@~]\//.test(spec)) {
          const idx = from.lastIndexOf("/src/");
          const src = idx >= 0 ? from.slice(0, idx + 4) : from.startsWith("src/") ? "src" : "";
          if (src) {
            const hit = this.exact(withoutExt(join(src, spec.slice(2))));
            if (hit.length) return hit;
          }
        }
        for (const [name, pkgDir] of this.packages) {
          if (spec === name || spec.startsWith(`${name}/`)) {
            const rest = spec.slice(name.length).replace(/^\//, "");
            return rest
              ? [...this.exact(join(pkgDir, rest)), ...this.exact(join(pkgDir, "src", rest))].slice(0, 1)
              : [...this.exact(join(pkgDir, "src", "index")), ...this.exact(join(pkgDir, "index"))].slice(0, 1);
          }
        }
        return [];
      }
      case "python": {
        const rel = /^(\.+)(.*)$/.exec(spec);
        if (rel) {
          let base = dir;
          for (let i = 1; i < rel[1].length; i++) base = dirname(base);
          return this.exact(join(base, rel[2].replace(/\./g, "/")));
        }
        return this.suffix(spec.replace(/\./g, "/"), from);
      }
      case "java": {
        if (spec.endsWith(".*")) {
          const pkg = spec.slice(0, -2);
          return (this.byNamespace.get(pkg) ?? []).slice(0, 25);
        }
        const hit = this.suffix(spec.replace(/\./g, "/"), from);
        return hit.length ? hit : this.suffix(spec.split(".").slice(0, -1).join("/"), from);
      }
      case "go": {
        for (const m of this.goModules) {
          if (spec === m.module || spec.startsWith(`${m.module}/`)) {
            const rel = join(m.prefix || ".", spec.slice(m.module.length)).toLowerCase().replace(/^\.\//, "");
            return (this.byDir.get(rel === "" ? "." : rel) ?? []).filter((id) => !id.endsWith("_test.go")).slice(0, 25);
          }
        }
        return [];
      }
      case "csharp":
        return (this.byNamespace.get(spec) ?? []).filter((id) => id !== from).slice(0, 25);
      case "php": {
        if (spec.includes("/") || spec.endsWith(".php")) return this.exact(stripExt(join(dir, spec.replace(/^__DIR__\s*\.\s*/, ""))));
        const p = spec.replace(/^\\/, "").replace(/\\/g, "/");
        const hit = this.suffix(p, from);
        return hit.length ? hit : this.suffix(p.split("/").slice(1).join("/"), from);
      }
      case "ruby":
        if (spec.startsWith(".")) return this.exact(stripExt(join(dir, spec)));
        return this.suffix(spec, from);
      default:
        return [];
    }
  }
}
