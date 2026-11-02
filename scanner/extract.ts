// Pulls the language-neutral facts out of one file's syntax tree: imports,
// definitions, routes served or called, data stores and events. It works on
// node types and call names, not on any one framework's API.

import type Parser from "web-tree-sitter";
import type { EventRef, RouteRef } from "../shared/map.ts";
import { joinRoutes, looksLikeRoute, normalizeRoute } from "./routes.ts";

type Node = Parser.SyntaxNode;

export interface FileFacts {
  imports: string[];
  /** Namespace or package the file declares (C#, PHP, Java, Go). */
  namespaces: string[];
  symbols: string[];
  routes: RouteRef[];
  tables: string[];
  events: EventRef[];
}

const STRING_TYPES = new Set([
  "string",
  "template_string",
  "string_literal",
  "interpreted_string_literal",
  "raw_string_literal",
  "verbatim_string_literal",
  "encapsed_string",
]);
const CALL_TYPES = new Set([
  "call_expression",
  "call",
  "method_invocation",
  "invocation_expression",
  "function_call_expression",
  "member_call_expression",
  "scoped_call_expression",
  "new_expression",
  "object_creation_expression",
]);
const DECORATOR_TYPES = new Set(["decorator", "annotation", "marker_annotation", "attribute"]);
const CLASS_TYPES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "class_definition",
  "class",
  "record_declaration",
]);
const DEFINITION_TYPES = new Set([
  ...CLASS_TYPES,
  "interface_declaration",
  "enum_declaration",
  "function_declaration",
  "function_definition",
  "method_definition",
  "method_declaration",
  "method",
  "module",
  "type_spec",
]);

// Receivers that make HTTP requests rather than declare routes.
const CLIENT_CALLEE =
  /(^|[.\s])(fetch|\$fetch|axios|ky|got|superagent|requests|httpx|aiohttp|http\.(get|post|put|patch|delete|request)|https?client|this\.http|apiclient|api|client|agent|resttemplate|webclient|usequery|usemutation|useswr|usefetch|request)(\b|$)/i;
const ROUTE_WORDS =
  /^(get|post|put|patch|delete|del|head|options|all|route|handle|handlefunc|handler|path|re_path|url|api_view|controller|requestmapping|getmapping|postmapping|putmapping|patchmapping|deletemapping|httpget|httppost|httpput|httppatch|httpdelete|resource|resources|match|register)$/i;
// Group("/api"), use("/api", router), namespace("api") set a prefix, not a route.
const VERBS = /^(get|post|put|patch|delete)/i;
const ROUTER_RECEIVER = /(^|\.)(app|router|route|routes|server|r|e|g|api|group|grp|v\d+|mux|engine|blueprint|bp|fastify|hono|express)$/i;
const TABLE_WORDS =
  /^(collection|table|model|getrepository|from|entity|define|document|tablename|db_table|schema)$/i;
const EMIT_WORDS = /^(emit|publish|dispatch|trigger|produce|broadcast|notify|sendmessage|enqueue|add)$/i;
const LISTEN_WORDS =
  /^(on|once|subscribe|listen|addeventlistener|consume|onevent|eventpattern|messagepattern|kafkalistener|rabbitlistener|sqslistener|eventlistener|receiver|process|processor)$/i;
const DOM_EVENTS =
  /^(click|change|submit|input|keydown|keyup|keypress|focus|blur|load|error|resize|scroll|mouse\w*|touch\w*|drag\w*|data|end|close|open|message|ready|connection|connect|disconnect|finish|exit)$/i;
