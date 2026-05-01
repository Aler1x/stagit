import * as cp from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { getStashArgs, parseStashFile } from "./stash/gitUtils";
import type { Stash, StashFile, StashOperation } from "./stash/types";

type GitRepository = {
  rootUri: vscode.Uri;
  fetch(options?: { prune?: boolean }): Promise<void>;
};
type GitExtensionApi = { repositories: GitRepository[] };

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
    const repositories = (await this.getGitExtensionApi())?.repositories;
    const repoPaths = repositories?.map((r) => r.rootUri.fsPath) ?? [];
    if (repoPaths.length !== 0) return this.dedupeRepositories(repoPaths);

    const folders = vscode.workspace.workspaceFolders ?? [];
    const discovered = await Promise.all(
      folders.map((folder) => this.findRepoRoot(folder.uri.fsPath)),
    );
    return this.dedupeRepositories(discovered.filter((repo): repo is string => repo !== undefined));
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

  async getCurrentBranch(repoPath: string): Promise<string | undefined> {
    const branch = (await this.git(repoPath, ["branch", "--show-current"])).trim();
    return branch || undefined;
  }

  async fetchPrune(repoPath: string): Promise<void> {
    const repository = await this.getGitRepository(repoPath);
    if (repository !== undefined) {
      await repository.fetch({ prune: true });
      return;
    }

    await this.git(repoPath, ["fetch", "--prune"]);
  }

  async listGoneBranches(repoPath: string): Promise<string[]> {
    const output = await this.git(repoPath, [
      "for-each-ref",
      "refs/heads",
      "--format=%(refname:short)%00%(upstream:track)%00%(HEAD)%00%(worktreepath)",
    ]);

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const [branch = "", upstreamTrack = "", head = "", worktreePath = ""] = line.split("\0");
        return upstreamTrack === "[gone]" && branch && head !== "*" && !worktreePath
          ? [branch]
          : [];
      });
  }

  async deleteBranch(
    repoPath: string,
    branch: string,
    options?: { force?: boolean },
  ): Promise<void> {
    await this.git(repoPath, ["branch", options?.force === true ? "-D" : "-d", branch]);
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

  private async dedupeRepositories(repoPaths: string[]): Promise<string[]> {
    const repos = new Map<string, { path: string; isWorktree: boolean }>();
    const uniqueRepoPaths = [...new Set(repoPaths)];
    const repoGitDirs = await Promise.all(
      uniqueRepoPaths.map(async (repoPath) => ({
        repoPath,
        gitDirs: await this.getGitDirs(repoPath),
      })),
    );

    for (const { repoPath, gitDirs } of repoGitDirs) {
      const key = gitDirs?.commonDir ?? repoPath;
      const isWorktree = gitDirs?.gitDir !== gitDirs?.commonDir;
      const existing = repos.get(key);
      if (existing === undefined || (existing.isWorktree && !isWorktree)) {
        repos.set(key, { path: repoPath, isWorktree });
      }
    }
    return [...repos.values()].map((repo) => repo.path);
  }

  private async getGitDirs(
    repoPath: string,
  ): Promise<{ commonDir: string; gitDir: string } | undefined> {
    try {
      const output = await this.git(repoPath, [
        "rev-parse",
        "--path-format=absolute",
        "--git-dir",
        "--git-common-dir",
      ]);
      const [gitDir, commonDir] = output.split(/\r?\n/);
      if (gitDir === undefined || commonDir === undefined) return undefined;

      return {
        commonDir: path.normalize(commonDir.trim()),
        gitDir: path.normalize(gitDir.trim()),
      };
    } catch {
      return undefined;
    }
  }

  private async getGitRepository(repoPath: string): Promise<GitRepository | undefined> {
    const api = await this.getGitExtensionApi();
    const normalizedRepoPath = path.normalize(repoPath).toLowerCase();
    return api?.repositories.find(
      (repo) => path.normalize(repo.rootUri.fsPath).toLowerCase() === normalizedRepoPath,
    );
  }

  private async getGitExtensionApi(): Promise<GitExtensionApi | undefined> {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    try {
      const git = await gitExtension?.activate();
      return (git as { getAPI?(version: 1): GitExtensionApi | undefined } | undefined)?.getAPI?.(1);
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
