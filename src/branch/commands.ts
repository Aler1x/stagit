import * as vscode from "vscode";
import type { GitService } from "../git";

export class BranchCommands {
  constructor(
    private readonly git: GitService,
    private readonly output: vscode.OutputChannel,
  ) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("stagit.copyBranchName", () => this.copyBranchName()),
      vscode.commands.registerCommand("stagit.pruneBranches", () => this.pruneBranches()),
    );
  }

  private async copyBranchName(): Promise<void> {
    await this.run(async () => {
      const repoPath = await this.git.getBestRepository();
      if (repoPath === undefined) {
        void vscode.window.showWarningMessage("No Git repository found.");
        return;
      }

      const branch = await this.git.getCurrentBranch(repoPath);
      if (branch === undefined) {
        void vscode.window.showWarningMessage("No current branch found.");
        return;
      }

      await vscode.env.clipboard.writeText(branch);
      void vscode.window.showInformationMessage(`Copied branch name: ${branch}`);
    });
  }

  private async pruneBranches(): Promise<void> {
    await this.run(async () => {
      const repoPath = await this.git.getBestRepository();
      if (repoPath === undefined) {
        void vscode.window.showWarningMessage("No Git repository found.");
        return;
      }

      const goneBranches = await this.getGoneBranches(repoPath);
      if (goneBranches.length === 0) {
        void vscode.window.showInformationMessage("No branches to remove.");
        return;
      }

      const branches = await this.pickBranches(goneBranches);
      if (branches === undefined || branches.length === 0) return;
      if (!(await confirmDelete(branches))) return;

      await this.deleteBranches(repoPath, branches);

      void vscode.window.showInformationMessage(`Removed ${branches.length} branch(es).`);
    });
  }

  private getGoneBranches(repoPath: string): Thenable<string[]> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Pruning remote references...",
        cancellable: false,
      },
      async () => {
        await this.git.fetchPrune(repoPath);
        return this.git.listGoneBranches(repoPath);
      },
    );
  }

  private pickBranches(branches: string[]): Thenable<string[] | undefined> {
    return vscode.window.showQuickPick(branches, {
      title: "Git Prune Branches",
      placeHolder: "Select branches to remove",
      canPickMany: true,
    });
  }

  private deleteBranches(repoPath: string, branches: string[]): Thenable<void[]> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Deleting gone branches...",
        cancellable: false,
      },
      () => Promise.all(branches.map((branch) => this.git.deleteBranch(repoPath, branch))),
    );
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(message);
      const showOutput = "Show Output";
      const result = await vscode.window.showErrorMessage(message, showOutput);
      if (result === showOutput) this.output.show();
    }
  }
}

async function confirmDelete(branches: string[]): Promise<boolean> {
  const confirm = { title: "Delete Branches" };
  const result = await vscode.window.showWarningMessage(
    `Delete ${branches.length} local branch(es)?`,
    {
      modal: true,
      detail: branches.join("\n"),
    },
    confirm,
  );
  return result === confirm;
}
