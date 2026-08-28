import React from "react";
import { listCommits, saveCommit, saveProposal } from "../repository";
import type { CollaborationImageContainer } from "../collaboration-image-container";
import { emptyImageParameterDocument, setImageOperation } from "../image-protocol";
import { protocolOperationType } from "../utils/workspace-operation-mapping";
import { cachedCommit } from "../utils/workspace-page-utils";
import { workspaceOperationStorageMode } from "../image-flow";
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
    const parameterDocument = setImageOperation(selected.parameterDocument || emptyImageParameterDocument(), {
      id: operation.operationId, userId: operation.authorId, time: operation.createdAt,
      type: protocolOperationType(type, parameters), params: { ...parameters, workspaceOperationType: type },
    });
    if (!selected.shared) {
      await updateImage(selected.imageId, { parameterDocument, state: "working" });
      const rendered = await syncCollaborationPreview({ ...selected, parameterDocument, state: "working" }, parameterDocument);
      if (rendered) collaborationContainers.current.set(selected.imageId, rendered);
      return;
    }
    if (workspace.role === "collaborator") {
      const localCommit: WorkspaceCommit = { commitId: id("commit"), imageId: selected.imageId, authorId: "local", parentCommitId: selected.currentCommitId, mergeParentCommitIds: [], operations: [operation], createdAt: Date.now() };
      const proposal: WorkspaceProposal = { proposalId: id("proposal"), workspaceId: workspace.workspaceId, imageId: selected.imageId,
        authorId: "local", baseCommitId: operation.baseCommitId, operations: [operation], commit: localCommit, state: "draft", createdAt: Date.now() };
      await saveCommit(localCommit);
      setCommits((current) => [...current, cachedCommit(localCommit)]);
      await saveProposal(proposal);
      setProposals((current) => [...current, proposal]);
      await submitProposal(proposal);
      await persistCollaborationActivity(workspace.workspaceId, "proposalSubmitted", selected.imageId, {
        proposalId: proposal.proposalId, operationId: operation.operationId, operationType: type, parameters,
        commitId: localCommit.commitId, actorId: operation.authorId, status: "pending",
      });
      return;
    }
    const parameterCommit: WorkspaceCommit = { commitId: id("commit"), imageId: selected.imageId, authorId: "owner",
      parentCommitId: selected.currentCommitId, mergeParentCommitIds: [], operations: [operation], createdAt: Date.now() };
    await saveCommit(parameterCommit);
    setCommits((current) => [...current, cachedCommit(parameterCommit)]);
    await updateImage(selected.imageId, { parameterDocument, currentCommitId: parameterCommit.commitId, state: "shared" });
    const rendered = await syncCollaborationPreview(
      { ...selected, parameterDocument, currentCommitId: parameterCommit.commitId },
      parameterDocument,
    );
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
    const container = collaborationContainers.current.get(proposal.imageId);
    if (!container || container.disposed) {
      throw new Error("Proposal source is not loaded in collaboration memory");
    }
    const initialCommitId = `initial_${image.imageId}`;
    let baseDocument = emptyImageParameterDocument();
    if (proposal.baseCommitId !== initialCommitId) {
      if (image.currentCommitId === proposal.baseCommitId) {
        baseDocument = container.parameterDocument;
      } else {
        const history = (await listCommits(proposal.imageId))
          .sort((left, right) => left.createdAt - right.createdAt);
        const targetIndex = history.findIndex((commit) => commit.commitId === proposal.baseCommitId);
        if (targetIndex < 0) throw new Error("Proposal base version is unavailable");
        baseDocument = history.slice(0, targetIndex + 1)
          .flatMap((commit) => commit.operations)
          .reduce((document, operation) => setImageOperation(document, {
            id: operation.operationId,
            userId: operation.authorId,
            time: operation.createdAt,
            type: protocolOperationType(operation.type, operation.parameters),
            params: { ...operation.parameters, workspaceOperationType: operation.type },
          }), emptyImageParameterDocument());
      }
    }
    return {
      ...image,
      source: container.originalBlob,
      cacheKey: container.cacheKey,
      baseDocument,
    };
  }, [collaborationContainers, images]);

  return { createOperation, submitProposal, proposalInput };
}
