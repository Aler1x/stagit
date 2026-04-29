import * as path from "node:path";
import * as vscode from "vscode";
import type { GitError, GitService } from "./git";
import type { StashContentProvider } from "./contentProvider";
import type { StashTreeProvider } from "./tree";
import type { FileNode, Stash, StashFile, StashNode, StashOperation } from "./types";

type OperationPick = vscode.QuickPickItem & { operation: StashOperation };

export class StashCommands {
  constructor(
    private readonly git: GitService,
    private readonly tree: StashTreeProvider,
    private readonly content: StashContentProvider,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("stagit.stash", () => this.stash()),
      vscode.commands.registerCommand("stagit.stashStaged", () => this.stash("push")),
      vscode.commands.registerCommand("stagit.stashUnstaged", () => this.stash("pushUnstaged")),
      vscode.commands.registerCommand("stagit.refreshStashes", () => this.tree.refresh()),
      vscode.commands.registerCommand("stagit.applyStash", (node) => this.apply(node)),
      vscode.commands.registerCommand("stagit.popStash", (node) => this.pop(node)),
      vscode.commands.registerCommand("stagit.dropStash", (node) => this.drop(node)),
      vscode.commands.registerCommand("stagit.previewStash", (node) => this.preview(node)),
      vscode.commands.registerCommand("stagit.openStashFile", (node) => this.openFile(node)),
      vscode.commands.registerCommand("stagit.applyStashFileChanges", (node) =>
        this.applyFileChanges(node),
      ),
      vscode.commands.registerCommand("stagit.restoreStashFileChanges", (node) =>
        this.restoreFileChanges(node),
      ),
    );
  }

  private async stash(defaultOperation?: StashOperation): Promise<void> {
    await this.run(async () => {
      const repoPath = await this.git.getBestRepository();
      if (repoPath === undefined) {
        void vscode.window.showWarningMessage("No Git repository found.");
        return;
      }

      const message = await vscode.window.showInputBox({
        title: "Stagit",
        prompt: "Enter stash name",
        placeHolder: "WIP changes",
      });
      if (message === undefined) return;

      const operation = await pickOperation(defaultOperation);
      if (operation === undefined) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Creating stash...",
          cancellable: false,
        },
        () => this.git.stash(repoPath, operation, message || "WIP changes"),
      );

      this.tree.refresh();
    });
  }

  private async apply(node: unknown): Promise<void> {
    const stash = getStash(node);
    if (stash === undefined) return;

    await this.run(async () => {
      const choice = await pickStashAction(stash, "Apply");
      if (choice === "Preview") return this.preview(node);
      if (choice !== "Apply") return;

      await this.git.applyStash(stash);
      this.tree.refresh();
    });
  }

  private async pop(node: unknown): Promise<void> {
    const stash = getStash(node);
    if (stash === undefined) return;

    await this.run(async () => {
      const choice = await pickStashAction(stash, "Pop");
      if (choice === "Preview") return this.preview(node);
      if (choice !== "Pop") return;

      await this.git.popStash(stash);
      this.tree.refresh();
    });
  }

  private async drop(node: unknown): Promise<void> {
    const stash = getStash(node);
    if (stash === undefined) return;

    await this.run(async () => {
      const confirm = { title: "Drop Stash" };
      const result = await vscode.window.showWarningMessage(
        `Drop ${stash.ref} (${stash.message || "stash"})?`,
        { modal: true },
        confirm,
      );
      if (result !== confirm) return;

      await this.git.dropStash(stash);
      this.tree.refresh();
    });
  }

  private async preview(node: unknown): Promise<void> {
    const stash = getStash(node);
    if (stash === undefined) return;

    await this.run(async () => {
      const files = await this.git.listStashFiles(stash.repoPath, stash.ref);
      if (files.length === 0) {
        void vscode.window.showInformationMessage("No changed files in this stash.");
        return;
      }

      await vscode.commands.executeCommand(
        "vscode.changes",
        `${stash.ref}: ${stash.message || "Stash Changes"}`,
        files.map((file) => [
          vscode.Uri.file(path.join(file.repoPath, file.path)),
          this.content.createFileUri(file, "before"),
          this.content.createFileUri(file, "after"),
        ]),
      );
    });
  }

  private async openFile(node: unknown): Promise<void> {
    if (!isFileNode(node)) return;

    await this.run(async () => {
      await this.openStashFileDiff(node.file);
    });
  }

  private async openStashFileDiff(file: StashFile): Promise<void> {
    const before = this.content.createFileUri(file, "before");
    const after = this.content.createFileUri(file, "after");
    await vscode.commands.executeCommand(
      "vscode.diff",
      before,
      after,
      `${file.stashRef}: ${file.path}`,
    );
  }

  private async applyFileChanges(node: unknown): Promise<void> {
    if (!isFileNode(node)) return;

    await this.run(async () => {
      await this.git.applyFileChanges(node.file);
      this.tree.refresh();
    });
  }

  private async restoreFileChanges(node: unknown): Promise<void> {
    if (!isFileNode(node)) return;

    await this.run(async () => {
      const confirm = { title: "Restore Changes" };
      const result = await vscode.window.showWarningMessage(
        `Restore ${node.file.path} from ${node.file.stashRef}?`,
        { modal: true },
        confirm,
      );
      if (result !== confirm) return;

      await this.git.restoreFileChanges(node.file);
      this.tree.refresh();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = getErrorMessage(error);
      this.output.appendLine(message);
      const showOutput = "Show Output";
      const result = await vscode.window.showErrorMessage(message, showOutput);
      if (result === showOutput) this.output.show();
    }
  }
}

async function pickOperation(
  defaultOperation?: StashOperation,
): Promise<StashOperation | undefined> {
  const picks: OperationPick[] = [
    {
      label: "Push",
      description: "move staged changes into a stash",
      operation: "push",
    },
    {
      label: "Snapshot",
      description: "copy staged changes, keep working tree unchanged",
      operation: "snapshot",
    },
    {
      label: "Push Unstaged",
      description: "move unstaged changes into a stash",
      operation: "pushUnstaged",
    },
    {
      label: "Snapshot Unstaged",
      description: "copy unstaged changes, keep working tree unchanged",
      operation: "snapshotUnstaged",
    },
  ];

  const sorted =
    defaultOperation === undefined
      ? picks
      : [...picks].sort((a, b) => {
          if (a.operation === defaultOperation) return -1;
          if (b.operation === defaultOperation) return 1;
          return 0;
        });

  return (
    await vscode.window.showQuickPick(sorted, { title: "Stagit", placeHolder: "Choose stash type" })
  )?.operation;
}

async function pickStashAction(
  stash: Stash,
  action: "Apply" | "Pop",
): Promise<"Apply" | "Pop" | "Preview" | undefined> {
  return (await vscode.window.showQuickPick([action, "Preview", "Later"], {
    title: `${action} ${stash.ref}`,
    placeHolder: stash.message || stash.ref,
  })) as "Apply" | "Pop" | "Preview" | undefined;
}

function getStash(node: unknown): Stash | undefined {
  if (isStashNode(node)) return node.stash;
  return undefined;
}

function isStashNode(node: unknown): node is StashNode {
  return typeof node === "object" && node !== null && "type" in node && node.type === "stash";
}

function isFileNode(node: unknown): node is FileNode {
  return typeof node === "object" && node !== null && "type" in node && node.type === "file";
}

function getErrorMessage(error: unknown): string {
  const gitError = error as Partial<GitError>;
  if (typeof gitError.stderr === "string" && gitError.stderr.trim()) return gitError.stderr.trim();
  if (error instanceof Error) return error.message;
  return String(error);
}
