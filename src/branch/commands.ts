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
