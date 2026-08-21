import type { WorkspaceCommit } from "../types";

export const cachedCommit = (commit: WorkspaceCommit): WorkspaceCommit => ({ ...commit, snapshotCached: commit.snapshotCached || Boolean(commit.snapshot), snapshot: undefined });

export async function digestBlob(blob: Blob) {
  const value = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