const SQL = /\b(select|insert|update|delete|create\s+table|alter\s+table)\b/i;
const SQL_TABLE = /\b(?:from|join|into|update|table)\s+[`"[]?([a-z_][\w.]*)/gi;
const MODEL_BASE = /\b(models\.Model|db\.Model|Base|Model|Document|ActiveRecord::Base|ApplicationRecord|Eloquent)\b/;
const ENTITY_DECORATOR = /^(entity|table|document|schema|model)$/i;

/** Text of a call's callee: everything before the argument list. */
function calleeOf(node: Node): string {
  const text = node.text;
  const open = text.indexOf("(");
  return (open >= 0 ? text.slice(0, open) : text).replace(/^(new|@|\[)\s*/, "").trim().slice(-80);
}

function lastSegment(callee: string): string {
  const parts = callee.split(/::|->|\.|\s/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function stringValue(node: Node): string {
  return node.text
    .replace(/^[a-zA-Z@$]*(?=["'`])/, "") // f"", r"", b"", @"", $""
    .replace(/^("""|'''|["'`])/, "")
    .replace(/("""|'''|["'`])$/, "");
}

function nameOf(node: Node): string | undefined {
  return node.childForFieldName("name")?.text;
}

/** The declaration a decorator or annotation belongs to. */
function decoratedOwner(dec: Node): Node | undefined {
  // TypeScript puts a method's decorators beside it in the class body.
  if (dec.parent && /body|declaration_list/.test(dec.parent.type)) {
    let next = dec.nextNamedSibling;
    while (next && DECORATOR_TYPES.has(next.type)) next = next.nextNamedSibling;
    return next ?? undefined;
  }
  for (let n: Node | null = dec.parent; n; n = n.parent) {
    if (n.type === "decorated_definition") return n.childForFieldName("definition") ?? undefined;
    if (DEFINITION_TYPES.has(n.type)) return n;
  }
  return undefined;
}

function enclosingClass(node: Node): Node | undefined {
  for (let n: Node | null = node.parent; n; n = n.parent) {
    if (CLASS_TYPES.has(n.type)) return n;
  }
  return undefined;
}

export function normalizeTable(raw: string): string | undefined {
  const name = raw
    .split(".")
    .pop()!
    .toLowerCase()
    .replace(/(_collection|_table|collection|table)$/, "")
    .replace(/[^a-z0-9]/g, "");
  if (name.length < 2) return undefined;
  return name.length > 3 && name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : name;
}

function importsOf(node: Node, lang: string): string[] {
  const t = node.type;
  const strip = (s: string) => s.replace(/^["'`]|["'`]$/g, "");
  switch (lang) {
    case "typescript":
    case "tsx":
    case "javascript": {
      if (t === "import_statement" || t === "export_statement") {
        const src = node.childForFieldName("source");
        return src ? [strip(src.text)] : [];
      }
      if (t === "call_expression") {
        const fn = node.childForFieldName("function")?.text;
        const arg = node.childForFieldName("arguments")?.namedChildren[0];
        if ((fn === "require" || fn === "import") && arg && STRING_TYPES.has(arg.type)) return [strip(arg.text)];
      }
      return [];
    }
    case "python":
      if (t === "import_statement") {
        return node.namedChildren.map((c) => (c.type === "aliased_import" ? (nameOf(c) ?? c.text) : c.text));
      }
      if (t === "import_from_statement") {
        const mod = node.childForFieldName("module_name")?.text;
        if (!mod) return [];
        // "from app import models" may name a module, not a symbol.
        const names = node
          .childrenForFieldName("name")
          .map((c) => (c.type === "aliased_import" ? (nameOf(c) ?? c.text) : c.text));
        return [mod, ...names.map((n) => (mod.endsWith(".") ? mod + n : `${mod}.${n}`))];
      }
      return [];
    case "java":
      return t === "import_declaration" ? [node.text.replace(/^import\s+(static\s+)?|;$/g, "").trim()] : [];
    case "go":
      if (t === "import_spec") {
        const p = node.childForFieldName("path");
        return p ? [strip(p.text)] : [];
      }
      return [];
    case "csharp":
      return t === "using_directive"
        ? [node.text.replace(/^(global\s+)?using\s+(static\s+)?|;$/g, "").replace(/^\w+\s*=\s*/, "").trim()]
        : [];
    case "php":
      if (t === "namespace_use_clause") return [node.text.replace(/\s+as\s+\w+$/i, "").trim()];
      if (/^(require|include)(_once)?_expression$/.test(t)) {
        const s = node.namedChildren.find((c) => STRING_TYPES.has(c.type));
        return s ? [stringValue(s)] : [];
      }
      return [];
    case "ruby":
      if (t === "call") {
        const m = node.childForFieldName("method")?.text;
        const arg = node.childForFieldName("arguments")?.namedChildren[0];
        if ((m === "require" || m === "require_relative") && arg) return [`${m === "require_relative" ? "./" : ""}${stringValue(arg)}`];
      }
      return [];
    default:
      return [];
  }
}

function namespaceOf(node: Node, lang: string): string | undefined {
  const t = node.type;
  if (lang === "csharp" && (t === "namespace_declaration" || t === "file_scoped_namespace_declaration")) return nameOf(node);
  if (lang === "php" && t === "namespace_definition") return nameOf(node);
  if (lang === "java" && t === "package_declaration") return node.text.replace(/^package\s+|;$/g, "").trim();
  if (lang === "go" && t === "package_clause") return node.namedChildren[0]?.text;
  return undefined;
}

export function extractFacts(tree: Parser.Tree, lang: string): FileFacts {
  const imports: string[] = [];
  const namespaces: string[] = [];
  const symbols = new Set<string>();
  const tables = new Set<string>();
  const events: EventRef[] = [];
  // Routes are collected with their class so a class-level prefix
  // (@Controller("articles"), @RequestMapping, [Route]) can be applied after.
  const pending: { route: string; method?: string; role: RouteRef["role"]; cls?: Node }[] = [];
  const classPrefix = new Map<number, string>();

  const onString = (node: Node) => {
    const value = stringValue(node).replace(/\$\{[^}]*\}/g, "${}");
    if (!value || value.length > 300) return;

    // Find what the string is an argument to: a call, or a decorator/annotation.
    let context: Node | undefined;
    for (let n: Node | null = node.parent, depth = 0; n && depth < 4; n = n.parent, depth++) {
      if (CALL_TYPES.has(n.type) || DECORATOR_TYPES.has(n.type)) {
        context = n;
        break;
      }
      if (n.type === "assignment" || n.type === "expression_statement") break;
    }

    // Python models: __tablename__ = "users", db_table = "users".
    if (!context && /^(__tablename__|db_table|table_name|collection_name)\s*=/.test(node.parent?.text ?? "")) {
      const t = normalizeTable(value);
      if (t) tables.add(t);
      return;
    }

    if (SQL.test(value)) {
      for (const m of value.matchAll(SQL_TABLE)) {
        const t = normalizeTable(m[1]);
        if (t) tables.add(t);
      }
      return;
    }

    if (!context) {
      // <Route path="/login">, <Link to="/x">, { path: "/x" } in a JS router:
      // pages of a single-page app, not API endpoints.
      const parent = node.parent;
      const key = parent?.type === "pair" ? parent.childForFieldName("key")?.text.replace(/["']/g, "") : undefined;
      const isJs = lang === "javascript" || lang === "typescript" || lang === "tsx";
      if (parent?.type === "jsx_attribute" || (isJs && key && /^(path|to|redirect|href|link|url)$/i.test(key))) return;
      if (looksLikeRoute(value)) {
        const r = normalizeRoute(value);
        if (r) pending.push({ route: r, role: "mentions" });
      }
      return;
    }

    // @Controller("x") and @app.route("/x") reach the string through a call.
    if (CALL_TYPES.has(context.type) && context.parent && DECORATOR_TYPES.has(context.parent.type)) {
      context = context.parent;
    }
    const callee = calleeOf(context);
    const word = lastSegment(callee);
    const isDecorator = DECORATOR_TYPES.has(context.type);

    if (TABLE_WORDS.test(word) && !looksLikeRoute(value) && /^[\w.-]+$/.test(value)) {
      const t = normalizeTable(value);
      if (t) tables.add(t);
      return;
    }

    if (EMIT_WORDS.test(word) || LISTEN_WORDS.test(word)) {
      if (/^[\w.:\-/]{2,80}$/.test(value) && /[a-z]/i.test(value) && !value.startsWith("/") && !DOM_EVENTS.test(value)) {
        events.push({ name: value.toLowerCase(), role: EMIT_WORDS.test(word) ? "emits" : "listens" });
        return;
      }
    }

    const looksPath = /^[\w\-/:{}<>[\].*$^?()+\\]*$/.test(value) || value.includes("${}");
    if (!looksPath) return;

    if (!isDecorator && CLIENT_CALLEE.test(callee)) {
      // A client call must be a path or URL; a leading ${} or {BASE} is the base URL.
      const cleaned = value.replace(/^(\$\{\}|\{[^}]*\})/, "");
      if (!cleaned.startsWith("/") && !/^https?:/i.test(cleaned)) return;
      const r = normalizeRoute(cleaned.replace(/\$\{\}/g, ":p"));
      const verb = VERBS.exec(word)?.[1];
      if (r && r !== "/") pending.push({ route: r, role: "calls", method: verb?.toUpperCase() });
      return;
    }

    // app.get("/x") declares a route; settings.get("author") does not.
    const receiver = callee.slice(0, Math.max(0, callee.length - word.length)).replace(/[.:\->\s]+$/, "");
    const verbCall = !isDecorator && VERBS.test(word) && word.length <= 6;
    const routerLike = ROUTER_RECEIVER.test(receiver) || value.startsWith("/");
    if (ROUTE_WORDS.test(word) && (!verbCall || routerLike)) {
      const route = value.replace(/\$\{\}/g, ":p");
      const owner = isDecorator ? decoratedOwner(context) : undefined;
      const verb = VERBS.exec(word)?.[1] ?? /Http(Get|Post|Put|Patch|Delete)/i.exec(word)?.[1];
      if (owner && CLASS_TYPES.has(owner.type)) {
        // [Route("api/[controller]")] names the controller class.
        const controller = (nameOf(owner) ?? "").replace(/Controller$/, "").toLowerCase();
        classPrefix.set(owner.id, route.replace(/\[controller\]/gi, controller));
        return;
      }
      const r = normalizeRoute(route);
      if (r !== undefined) {
        pending.push({ route: route, role: "serves", method: verb?.toUpperCase(), cls: enclosingClass(context) });
      }
      return;
    }

    if (looksLikeRoute(value)) {
      const r = normalizeRoute(value);
      if (r) pending.push({ route: r, role: "mentions" });
    }
  };

  const onNode = (node: Node) => {
    imports.push(...importsOf(node, lang));
    const ns = namespaceOf(node, lang);
    if (ns) namespaces.push(ns);

    if (DEFINITION_TYPES.has(node.type)) {
      const name = nameOf(node);
      if (name && name.length > 2 && !/^(constructor|__init__|init|main)$/.test(name)) symbols.add(name);
      if (CLASS_TYPES.has(node.type) && name) {
        const header = node.text.split("\n")[0].slice(0, 200);
        const annotations = [
          node.parent?.type === "decorated_definition" ? node.parent.text.split("\n")[0] : "",
          ...node.namedChildren
            .filter((c) => DECORATOR_TYPES.has(c.type) || c.type === "modifiers" || c.type === "attribute_list")
            .map((c) => c.text),
        ].join(" ");
        const isModel =
          (MODEL_BASE.test(header) && !/Controller|View|Form|Serializer|Test/.test(name)) ||
          /[@[](Entity|Table|Document|Schema)\b/.test(annotations);
        if (isModel) {
          const t = normalizeTable(name);
          if (t) tables.add(t);
        }
      }
    } else if (node.type === "variable_declarator") {
      const value = node.childForFieldName("value");
      const name = nameOf(node);
      if (name && value && /^(arrow_function|function|function_expression)$/.test(value.type) && name.length > 2) {
        symbols.add(name);
      }
    } else if (DECORATOR_TYPES.has(node.type) && ROUTE_WORDS.test(lastSegment(calleeOf(node))) && !/["'`]/.test(node.text)) {
      // @GetMapping / @Get() with no path serve the class prefix itself.
      const owner = decoratedOwner(node);
      const word = lastSegment(calleeOf(node));
      if (owner && !CLASS_TYPES.has(owner.type)) {
        const verb = VERBS.exec(word)?.[1] ?? /Http(Get|Post|Put|Patch|Delete)/i.exec(word)?.[1];
        pending.push({ route: "", role: "serves", method: verb?.toUpperCase(), cls: enclosingClass(node) });
      }
    } else if (DECORATOR_TYPES.has(node.type) && ENTITY_DECORATOR.test(lastSegment(calleeOf(node)))) {
      const owner = decoratedOwner(node);
      const n = owner && nameOf(owner);
      if (n && CLASS_TYPES.has(owner.type) && !node.text.includes('"') && !node.text.includes("'")) {
        const t = normalizeTable(n);
        if (t) tables.add(t);
      }
    }

    if (STRING_TYPES.has(node.type)) {
      onString(node);
      return false; // don't descend into string fragments
    }
    return true;
  };

  const cursor = tree.walk();
  let descend = onNode(cursor.currentNode);
  for (;;) {
    if (descend && cursor.gotoFirstChild()) {
      descend = onNode(cursor.currentNode);
      continue;
    }
    while (!cursor.gotoNextSibling()) {
      if (!cursor.gotoParent()) {
        cursor.delete();
        return finish();
      }
    }
    descend = onNode(cursor.currentNode);
  }

  function finish(): FileFacts {
    const routes = new Map<string, RouteRef>();
    for (const p of pending) {
      const prefix = p.cls ? classPrefix.get(p.cls.id) : undefined;
      const path = p.role === "serves" ? (prefix !== undefined ? joinRoutes(prefix, p.route) : normalizeRoute(p.route)) : p.route;
      if (!path || (p.role !== "serves" && path === "/")) continue;
      const key = `${p.role} ${p.method ?? ""} ${path}`;
      if (!routes.has(key)) routes.set(key, { path, role: p.role, ...(p.method ? { method: p.method } : {}) });
    }
    // A class prefix with no method routes is itself the served route.
    for (const prefix of classPrefix.values()) {
      const path = normalizeRoute(prefix);
      if (path && path !== "/" && ![...routes.values()].some((r) => r.role === "serves")) {
        routes.set(`serves  ${path}`, { path, role: "serves" });
      }
    }
    const seen = new Set<string>();
    return {
      imports: [...new Set(imports)].filter(Boolean),
      namespaces: [...new Set(namespaces)],
      symbols: [...symbols].slice(0, 80),
      routes: [...routes.values()].slice(0, 120),
      tables: [...tables].slice(0, 40),
      events: events.filter((e) => {
        const k = `${e.role}:${e.name}`;
        return seen.has(k) ? false : (seen.add(k), true);
      }),
    };
  }
}
