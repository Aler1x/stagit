import * as vscode from "vscode";
import type { GitService } from "./git";
import type { StashFile } from "./types";

export class StashContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly git: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const repoPath = params.get("repo") ?? "";
    const revision = params.get("revision") ?? "";
    const fallbackRevision = params.get("fallbackRevision");
    const filePath = params.get("path") ?? "";
    const empty = params.get("empty") === "true";

    if (empty) return "";

    try {
      return await this.git.getFileContent(repoPath, revision, filePath);
    } catch (error) {
      if (fallbackRevision === null) throw error;
      return this.git.getFileContent(repoPath, fallbackRevision, filePath);
    }
  }

  createFileUri(file: StashFile, side: "before" | "after"): vscode.Uri {
    const filePath = side === "before" ? (file.oldPath ?? file.path) : file.path;
    const revision = side === "before" ? `${file.stashRef}^1` : file.stashRef;
    const fallbackRevision =
      side === "after" && file.status === "added" ? `${file.stashRef}^3` : undefined;
    const empty =
      (side === "before" && file.status === "added") ||
      (side === "after" && file.status === "deleted");
    const query = new URLSearchParams({
      repo: file.repoPath,
      revision,
      path: filePath,
      empty: String(empty),
    });
    if (fallbackRevision !== undefined) query.set("fallbackRevision", fallbackRevision);

    return vscode.Uri.from({
      scheme: "stagit-stash",
      path: `/${filePath.replaceAll("\\", "/")}`,
      query: query.toString(),
    });
  }
}
