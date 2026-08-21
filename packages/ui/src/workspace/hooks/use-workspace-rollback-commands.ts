import React from "react";
import { deleteCollaborationActivitiesAfter, deleteCommitsAfter } from "../repository";
import { emptyImageParameterDocument, setImageOperation } from "../image-protocol";
import { protocolOperationType } from "../utils/workspace-operation-mapping";
import type { WorkspaceActivity, WorkspaceCommit, WorkspaceIdentity, WorkspaceImage } from "../types";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function useWorkspaceRollbackCommands({ workspace, selected, commits, selectedCollaborationActivities, activityPreview, rollbackTarget, setCommits, setActivities, setRollbackTarget, setRollbackPreview, setActivityPreview, setNotice, updateImage, syncCollaborationPreview, renderCollaborationPreviewSnapshot, sendRealtime, currentActivityId, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  commits: WorkspaceCommit[];
  selectedCollaborationActivities: WorkspaceActivity[];
  activityPreview: { activity: WorkspaceActivity; parameterDocument: any; commitId?: string } | null;
  rollbackTarget: WorkspaceCommit | null;
  setCommits: React.Dispatch<React.SetStateAction<WorkspaceCommit[]>>;
  setActivities: React.Dispatch<React.SetStateAction<WorkspaceActivity[]>>;
  setRollbackTarget: React.Dispatch<React.SetStateAction<WorkspaceCommit | null>>;
  setRollbackPreview: React.Dispatch<React.SetStateAction<Blob | null>>;
  setActivityPreview: React.Dispatch<React.SetStateAction<any>>;
  setNotice: (message: string) => void;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  syncCollaborationPreview: (image: WorkspaceImage, document: any) => Promise<any>;
  renderCollaborationPreviewSnapshot: (image: WorkspaceImage, document: any) => Promise<{ blob: Blob } | null>;
  sendRealtime: (type: string, payload: Record<string, unknown>) => void;
  currentActivityId: string | null;
}) {
  const parameterDocumentAtCommit = React.useCallback((image: WorkspaceImage, commit: WorkspaceCommit) => commits
    .filter((item) => item.imageId === image.imageId && item.createdAt <= commit.createdAt)
    .sort((left, right) => left.createdAt - right.createdAt)
    .flatMap((item) => item.operations)
    .reduce((document, operation) => setImageOperation(document, {
      id: operation.operationId, userId: operation.authorId, time: operation.createdAt,
      type: protocolOperationType(operation.type, operation.parameters),
      params: { ...operation.parameters, workspaceOperationType: operation.type },
    }), emptyImageParameterDocument()), [commits]);

  const openRollbackTarget = React.useCallback(async (commit: WorkspaceCommit) => {
    if (!selected || commit.imageId !== selected.imageId) return;
    setRollbackTarget(commit); setRollbackPreview(null);
    try {
      const parameterDocument = parameterDocumentAtCommit(selected, commit);
      const rendered = await renderCollaborationPreviewSnapshot(selected, parameterDocument);
      if (!rendered?.blob.size) throw new Error("Rollback preview is unavailable");
      setRollbackPreview(rendered.blob);
    } catch (error) {
      setRollbackTarget(null); setNotice(error instanceof Error ? error.message : "Rollback preview is unavailable");
    }
  }, [parameterDocumentAtCommit, renderCollaborationPreviewSnapshot, selected, setNotice, setRollbackPreview, setRollbackTarget]);

  const cancelRollbackTarget = React.useCallback(() => { setRollbackTarget(null); setRollbackPreview(null); }, [setRollbackPreview, setRollbackTarget]);

  const rollbackCommit = React.useCallback(async (commit: WorkspaceCommit) => {
    if (workspace?.role !== "owner" || !selected || commit.imageId !== selected.imageId) return;
    const parameterDocument = parameterDocumentAtCommit(selected, commit);
    const targetActivity = selectedCollaborationActivities.filter((activity) => {
      const detail = activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : null;
      return detail?.commitId === commit.commitId;
    }).at(-1);
    const activityCreatedAt = targetActivity?.createdAt ?? -1;
    const removedProposalIds = selectedCollaborationActivities.filter((activity) => activity.imageId === selected.imageId && activity.createdAt > activityCreatedAt).map((activity) => {
      const detail = activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : null;
      return typeof detail?.proposalId === "string" ? detail.proposalId : null;
    }).filter((proposalId): proposalId is string => Boolean(proposalId));
    await Promise.all([deleteCommitsAfter(selected.imageId, commit.createdAt), deleteCollaborationActivitiesAfter(workspace.workspaceId, selected.imageId, activityCreatedAt)]);
    setCommits((current) => current.filter((item) => item.imageId !== selected.imageId || item.createdAt <= commit.createdAt));
    setActivities((current) => current.filter((activity) => activity.imageId !== selected.imageId || activity.createdAt <= activityCreatedAt));
    await updateImage(selected.imageId, { currentCommitId: commit.commitId, parameterDocument, state: "shared" });
    await syncCollaborationPreview({ ...selected, currentCommitId: commit.commitId, parameterDocument, state: "shared" }, parameterDocument);
    sendRealtime("historyRolledBack", { imageId: selected.imageId, commitId: commit.commitId, targetCreatedAt: commit.createdAt, activityCreatedAt, removedProposalIds, parameterDocument });
    setRollbackTarget(null); setRollbackPreview(null);
  }, [parameterDocumentAtCommit, selected, selectedCollaborationActivities, sendRealtime, setActivities, setCommits, setRollbackPreview, setRollbackTarget, syncCollaborationPreview, updateImage, workspace]);

  const rollbackActivityParameterState = React.useCallback(async () => {
    if (workspace?.role !== "owner" || !selected || !activityPreview || activityPreview.activity.imageId !== selected.imageId || activityPreview.activity.eventId === currentActivityId) return;
    const { parameterDocument } = activityPreview;
    const commitId = activityPreview.commitId;
    const targetCommit = commits.find((commit) => commit.commitId === commitId && commit.imageId === selected.imageId);
    if (!commitId || !targetCommit) { setNotice("The selected Activity no longer has a matching Commit"); return; }
    await Promise.all([deleteCommitsAfter(selected.imageId, targetCommit.createdAt), deleteCollaborationActivitiesAfter(workspace.workspaceId, selected.imageId, activityPreview.activity.createdAt)]);
    setCommits((current) => current.filter((commit) => commit.imageId !== selected.imageId || commit.createdAt <= targetCommit.createdAt));
    setActivities((current) => current.filter((activity) => activity.imageId !== selected.imageId || activity.createdAt <= activityPreview.activity.createdAt));
    await updateImage(selected.imageId, { currentCommitId: commitId, parameterDocument, state: "shared" });
    await syncCollaborationPreview({ ...selected, currentCommitId: commitId, parameterDocument, state: "shared" }, parameterDocument);
    const removedProposalIds = selectedCollaborationActivities.filter((activity) => activity.imageId === selected.imageId && activity.createdAt > activityPreview.activity.createdAt).map((activity) => {
      const detail = activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : null;
      return typeof detail?.proposalId === "string" ? detail.proposalId : null;
    }).filter((proposalId): proposalId is string => Boolean(proposalId));
    sendRealtime("historyRolledBack", { imageId: selected.imageId, commitId, parameterDocument, targetCreatedAt: targetCommit.createdAt, activityCreatedAt: activityPreview.activity.createdAt, removedProposalIds });
    setActivityPreview(null);
  }, [activityPreview, commits, currentActivityId, selected, sendRealtime, setActivities, setActivityPreview, setCommits, setNotice, syncCollaborationPreview, updateImage, workspace]);

  return { parameterDocumentAtCommit, openRollbackTarget, cancelRollbackTarget, rollbackCommit, rollbackActivityParameterState };
}
