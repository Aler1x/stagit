import * as path from "node:path";
import * as vscode from "vscode";
import type { GitService } from "../git";
import type {
  FileNode,
  FolderNode,
  MessageNode,
  RepoNode,
  Stash,
  StashFile,
  StashNode,
  TreeNode,
} from "./types";

export class StashTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly git: GitService) {}

  refresh(): void {
    this.emitter.fire();
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element === undefined) {
      const repos = await this.git.getRepositories();
      if (repos.length === 0) return [{ type: "message", message: "No Git repositories found." }];
      if (repos.length === 1) return this.getStashNodes(repos[0]!);
      return repos.map((repoPath) => ({ type: "repo", repoPath }));
    }

    switch (element.type) {
      case "repo":
        return this.getStashNodes(element.repoPath);
      case "stash":
        return this.getFileTree(element.stash);
      case "folder":
        return element.children;
      case "file":
      case "message":
        return [];
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.type) {
      case "repo":
        return getRepoItem(element);
      case "stash":
        return getStashItem(element);
      case "folder":
        return getFolderItem(element);
      case "file":
        return getFileItem(element);
      case "message":
        return getMessageItem(element);
    }
  }

  private async getStashNodes(repoPath: string): Promise<TreeNode[]> {
    const stashes = await this.git.listStashes(repoPath);
    if (stashes.length === 0) return [{ type: "message", message: "No stashes found." }];
    return stashes.map((stash) => ({ type: "stash", stash }));
  }

  private async getFileTree(stash: Stash): Promise<TreeNode[]> {
    const files = await this.git.listStashFiles(stash.repoPath, stash.ref);
    if (files.length === 0) return [{ type: "message", message: "No changed files found." }];

    const root: FolderNode = {
      type: "folder",
      repoPath: stash.repoPath,
      stashRef: stash.ref,
      path: "",
      label: "",
      children: [],
    };

    for (const file of files) {
      addFile(root, file);
    }

    return root.children;
  }
}

function getRepoItem(node: RepoNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    path.basename(node.repoPath),
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.description = node.repoPath;
  item.resourceUri = vscode.Uri.file(node.repoPath);
  item.contextValue = "repo";
  return item;
}

function getStashItem(node: StashNode): vscode.TreeItem {
  const { branch, message } = parseStashMessage(node.stash.message);
  const label = message || node.stash.ref;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = branch ?? node.stash.ref;
  item.tooltip = `${node.stash.ref} ${node.stash.hash}\n${node.stash.message}`;
  item.contextValue = "stash";
  return item;
}

function parseStashMessage(rawMessage: string): { branch: string | undefined; message: string } {
  const match = /^(?:On|WIP on)\s+(.+?):\s*(.+)$/.exec(rawMessage);
  if (match === null) return { branch: undefined, message: rawMessage };

  const [, branch, message] = match;
  return { branch, message };
}

function getFolderItem(node: FolderNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
  item.iconPath = vscode.ThemeIcon.Folder;
  item.contextValue = "folder";
  return item;
}

function getFileItem(node: FileNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    path.basename(node.file.path),
    vscode.TreeItemCollapsibleState.None,
  );
  item.description = node.file.status;
  item.resourceUri = node.resourceUri;
  item.contextValue = "stashFile";
  item.command = {
    command: "stagit.openStashFile",
    title: "Open Stash File Changes",
    arguments: [node],
  };
  return item;
}

function getMessageItem(node: MessageNode): vscode.TreeItem {
  return new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
}

function addFile(root: FolderNode, file: StashFile): void {
  const parts = file.path.split(/[\\/]/).filter(Boolean);
  const fileName = parts.pop();
  if (fileName === undefined) return;

  let folder = root;
  for (const part of parts) {
    let child = folder.children.find(
      (node): node is FolderNode => node.type === "folder" && node.label === part,
    );
    if (child === undefined) {
      const folderPath = folder.path ? `${folder.path}/${part}` : part;
      child = {
        type: "folder",
        repoPath: file.repoPath,
        stashRef: file.stashRef,
        path: folderPath,
        label: part,
        children: [],
      };
      folder.children.push(child);
    }
    folder = child;
  }

  folder.children.push({
    type: "file",
    file,
    resourceUri: vscode.Uri.file(path.join(file.repoPath, file.path)),
  });
}
