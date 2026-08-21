import React from "react";
import { listCommits, saveCommit, saveProposal } from "../repository";
import { adoptCollaborationRender, type CollaborationImageContainer } from "../collaboration-image-container";
import { emptyImageParameterDocument, setImageOperation } from "../image-protocol";
import { protocolOperationType } from "../utils/workspace-operation-mapping";
import { cachedCommit } from "../utils/workspace-page-utils";
import { workspaceOperationStorageMode } from "../image-flow";
import { readWorkspaceCommitSnapshot, readWorkspaceImageSource } from "../repository";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { WorkspaceActivity, WorkspaceCommit, WorkspaceIdentity, WorkspaceImage, WorkspaceOperation, WorkspaceProposal } from "../types";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function useWorkspaceOperationCommands({ workspace, selected, images, imagesRef, collaborationContainers, setCommits, setProposals, setNotice, updateImage, saveProcessedCopy, syncCollaborationPreview, persistCollaborationActivity, sendRealtime, pendingProposalEvents, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  images: WorkspaceImage[];
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  setCommits: React.Dispatch<React.SetStateAction<WorkspaceCommit[]>>;
  setProposals: React.Dispatch<React.SetStateAction<WorkspaceProposal[]>>;
  setNotice: (message: string) => void;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  saveProcessedCopy: (source: WorkspaceImage, result: ProcessedImageResult) => Promise<string | undefined>;
  syncCollaborationPreview: (image: WorkspaceImage, document: any) => Promise<any>;
  persistCollaborationActivity: (workspaceId: string, kind: string, imageId: string, detail: unknown, actorId?: string) => Promise<void>;
  sendRealtime: (type: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => string | undefined;
  pendingProposalEvents: React.MutableRefObject<Map<string, string>>;
}) {
  const submitProposal = React.useCallback(async (proposal: WorkspaceProposal) => {
    const submitted = { ...proposal, state: "submitted" as const };
    await saveProposal(submitted);
    setProposals((current) => current.map((item) => item.proposalId === proposal.proposalId ? submitted : item));
    const eventId = sendRealtime("proposalSubmit", { proposal: submitted }, { route: "owner", delivery: "reliable" });
    if (eventId) pendingProposalEvents.current.set(eventId, proposal.proposalId);
  }, [pendingProposalEvents, sendRealtime, setProposals]);

  const createOperation = React.useCallback(async (type: WorkspaceOperation["type"], parameters: Record<string, unknown> = {}, processed?: { blob: Blob; name: string; mimeType: string; width: number; height: number }) => {
    if (!workspace || !selected) return;
    const operation: WorkspaceOperation = { operationId: id("operation"), imageId: selected.imageId, authorId: "local",
      baseCommitId: selected.currentCommitId || `initial_${selected.imageId}`, type, parameters, createdAt: Date.now() };
    if (workspaceOperationStorageMode(selected) === "newImage") {
      if (!processed) return;
      await saveProcessedCopy(selected, { blob: processed.blob, name: processed.name,
        operation: type === "other" ? "convert" : type === "brightness" ? "adjust" : type, parameters,
        width: processed.width, height: processed.height } as ProcessedImageResult);
      return;
    }
    if (workspace.role === "collaborator") {
      const proposal: WorkspaceProposal = { proposalId: id("proposal"), workspaceId: workspace.workspaceId, imageId: selected.imageId,
        authorId: "local", baseCommitId: operation.baseCommitId, operations: [operation], state: "draft", createdAt: Date.now() };
      await saveProposal(proposal);
      setProposals((current) => [...current, proposal]);
      await submitProposal(proposal);
      await persistCollaborationActivity(workspace.workspaceId, "proposalSubmitted", selected.imageId, {
        proposalId: proposal.proposalId, operationId: operation.operationId, operationType: type, parameters,
        commitId: operation.baseCommitId, actorId: operation.authorId, status: "pending",
      });
      return;
    }
    const parameterDocument = setImageOperation(selected.parameterDocument || emptyImageParameterDocument(), {
      id: operation.operationId, userId: operation.authorId, time: operation.createdAt,
      type: protocolOperationType(type, parameters), params: { ...parameters, workspaceOperationType: type },
    });
    const parameterCommit: WorkspaceCommit = { commitId: id("commit"), imageId: selected.imageId, authorId: "owner",
      parentCommitId: selected.currentCommitId, mergeParentCommitIds: [], operations: [operation], createdAt: Date.now() };
    await saveCommit(parameterCommit);
    setCommits((current) => [...current, cachedCommit(parameterCommit)]);
    await updateImage(selected.imageId, { parameterDocument, currentCommitId: parameterCommit.commitId, state: "shared" });
    const currentContainer = collaborationContainers.current.get(selected.imageId);
    const rendered = currentContainer && processed
      ? adoptCollaborationRender(currentContainer, parameterDocument, processed)
      : await syncCollaborationPreview({ ...selected, parameterDocument, currentCommitId: parameterCommit.commitId }, parameterDocument);
    if (rendered) collaborationContainers.current.set(selected.imageId, rendered);
    sendRealtime("commitCreated", { commit: parameterCommit, parameterDocument }, { delivery: "reliable", dataClass: "collaborationEvent" });
    await persistCollaborationActivity(workspace.workspaceId, "operationCommitted", selected.imageId, {
      commitId: parameterCommit.commitId, operationId: operation.operationId, operationType: type, parameters,
      actorId: operation.authorId, parameterDocument,
    });
  }, [collaborationContainers, persistCollaborationActivity, saveProcessedCopy, selected, sendRealtime, setCommits, setProposals, submitProposal, syncCollaborationPreview, updateImage, workspace]);

  const proposalInput = React.useCallback(async (proposal: WorkspaceProposal) => {
    const image = images.find((item) => item.imageId === proposal.imageId);
    if (!image) throw new Error("Proposal image is unavailable");
    if (workspace?.role === "collaborator" || proposal.authorId === "local") {
      const container = collaborationContainers.current.get(proposal.imageId);
      const source = container?.sourceKind === "source" ? container.source : await readWorkspaceImageSource(image);
      if (!source) throw new Error("Source is not available for Proposal preview");
      return { ...image, source };
    }
    if (image.currentCommitId === proposal.baseCommitId) {
      const source = await readWorkspaceImageSource(image);
      if (!source) throw new Error("Proposal base version is unavailable");
      return { ...image, source };
    }
    const history = await listCommits(proposal.imageId);
    const base = history.find((commit) => commit.commitId === proposal.baseCommitId);
    const snapshot = base ? await readWorkspaceCommitSnapshot(base) : null;
    if (!base || !snapshot) throw new Error("Proposal base version is unavailable");
    return { ...image, source: snapshot, name: base.snapshotName || image.name, mimeType: base.snapshotMimeType || image.mimeType,
      width: base.snapshotWidth || image.width, height: base.snapshotHeight || image.height };
  }, [collaborationContainers, images, workspace?.role]);

  return { createOperation, submitProposal, proposalInput };
}
