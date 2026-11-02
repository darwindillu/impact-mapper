# Impact Mapper

Paste a feature requirement and see every screen, API, data store, permission and test it will touch in your codebase, before anyone writes code. It works on any stack, because it reads the code's structure instead of guessing from the text.

The built-in demo shows one React frontend against three different backends (Java/Spring Boot, Python/Django, Go/Gin), all from the public [RealWorld](https://github.com/gothinkster/realworld) project.

## How it works

1. **Scan.** The CLI parses every file with [tree-sitter](https://tree-sitter.github.io/) and records what each one imports, defines, serves, calls and stores. Supported: TypeScript, JavaScript, Python, Java, Go, C#, PHP, Ruby.
2. **Link.** Three kinds of link make one graph across languages:
   - **Imports** connect files inside a codebase. Relative paths, `tsconfig` aliases, monorepo packages, Python modules, Java packages, Go modules, C# namespaces and PHP `use` are all resolved.
   - **API routes** connect a screen's call (`agent.get("/articles/:slug")`) to the controller that serves it (`@GetMapping("/articles/{slug}")`, `path("articles/<slug>")`, `router.GET("/:slug")`). Route syntax is normalized across frameworks.
   - **Shared names** link files that use the same table or collection, or emit and listen for the same event.
3. **Map.** The requirement's words, weighted by how rare they are in the codebase, find the files it is about. From those files the graph shows:
   - **downstream:** what depends on them and could break;
   - **upstream:** what they rely on.

   Shared plumbing, such as one API client imported by every screen, is counted but not listed.
4. **Explain (optional).** Claude turns the result into gap questions, edge cases, test cases and risks. It sees only the structure, never the source. Every file it cites must be one the graph found; anything else is dropped.

Without AI, the app still builds a checklist from the graph. For example: "Who is allowed to do this? Access is decided in AuthorizationService.java".

## Use it on your code

In the app, click **Choose folder** and pick your repo, a monorepo root works. The files are parsed in your browser and nothing is uploaded. In Chrome and Edge, `node_modules`, build output and hidden folders are skipped without being read. **Save map** keeps the result, so next time you can use **Upload map** instead of scanning again.

The same scan runs from the command line, for CI or for very large repos:

```bash
npm install
npm run build:cli
node bin/impact-mapper.mjs scan ../my-frontend ../my-backend -o system-map.json
```

Options:
- `--name "My app"`: the name shown in the app.
- `--cards`: adds a one-line AI summary for the most connected files, so files whose names don't say what they do still match. It needs `ANTHROPIC_API_KEY` and sends those files' code to Claude. Summaries are cached by content hash, so a rescan only pays for changed files.

## Run the app

```bash
npm install
npm run dev
```

AI explanations need an Anthropic API key, from either source:
- **The site's key:** set `ANTHROPIC_API_KEY` in `.env.local`. It is used by the API route only and never sent to the browser. Visitors get `DEMO_REQUESTS_PER_DAY` explanations a day (default 5).
- **A visitor's own key:** entered in Settings, kept in that browser tab, and sent with each request.

## Project layout

| Path | What it is |
|---|---|
| `scanner/` | CLI: tree-sitter extraction, import resolution, route matching |
| `shared/` | System map types, the graph analysis, the rule-based checklist, the Claude call |
| `server/`, `api/` | `POST /api/analyze` (Vercel function; the same handler runs in `vite dev`) |
| `src/` | React app |
| `tests/` | `npm test` |

## Limits

- **Dynamic links aren't seen.** Links built at run time can't be read from the code, such as a URL assembled from variables or a route registered in a loop.
- **Route prefixes set elsewhere are guessed.** A prefix set in another file (Gin's `Group("/users")`, Express's `use("/api", router)`) is matched through the router's folder name, at lower confidence.
- **Matching starts from words.** A requirement that says "bookmark" won't find code that calls it "favorite". Scanning with `--cards` and using the Claude explanation narrow that gap.
- **The demo quota is best effort.** It is per server instance. The real safeguard is a spend limit on the API key.
