// VS Code commands: map a requirement or your current changes against the
// open workspace. The result opens as a Markdown preview, and a picker jumps
// to any file in it. Everything runs locally; nothing is sent anywhere.

import * as path from "node:path";
import * as vscode from "vscode";
import type { SystemMap } from "../../shared/map.ts";
import { mapChanges, mapRequirement, scanWorkspace, type Mapped } from "./run.ts";

let cached: { folder: string; map: SystemMap } | undefined;

async function getMap(context: vscode.ExtensionContext, force = false): Promise<{ folder: string; map: SystemMap } | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    vscode.window.showWarningMessage("Open a folder first: Impact Mapper maps the code in your workspace.");
    return undefined;
  }
  if (cached && cached.folder === folder && !force) return cached;
  const grammarDir = path.join(context.extensionPath, "dist", "grammars");
  const map = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Impact Mapper: scanning the workspace", cancellable: false },
    (progress) =>
      scanWorkspace(folder, grammarDir, (done, total) => {
        if (done % 100 === 0 || done === total) progress.report({ message: `${done} of ${total} files` });
      }),
  );
  cached = { folder, map };
  return cached;
}

async function show(folder: string, mapped: Mapped) {
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: mapped.markdown });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  await vscode.commands.executeCommand("markdown.showPreview", doc.uri);

  const items = mapped.result.nodes
    .filter((n) => n.kind === "file")
    .map((n) => ({ label: path.basename(n.id), description: `${n.relation} · ${n.area}`, detail: n.id, id: n.id }));
  if (!items.length) return;
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Open a file from the impact map", matchOnDetail: true });
  if (pick) await vscode.window.showTextDocument(vscode.Uri.file(path.join(folder, pick.id)));
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("impactMapper.mapRequirement", async () => {
      const requirement = await vscode.window.showInputBox({
        title: "Impact Mapper",
        prompt: "Describe the feature, the way the ticket says it",
        placeHolder: "Let users edit their own comments on an article",
        ignoreFocusOut: true,
      });
      if (!requirement?.trim()) return;
      const ws = await getMap(context);
      if (!ws) return;
      const mapped = mapRequirement(ws.map, requirement);
      if (!mapped.result.nodes.length) {
        vscode.window.showInformationMessage("Nothing in this workspace matched. Try the names the code uses.");
        return;
      }
      await show(ws.folder, mapped);
    }),

    vscode.commands.registerCommand("impactMapper.mapChanges", async () => {
      const ws = await getMap(context);
      if (!ws) return;
      const base = await vscode.window.showInputBox({
        title: "Impact Mapper",
        prompt: "Compare with a branch (e.g. origin/main), or leave empty for uncommitted changes",
        ignoreFocusOut: true,
      });
      if (base === undefined) return; // cancelled
      try {
        const mapped = mapChanges(ws.map, ws.folder, base.trim() || undefined);
        if (!mapped.files.length) {
          vscode.window.showInformationMessage("No changed files.");
          return;
        }
        await show(ws.folder, mapped);
      } catch (e) {
        vscode.window.showErrorMessage(`Impact Mapper could not read the changes from git: ${e instanceof Error ? e.message : e}`);
      }
    }),

    vscode.commands.registerCommand("impactMapper.rescan", async () => {
      const ws = await getMap(context, true);
      if (ws) vscode.window.showInformationMessage(`Impact Mapper: scanned ${ws.map.files.length} files.`);
    }),
  );
}

export function deactivate() {}
