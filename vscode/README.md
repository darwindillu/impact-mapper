# Impact Mapper for VS Code

See which screens, APIs, data, permissions and tests a feature, or your current changes, will touch, in any stack.

## Commands

- **Impact Mapper: Map a requirement.** Type the feature the way the ticket says it. The impact map opens as a Markdown preview, and a picker jumps to any file in it.
- **Impact Mapper: Map my changes.** Maps what your uncommitted changes, or your branch against a base such as `origin/main`, could break.
- **Impact Mapper: Rescan the workspace.** The first command scans the workspace once per session; run this after large changes.

Everything runs locally. The code is parsed with tree-sitter inside the extension and nothing is sent anywhere.

## Build

```bash
npm install          # in the repository root
npm run build:vscode # bundles to vscode/dist
cd vscode && npm run package
```
