import type { StashFile, StashFileStatus, StashOperation } from "./types";

export function getStashArgs(operation: StashOperation, message: string): string[] {
  switch (operation) {
    case "push":
    case "snapshot":
      return ["stash", "push", "--staged", "-m", message];
    case "pushUnstaged":
    case "snapshotUnstaged":
      return ["stash", "push", "--keep-index", "--include-untracked", "-m", message];
  }
}

export function parseStashFile(repoPath: string, stashRef: string, line: string): StashFile {
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
