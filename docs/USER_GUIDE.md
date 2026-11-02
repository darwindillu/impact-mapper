# Impact Mapper user guide

Impact Mapper shows what a change will touch in a codebase before anyone writes code. You describe a feature, or list the files a branch changed. It shows which screens, APIs, data, permissions, notifications and tests are involved, and how they connect.

Use it to:
- **Developers:** see the blast radius of a ticket or a pull request before starting or approving it.
- **QA:** find the screens and flows to retest, and get test cases to start from.
- **Product owners and analysts:** find the questions a requirement leaves open, and draft an FRD.

You don't need to install anything to use the web app. You need the command-line tool only for CI, git history, or very large repositories.

---

## Contents

1. [Quick start (2 minutes)](#1-quick-start-2-minutes)
2. [Load your codebase](#2-load-your-codebase)
3. [Map a requirement](#3-map-a-requirement)
4. [Map changed files (a branch or pull request)](#4-map-changed-files-a-branch-or-pull-request)
5. [Read the results](#5-read-the-results)
6. [Before you build: questions, edge cases, tests, risks](#6-before-you-build-questions-edge-cases-tests-risks)
7. [Draft an FRD](#7-draft-an-frd)
8. [Use Claude (optional)](#8-use-claude-optional)
9. [Import from and post to tickets](#9-import-from-and-post-to-tickets)
10. [Share a result](#10-share-a-result)
11. [Command line, GitHub Action, VS Code](#11-command-line-github-action-vs-code)
12. [What leaves your computer](#12-what-leaves-your-computer)
13. [FAQ](#13-faq)
14. [Troubleshooting](#14-troubleshooting)
15. [Hosting it for your team](#15-hosting-it-for-your-team)

---

## 1. Quick start (2 minutes)

1. Open the app. It starts with a sample codebase (a React frontend with a Java backend) and a sample requirement.
2. Click **Map the impact**.
3. Click any dot in the circle, or any file in **What it touches**. The panel below the circle says why that file is included, for example "CommentInput.js imports agent.js".
4. Open the tabs under **Before you build**: Gap questions, Edge cases, Test cases, Risks.
5. Click **Copy as Markdown** and paste the result into a ticket or a chat.

Then try it on your own code ([section 2](#2-load-your-codebase)).

---

## 2. Load your codebase

You have three ways to load code:

| Way | When to use it | How |
|---|---|---|
| **Choose folder** | The usual way | Click **Choose folder** and pick the repository folder; a monorepo root works. Allow the browser to view the files. |
| **Upload map** | Someone already scanned the code, or you saved a scan | Click **Upload map** and choose the `.json` map file. |
| **Command line** | CI, very large repositories, or to include git history | See [section 11](#11-command-line-github-action-vs-code), then use **Upload map**. |

What to know about **Choose folder**:
- **Nothing is uploaded.** The files are read and parsed inside your browser.
- **Use Chrome or Edge.** They skip `node_modules`, build output and hidden folders without reading them, so even a large repository takes seconds. Other browsers list every file first, which is slower, and their prompt may say "upload" even though nothing is uploaded.
- **Save the scan.** After it finishes, click **Save map** to keep the result. Next time use **Upload map** and skip the scan.
- **Rescan after big changes.** The map is a snapshot of the code at the time of the scan.

**Supported languages:** TypeScript, JavaScript, Python, Java, Kotlin, Scala, Go, Rust, C#, PHP, Ruby, and Vue and Svelte components. Files in other languages are ignored.

---

## 3. Map a requirement

1. Keep **Feature requirement** selected.
2. Type or paste the requirement, the way the ticket says it. A few sentences is enough. Longer is fine, up to 4,000 characters.
3. Click **Map the impact**. Ctrl+Enter also works.

Tips for better results:
- **Use the product's own words:** "invoice", not "bill"; "work order", not "job".
- **Quote messages and labels you see in the app,** like `"Assignee is required"` or `"Share"`. The tool searches the app's own text, and a quoted message is the strongest clue it gets.
- **Name the screen or module** if you know it: "the customer edit drawer".
- **If the code uses different words** from the requirement, tick **Also search related words (Claude)**. See [section 8](#8-use-claude-optional).

---

## 4. Map changed files (a branch or pull request)

1. Select **Changed files**.
2. Paste the changed file paths, one per line. Any of these works:
   - The output of `git diff --name-only origin/main...HEAD`.
   - The file list of a pull request.
   - Or paste a GitHub pull request link into **Import from a ticket** and click **Import**. Its changed files are filled in for you.
3. Click **Map the impact**.

Paths can be relative to any folder. The tool matches `src/app/x.ts` to `apps/web/src/app/x.ts`. Files it can't find, such as deleted files, docs and images, are listed under "Not in the map".

---

## 5. Read the results

### The summary

| Counter | Meaning |
|---|---|
| **Directly involved** (or **changed files**) | Files the requirement is about, or files the branch changed. |
| **Could break** (downstream) | Files that depend on the direct ones: they import them, call their API, use their data, or listen for their events. A change can break these. |
| **Relied on** (upstream) | Files the direct ones depend on. These usually don't change, but the feature may need something new from them. |
| **Loosely linked** (counted, not listed) | Files connected only through shared plumbing, such as an API client every screen imports. They are counted so you know they exist, but listing them would bury the useful files. |

### The circle

- **Feature** sits in the middle.
- **The inner ring** is the direct matches.
- **The outer rings** are files linked through the code.
- **Colours are areas:** screens, APIs, permissions, notifications, reports, data, logic, config.
- **Hollow dots** are upstream.
- **Dashed lines** are API calls, from frontend to backend.
- **Clicking a dot** highlights its chain back to the requirement.

### The list ("What it touches")

The list groups files by area. On each row:
- **The badge** is the relation: direct, could break or relied on.
- **The chips above the list** show only one relation; **Find a file** searches by name.
- **Tests are folded** under "Show N test files to run", to keep the list readable.
- **The grey line** is the folder.
- **"often fixed"** means the file needed many bug fixes in the last 12 months. It appears only when the map includes git history.

### The detail panel

Click a file to see:
- **Why it's in the list.** For a direct match, the words it matched. For any other file, the chain of links, for example "Comment.js imports agent.js → agent.js calls POST /articles/:p/comments in CommentsApi.java".
- **What the file contains:** the routes it serves or calls, and the main names it defines.

### How much to trust it

The tool reads the code's structure. It doesn't run the code or guess.

- **When it lists a file, the link is real:** an import, a route match, a shared table or field.
- **It can miss files.** A file may use words the requirement doesn't, or connect in ways code can't show, such as a URL built from variables at run time.

Treat the result as a strong starting point, not a guarantee. Check the direct matches first.

---

## 6. Before you build: questions, edge cases, tests, risks

The section under the results lists the following, each based on what the graph found:

- **Gap questions:** decisions the requirement leaves open. For example, "Who is allowed to do this? Access is decided in AuthorizationService.java."
- **Edge cases:** situations to handle, such as old records without a new field, empty and error states, and two people editing at once.
- **Test cases:** steps and an expected result to start from. When existing tests cover the area, they're listed to run.
- **Risks:** for example, an API called from several places, files shared by much of the code, files that often needed fixes, or no tests at all.

Without Claude these come from rules about the graph. With **Explain with Claude** ([section 8](#8-use-claude-optional)), Claude rewrites them for your specific requirement.

---

## 7. Draft an FRD

After mapping, click **Draft FRD**. You get a functional requirement document with 11 sections:
1. Overview
2. Scope
3. Affected areas
4. Functional requirements
5. Data changes
6. Permissions
7. Notifications
8. Edge cases
9. Open questions
10. Test plan
11. Risks and rollout

- **The first draft comes from the graph.** It fills in what the code shows and marks with *italics* what a person must decide.
- **Write with Claude** produces a complete draft from the same information. See [section 8](#8-use-claude-optional).
- **You can edit it** in the box, then **Copy** it or **Download .md**.

Always review an FRD before sharing it. It's a draft.

---

## 8. Use Claude (optional)

Three features use Claude, Anthropic's AI model:

| Feature | Where | What it does |
|---|---|---|
| **Related words** | The **Also search related words** checkbox | Suggests the words your codebase uses for the requirement's concepts, for example `favorite` for "bookmark". It picks only from words that exist in your code. |
| **Explain with Claude** | **Before you build** | Rewrites the questions, edge cases, tests and risks for your requirement, and marks each file "must change", "may change" or "verify only". |
| **Write with Claude** | **Draft FRD** | Writes the full FRD. |

**Claude sees:**
- the requirement;
- the list of files the graph found, with their names, routes, data names and why they're linked.

It never sees your source code. Anything it says about a file the graph didn't find is removed, so it can't invent screens or endpoints.

**An API key is needed**, from either source:
- **The site's key,** if whoever hosts the app set one. It comes with a small daily allowance per person.
- **Your own key:** open **Settings**, paste an Anthropic API key in **Claude**, and click **Save**. Your company may give you one. Otherwise create one at console.anthropic.com, and set a monthly spend limit there first.

Each Claude request takes a few seconds to about a minute.

---

## 9. Import from and post to tickets

Paste a ticket into **Import from a ticket** and click **Import**. Its title and description become the requirement. A pull request also fills in its changed files.

| Service | What to paste | What you need in Settings |
|---|---|---|
| GitHub issue | `https://github.com/org/repo/issues/123` | Nothing for public repositories. A token for private ones. |
| GitHub pull request | `https://github.com/org/repo/pull/45` | Same as an issue. The changed files are imported too. |
| Jira Cloud | `https://yourcompany.atlassian.net/browse/ABC-12`, or `ABC-12` with the site set | Site, email, API token |
| Plane | `https://app.plane.so/workspace/browse/ABC-12/`, or `ABC-12` with the workspace set | Workspace slug, API key, and the API address if Plane is self-hosted |

After mapping, **Post to ticket** adds the impact map to the ticket as a comment. That needs a token with permission to comment.

How to get each token:
- **GitHub:**
  1. Go to GitHub, then Settings → Developer settings → Personal access tokens → Fine-grained tokens.
  2. Give it access to the repository.
  3. Grant *Issues: Read* and *Pull requests: Read*. To post, grant *Issues: Read and write*.
- **Jira:**
  1. Go to id.atlassian.com → Security → Create and manage API tokens.
  2. Use it with the email you sign in to Jira with.
- **Plane:** in Plane, go to Workspace settings → API tokens.

Tokens stay in your browser tab until you close it, and go only to the service they belong to.

---

## 10. Share a result

**Copy share link** copies a link to the current result.

- **For a sample codebase,** the link holds just the input. It reopens and reruns.
- **For your own codebase,** the link holds the result itself: file paths, links and the checklist. Whoever opens it sees the result read-only, without needing the codebase.

The result travels inside the link (after the `#`), so it isn't stored on any server. Share links for your own code only with people allowed to see that codebase's structure, because they include file paths. They never include source code.

---

## 11. Command line, GitHub Action, VS Code

### Command line

From the Impact Mapper folder:

```bash
npm install
npm run build:cli

# Scan a repository into a map file (add --name "Our app" to label it)
node bin/impact-mapper.mjs scan /path/to/repo -o our-app-map.json

# What does my branch change, and what could that break?
node bin/impact-mapper.mjs diff --repo /path/to/repo --base origin/main
```

Notes:
- **Git history:** when the folder is a git repository, `scan` adds 12 months of change history, which powers the "often fixed" flags. `--no-git` skips it.
- **`diff` output:** Markdown, or JSON with `--format json`. `-o file` writes it to a file.
- **`--cards`:** adds a one-line Claude summary of the most connected files. It needs `ANTHROPIC_API_KEY`, and it is the only option that sends source code, those files' code, to Claude.

### GitHub Action

To get the impact as a comment on every pull request, copy `examples/impact-mapper.yml` into `.github/workflows/` of your repository. Each push updates the same comment instead of adding new ones.

### VS Code

Install the extension built from `vscode/`; [section 15](#15-hosting-it-for-your-team) covers building it. Then run these commands from the Command Palette:
- **Impact Mapper: Map a requirement**
- **Impact Mapper: Map my changes**
- **Impact Mapper: Rescan the workspace**

---

## 12. What leaves your computer

| Action | What is sent | To where |
|---|---|---|
| Choose folder, Upload map, Map the impact, Draft FRD (without Claude), Copy as Markdown | Nothing | n/a |
| Explain with Claude, Write with Claude, related words | The requirement and the found files' names, routes and links. No source code. | Anthropic, through the app's server |
| Import from or post to a ticket | The ticket link, your token, and the comment text when posting | GitHub, Atlassian or Plane, through the app's server |
| Copy share link | Nothing is sent. The result is inside the link you share. | Whoever you give the link to |
| CLI `--cards` | The code of the most connected files | Anthropic |

Keys and tokens you enter in Settings are kept only in that browser tab, and are forgotten when you close it. The server passes them on and doesn't store them.

---

## 13. FAQ

**Do I need to install anything?**
No. Use the web app with Choose folder. You need the command line only for CI, git history, or very large repositories.

**Is my code uploaded?**
No. Folder scans run inside your browser, and Claude features receive only names and links. See [section 12](#12-what-leaves-your-computer).

**Why does Codebase only show samples?**
A browser can't see your disk until you pick a folder. Click **Choose folder**, or **Upload map** if you have a saved scan.

**Why is a file I expected missing?**
The requirement may not share any words with it, or the link may be one code can't show. Try:
- using the module's or screen's own name;
- quoting a message or label from that screen;
- ticking **Also search related words**;
- mapping the changed files instead, if the change already exists.

**Why is an unrelated file listed?**
It shares words with the requirement, or depends on a matched file. Click it: the panel says exactly why. A file reached only through an import, with no matching words, is usually low risk.

**What do "directly involved", "could break" and "relied on" mean?**
See [section 5](#5-read-the-results). In short: what it's about, what could break, and what it relies on. Older docs call the last two downstream and upstream.

**What does "loosely linked, not listed" mean?**
These files connect to the change only through shared plumbing, such as an API client imported by every screen. They're counted, not listed.

**Why is there no "often fixed" flag?**
That flag needs git history, which only the command-line scan can read. A browser can't run git.

**Can I use it without Claude?**
Yes. Everything except the three Claude buttons works without it.

**How current is the map?**
It reflects the code when it was scanned. Rescan after significant changes.

**Can it read my private GitHub, Jira or Plane tickets?**
Yes, with a token in Settings ([section 9](#9-import-from-and-post-to-tickets)).

**Who can see a share link?**
Anyone you send it to. It includes file paths for your own codebase, never source code.

---

## 14. Troubleshooting

| You see | What it means | What to do |
|---|---|---|
| "No source files found in …" | The folder has no files in a supported language, or you picked a subfolder such as `docs` | Pick the repository root. |
| The scan seems stuck on "Reading the folder…" | The browser is listing a very large folder; Firefox lists `node_modules` too | Use Chrome or Edge, or scan with the command line and upload the map. |
| "… is not a system map" | The uploaded file isn't an Impact Mapper map | Upload the `.json` from **Save map** or from `impact-mapper scan`. |
| "Nothing in this codebase matched" | No word of the requirement appears in the code | Use the product's names, quote UI text, or tick **Also search related words**. |
| "Not in the map: …" (changed files) | Those files are deleted, docs, images, or in an unsupported language | Nothing to do: they can't affect code links. |
| "AI is not set up on this site" | No Anthropic key is configured | Add your own key in **Settings → Claude**. |
| "That Anthropic API key was rejected" | The key is wrong, revoked or out of credit | Check it at console.anthropic.com and paste it again. |
| "The free demo allows N of these a day" | You used the site's daily allowance | Add your own key in Settings, or try again tomorrow. |
| "Claude is rate-limiting this key right now" | Too many requests in a short time | Wait a minute and retry. |
| "Related words are unavailable (…)" | The related-words step failed; the reason is in brackets | The map still ran with your own words. Fix the cause shown, then map again. |
| "… refused the request. Check the token in Settings" | The ticket token is missing, wrong, or lacks access | Check the token's permissions ([section 9](#9-import-from-and-post-to-tickets)). |
| "… could not find that ticket" | Wrong link, or a private ticket without a token | Check the link. Add a token for private repositories or projects. |
| "For a bare key like ABC-123, set your Jira site or Plane workspace" | A key alone doesn't say which service it belongs to | Paste the full link, or fill in the site or workspace in Settings. |
| "Posting to GitHub needs a GitHub token" | Posting always needs a token | Add a token with *Issues: Read and write*. |
| "The browser blocked copying to the clipboard" | The page lacks clipboard permission | Allow clipboard access for the site, or select and copy the text by hand. |
| A share link opens the start page | The link was cut off when it was pasted | Copy it again and paste the whole link. Long links can be split by some chat apps. |

If something else goes wrong, note what you did and the exact message, and send it to whoever maintains Impact Mapper in your team.

---

## 15. Hosting it for your team

For the person who runs Impact Mapper for others.

**Run locally:**

```bash
npm install
npm run dev          # http://localhost:5173
```

**Deploy** to Vercel or any host that runs Node functions:
- the `api/` folder holds the functions;
- `npm run build` builds the web app into `dist/`.

**Environment variables:**

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | The site's Claude key. Without it, people use their own keys from Settings. | none |
| `DEMO_REQUESTS_PER_DAY` | Claude explanations and FRDs per person per day on the site's key. Related words get four times this. | 5 |

Set a monthly spend limit on the site's key in the Anthropic console. The per-person allowance is best effort and resets when the server restarts.

**Share a map with the team:** scan the main repository with the CLI, which includes git history, and share the map file. Everyone can then **Upload map** without scanning.

**Checks before releasing a change to the tool:**

```bash
npm test
npm run build
npx eslint .
```

`npm run eval` measures accuracy against past tickets; see the README.

**Build the VS Code extension:**

```bash
npm run build:vscode
cd vscode && npm run package   # creates a .vsix
```

Install the `.vsix` with *Extensions → … → Install from VSIX*.
