# Impact Mapper

Paste a feature requirement, or the files a branch changed, and see every screen, API, data store, permission and test it touches in your codebase. It works on any stack, because it reads the code's structure instead of guessing from the text.

The built-in demo shows one React frontend against three different backends (Java/Spring Boot, Python/Django, Go/Gin), all from the public [RealWorld](https://github.com/gothinkster/realworld) project.

**Using it for the first time?** Read the [user guide](docs/USER_GUIDE.md). It covers every feature, how to read results, getting GitHub, Jira and Plane tokens, what leaves your computer, an FAQ and troubleshooting. The app's **Help** button has the short version, and each **?** next to a control explains it.

## What it does

- **Maps a requirement.** The requirement's words and any UI text it quotes ("Assignee is required") find the files it is about. The graph then shows:
  - **downstream:** what depends on those files and could break;
  - **upstream:** what they rely on.
- **Maps a diff.** Paste `git diff --name-only`, import a pull request, or run `impact-mapper diff`. It shows what the changed files could break.
- **Builds a checklist from the graph.** Gap questions, edge cases, test cases and risks. For example: "Who is allowed to do this? Access is decided in AuthorizationService.java".
- **Flags fragile files.** With git history, files that needed many fixes in the last year are marked as risks.
- **Drafts an FRD.** A functional requirement document with scope, affected areas, requirements, data, permissions, notifications, edge cases, open questions, test plan and risks. It is built from the graph, or written by Claude.
- **Works with tickets.** Import a GitHub issue or pull request, a Jira issue or a Plane work item, and post the impact map back as a comment.
- **Shares a result.** "Copy share link" puts the result in the link itself, so no server stores it.
- **Asks Claude (optional).**
  - It suggests the words your codebase uses for the requirement's concepts, such as `favorite` for "bookmark". It picks only from the code's own vocabulary.
  - It explains the impact and drafts the FRD.
  - It sees only the structure, never the source, and anything it says about a file the graph didn't find is dropped.

## How it works

1. **Scan.** Every file is parsed with [tree-sitter](https://tree-sitter.github.io/). Supported: TypeScript, JavaScript, Python, Java, Kotlin, Scala, Go, Rust, C#, PHP, Ruby, and Vue and Svelte components. The scan records what each file imports, defines, serves, calls, stores, declares as fields and shows as UI text.
2. **Link.** Four kinds of link make one graph across languages:
   - **Imports** connect files inside a codebase. Resolved: relative paths, `tsconfig` aliases, monorepo packages, Python modules, Java/Kotlin packages, Go modules, Rust `use`, C# namespaces, PHP `use`.
   - **API routes** connect a screen's call (`agent.get("/articles/:slug")`) to the controller that serves it (`@GetMapping("/articles/{slug}")`, `path("articles/<slug>")`, `router.GET("/:slug")`).
     - Route syntax is normalized across frameworks.
     - Prefixes set in another file are followed: Express `use()`, Django `include()`, Gin groups.
   - **Fields** link a file that reads `customer.customerEmail` to the model or DTO that declares it, even across stacks.
   - **Shared names** link files that use the same table or event.
3. **Map.** Matches are weighted by how rare a word is in the codebase. Shared plumbing, such as an API client every screen imports, is counted but not listed.

## Use it on your code

- **In the app:** click **Choose folder** and pick your repo; a monorepo root works.
  - The files are parsed in your browser and nothing is uploaded.
  - In Chrome and Edge, `node_modules`, build output and hidden folders are skipped without being read.
  - **Save map** keeps the result for next time.
- **From the command line**, for CI, very large repos, or to add git history:

```bash
npm install
npm run build:cli
node bin/impact-mapper.mjs scan ../my-repo -o system-map.json   # then Upload map in the app
node bin/impact-mapper.mjs diff --repo ../my-repo --base origin/main
```

`scan` options:
- `--name`: the name shown in the app.
- `--no-git`: skip the 12-month change history.
- `--cards`: adds a one-line Claude summary for the most connected files, so files whose names don't say what they do still match.
  - Needs `ANTHROPIC_API_KEY`.
  - Sends those files' code to Claude.
  - Cached by content hash, so a rescan only pays for changed files.

`diff` options:
- `--base <ref>`: compare the branch with this ref; without it, uncommitted changes are used.
- `--files a,b`: use these files instead of asking git.
- `--map file.json`: use a saved map instead of scanning.
- `--format md|json`, `-o file`.

## On every pull request (GitHub Action)

Copy [`examples/impact-mapper.yml`](examples/impact-mapper.yml) into `.github/workflows/` of the repository to map. The action:
- comments the impact of each pull request;
- updates its own comment on later pushes instead of adding new ones;
- writes the same report to the job summary.

## In VS Code

The extension in [`vscode/`](vscode/) adds three commands:
- **Map a requirement**
- **Map my changes**
- **Rescan the workspace**

The result opens as a Markdown preview with a picker to jump to each file. Build it with `npm run build:vscode`, then `cd vscode && npm run package`.

## Run the app

```bash
npm install
npm run dev
```

Claude features need an Anthropic API key, from either source:
- **The site's key:** set `ANTHROPIC_API_KEY` in `.env.local`. It is used by the API only and never sent to the browser.
  - Visitors get `DEMO_REQUESTS_PER_DAY` explanations and FRDs a day (default 5).
  - Related-word lookups get four times that.
- **A visitor's own key and ticket tokens:** entered in Settings, kept in that browser tab, and sent only with the requests that need them.

## Measuring accuracy

`npm run eval -- <map.json> <cases.json> <repo>` replays real tickets. Each case is `{ ticket, commit, requirement }`, and the files the commit changed are the answer key. It reports:
- **recall@10:** share of changed files in the top 10;
- **recall@all:** share anywhere in the result;
- **hit@5:** whether any changed file is in the top 5.

On 12 tickets from a 2,200-file TypeScript monorepo, with words only and no Claude:
- recall@10 is 27% (up from 20% at v1);
- recall@all is about 50–58%, depending on borderline entries;
- hit@5 is 6 of 12.

The Claude related-word step is meant to raise these; it has not been measured yet.

## Project layout

| Path | What it is |
|---|---|
| `scanner/` | Parsing, import resolution, route and field linking, git history, the CLI (`scan`, `diff`) |
| `shared/` | Map types, the graph analysis, the checklist, the FRD draft, Markdown, the Claude calls |
| `server/`, `api/` | `/api/analyze`, `/api/frd`, `/api/expand`, `/api/ticket` (Vercel functions; the same handler runs in `vite dev`) |
| `src/` | React app, including the in-browser folder scan (a web worker) |
| `vscode/` | VS Code extension |
| `action.yml` | GitHub Action |
| `tests/` | `npm test` |

## Tested, and not yet

**Tested here:**
- scanning all supported languages on fixtures and the samples, in Node and in the browser;
- diff mode;
- the FRD draft;
- share links, both sample and snapshot;
- GitHub issue and pull request import against the live API;
- every "missing key or token" path.

**Not tested yet**, because it needs accounts or a host:
- real Claude responses;
- Jira and Plane, both reading and posting;
- posting to GitHub;
- the GitHub Action on GitHub;
- the VS Code extension inside VS Code (its logic is tested outside it);
- the Vercel deploy.

## Limits

- **Dynamic links aren't seen.** Links built at run time can't be read from the code, such as a URL assembled from variables or a route registered in a loop.
- **Some frameworks are linked through other signals.**
  - Java reads fields through getters, so field links come mostly from TypeScript, Python, Go and Rust.
  - Kotlin annotations at the top of a file parse loosely, so class-level route prefixes there may be missed.
  - Swift isn't supported: its grammar ran out of memory.
- **Word matching misses some files.** A requirement that never names a file's concept misses it. Related words via Claude, `--cards`, and quoting the UI text narrow that gap.
- **The demo quota is best effort.** It is per server instance; the real safeguard is a spend limit on the API key.
