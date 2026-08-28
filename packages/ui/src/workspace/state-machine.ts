import type {
  ImageCollaborationState,
  ProposalState,
  WorkspaceCommit,
  WorkspaceRuntimeState,
} from "./types";
import type { RealtimeSessionState } from "@picbind/shared";

const WORKSPACE_TRANSITIONS: Record<WorkspaceRuntimeState, WorkspaceRuntimeState[]> = {
  local: ["connecting", "unavailable"],
  connecting: ["connected", "unavailable"],
  connected: ["syncing", "available", "ownerOffline", "unavailable"],
  syncing: ["available", "ownerOffline", "unavailable"],
  available: ["syncing", "ownerOffline", "unavailable", "connecting"],
  ownerOffline: ["connected", "syncing", "connecting", "unavailable"],
  unavailable: ["connected", "connecting", "syncing", "ownerOffline"],
};

export type WorkspaceRuntimeAction =
  | { type: "transition"; next: WorkspaceRuntimeState }
  | { type: "realtimeStateChanged"; state: RealtimeSessionState }
  | { type: "restoreLocal" };

export function workspaceRuntimeReducer(
  current: WorkspaceRuntimeState,
  action: WorkspaceRuntimeAction,
) {
  if (action.type === "restoreLocal") return "local" as const;
  if (action.type === "realtimeStateChanged") {
    if (action.state === "unavailable" || action.state === "closed") {
      return WORKSPACE_TRANSITIONS[current].includes("unavailable") ? "unavailable" : current;
    }
    if ((action.state === "connecting" || action.state === "reconnecting")
      && (current === "connecting" || current === "ownerOffline" || current === "unavailable")) {
      return WORKSPACE_TRANSITIONS[current].includes("connecting") ? "connecting" : current;
    }
    return current;
  }
  return WORKSPACE_TRANSITIONS[current].includes(action.next) ? action.next : current;
}

const IMAGE_TRANSITIONS: Record<ImageCollaborationState, ImageCollaborationState[]> = {
  private: ["shared", "working"],
  shared: ["private", "working", "reviewing"],
  working: ["private", "shared", "reviewing", "committed"],
  reviewing: ["private", "working", "committed"],
  committed: ["private", "shared", "working", "reviewing"],
};

export function transitionImageState(
  current: ImageCollaborationState,
  next: ImageCollaborationState,
) {
  return IMAGE_TRANSITIONS[current].includes(next) ? next : current;
}

const PROPOSAL_TRANSITIONS: Record<ProposalState, ProposalState[]> = {
  draft: ["submitted"],
  submitted: ["pending", "failed"],
  pending: ["approved", "rejected", "later", "conflict"],
  approved: [],
  later: ["pending", "approved", "rejected", "conflict"],
  rejected: [],
  failed: ["submitted"],
  conflict: ["rejected"],
};

export function transitionProposalState(current: ProposalState, next: ProposalState) {
  return PROPOSAL_TRANSITIONS[current].includes(next) ? next : current;
}

export type CommitState = "current" | "historical" | "snapshotExpired";

export function commitState(commit: WorkspaceCommit, currentCommitId: string | null): CommitState {
  if (commit.commitId === currentCommitId) return "current";
  return commit.snapshot || commit.snapshotCached ? "historical" : "snapshotExpired";
}
