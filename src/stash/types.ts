import type * as vscode from "vscode";

export type StashOperation = "push" | "snapshot" | "pushUnstaged" | "snapshotUnstaged";

export type Stash = {
  repoPath: string;
  ref: string;
  hash: string;
  message: string;
};

export type StashFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";

export type StashFile = {
  repoPath: string;
  stashRef: string;
  path: string;
  oldPath?: string;
  status: StashFileStatus;
};

export type TreeNode = RepoNode | StashNode | FolderNode | FileNode | MessageNode;

export type RepoNode = {
  type: "repo";
  repoPath: string;
};

export type StashNode = {
  type: "stash";
  stash: Stash;
};

export type FolderNode = {
  type: "folder";
  repoPath: string;
  stashRef: string;
  path: string;
  label: string;
  children: TreeNode[];
};

export type FileNode = {
  type: "file";
  file: StashFile;
  resourceUri: vscode.Uri;
};

export type MessageNode = {
  type: "message";
  message: string;
};
