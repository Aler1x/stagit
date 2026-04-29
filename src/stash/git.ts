import * as cp from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Stash, StashFile, StashFileStatus, StashOperation } from "./types";

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | undefined,
  ) {
    super(message);
  }
}

export class GitService {
  constructor(private readonly output: vscode.OutputChannel) {}

  async getRepositories(): Promise<string[]> {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    let api: { repositories: { rootUri: vscode.Uri }[] } | undefined;
    try {
      const git = await gitExtension?.activate();
      api = git?.getAPI?.(1) as { repositories: { rootUri: vscode.Uri }[] } | undefined;
    } catch {
      api = undefined;
    }
    const repositories = api?.repositories as { rootUri: vscode.Uri }[] | undefined;
    const repoPaths = repositories?.map((r) => r.rootUri.fsPath) ?? [];
    if (repoPaths.length !== 0) return [...new Set(repoPaths)];

    const folders = vscode.workspace.workspaceFolders ?? [];
    const discovered = await Promise.all(
      folders.map((folder) => this.findRepoRoot(folder.uri.fsPath)),
    );
    return [...new Set(discovered.filter((repo): repo is string => repo !== undefined))];
  }

  async getBestRepository(): Promise<string | undefined> {
    const editorPath =
      vscode.window.activeTextEditor?.document.uri.scheme === "file"
        ? vscode.window.activeTextEditor.document.uri.fsPath
        : undefined;
    if (editorPath !== undefined) {
      const repo = await this.findRepoRoot(path.dirname(editorPath));
      if (repo !== undefined) return repo;
    }

    return (await this.getRepositories())[0];
  }

  async listStashes(repoPath: string): Promise<Stash[]> {
    const output = await this.git(repoPath, ["stash", "list", "--format=%gd%x00%H%x00%s"]);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [ref = "", hash = "", message = ""] = line.split("\0");
        return { hash, message, ref, repoPath };
      });
  }

  async listStashFiles(repoPath: string, stashRef: string): Promise<StashFile[]> {
    const output = await this.git(repoPath, [
      "stash",
      "show",
      "--name-status",
      "--include-untracked",
      stashRef,
    ]);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => parseStashFile(repoPath, stashRef, line));
  }

  async stash(repoPath: string, operation: StashOperation, message: string): Promise<void> {
    const args = getStashArgs(operation, message);
    await this.git(repoPath, args);

    if (operation === "snapshot" || operation === "snapshotUnstaged") {
      const applyArgs =
        operation === "snapshot"
          ? ["stash", "apply", "--index", "stash@{0}"]
          : ["stash", "apply", "stash@{0}"];
      await this.git(repoPath, applyArgs);
    }
  }

  async applyStash(stash: Stash): Promise<void> {
    await this.git(stash.repoPath, ["stash", "apply", stash.ref]);
  }

  async popStash(stash: Stash): Promise<void> {
    await this.git(stash.repoPath, ["stash", "pop", stash.ref]);
  }

  async dropStash(stash: Stash): Promise<void> {
    await this.git(stash.repoPath, ["stash", "drop", stash.ref]);
  }

  getFileContent(repoPath: string, revision: string, filePath: string): Promise<string> {
    return this.git(repoPath, ["show", `${revision}:${filePath}`]);
  }

  async applyFileChanges(file: StashFile): Promise<void> {
    if (file.status === "added") {
      await this.restoreFileChanges(file);
      return;
    }

    const paths = file.oldPath === undefined ? [file.path] : [file.oldPath, file.path];
    const patch = await this.git(file.repoPath, [
      "diff",
      `${file.stashRef}^1`,
      file.stashRef,
      "--",
      ...paths,
    ]);
    if (!patch.trim()) return;

    await this.gitWithInput(file.repoPath, ["apply", "--whitespace=nowarn"], patch);
  }

  async restoreFileChanges(file: StashFile): Promise<void> {
    try {
      await this.git(file.repoPath, ["checkout", file.stashRef, "--", file.path]);
    } catch (error) {
      if (file.status !== "added") throw error;
      await this.git(file.repoPath, ["checkout", `${file.stashRef}^3`, "--", file.path]);
    }
  }

  private async findRepoRoot(cwd: string): Promise<string | undefined> {
    try {
      return (await this.git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
      return undefined;
    }
  }

  private git(cwd: string, args: string[]): Promise<string> {
    this.output.appendLine(`git -C ${cwd} ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      cp.execFile(
        "git",
        ["-C", cwd, ...args],
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 },
        (error, stdout, stderr) => {
          if (error !== null) {
            const code = typeof error.code === "number" ? error.code : undefined;
            this.output.appendLine(stderr || error.message);
            reject(new GitError(error.message, stderr, code));
            return;
          }

          if (stderr) this.output.appendLine(stderr);
          resolve(stdout.trimEnd());
        },
      );
    });
  }

  private gitWithInput(cwd: string, args: string[], input: string): Promise<string> {
    this.output.appendLine(`git -C ${cwd} ${args.join(" ")}`);

    return new Promise((resolve, reject) => {
      const child = cp.spawn("git", ["-C", cwd, ...args], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        reject(new GitError(error.message, stderr, undefined));
      });
      child.on("close", (code) => {
        if (stderr) this.output.appendLine(stderr);
        if (code !== 0) {
          reject(new GitError(stderr || `Git exited with code ${code}`, stderr, code ?? undefined));
          return;
        }

        resolve(stdout.trimEnd());
      });

      child.stdin.end(input);
    });
  }
}

function getStashArgs(operation: StashOperation, message: string): string[] {
  switch (operation) {
    case "push":
    case "snapshot":
      return ["stash", "push", "--staged", "-m", message];
    case "pushUnstaged":
    case "snapshotUnstaged":
      return ["stash", "push", "--keep-index", "--include-untracked", "-m", message];
  }
}

function parseStashFile(repoPath: string, stashRef: string, line: string): StashFile {
  const parts = line.split("\t");
  const rawStatus = parts[0] ?? "";
  const status = parseStatus(rawStatus);
  const oldPath = status === "renamed" || status === "copied" ? parts[1] : undefined;
  const filePath = status === "renamed" || status === "copied" ? parts[2] : parts[1];

  return {
    repoPath,
    stashRef,
    path: filePath ?? "",
    oldPath,
    status,
  };
}

function parseStatus(status: string): StashFileStatus {
  switch (status[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "unknown";
  }
}
