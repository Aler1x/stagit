import * as vscode from "vscode";
import { StashCommands } from "./stash/commands";
import { StashContentProvider } from "./stash/contentProvider";
import { GitService } from "./stash/git";
import { StashTreeProvider } from "./stash/tree";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Stagit");
  const git = new GitService(output);
  const tree = new StashTreeProvider(git);
  const content = new StashContentProvider(git);
  const commands = new StashCommands(git, tree, content, output);

  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider("stagit.stashes", tree),
    vscode.workspace.registerTextDocumentContentProvider("stagit-stash", content),
  );

  commands.register(context);
}

export function deactivate(): undefined {
  return undefined;
}
