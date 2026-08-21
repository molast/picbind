import React from "react";
import { saveCommit } from "../repository";
import { generateShareThumbnail } from "../../utils/share-thumbnail";
import { createCollaborationImageContainer, disposeCollaborationImageContainer, type CollaborationImageContainer } from "../collaboration-image-container";
import { emptyImageParameterDocument } from "../image-protocol";
import { cachedCommit } from "../utils/workspace-page-utils";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { WorkspaceCommit, WorkspaceIdentity, WorkspaceImage } from "../types";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function useWorkspaceSaveCollaboration({ workspace, selected, collaborationSaveChoice, collaborationContainers, setCommits, setCollaborationSaving, setSaveCollaborationOpen, setNotice, updateImage, syncCollaborationContainer, saveProcessedCopy, publishPreview, persistCollaborationActivity, sendRealtime, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  collaborationSaveChoice: "copy" | "replace";
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  setCommits: React.Dispatch<React.SetStateAction<WorkspaceCommit[]>>;
  setCollaborationSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveCollaborationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  syncCollaborationContainer: (image: WorkspaceImage, document: any) => Promise<CollaborationImageContainer | null>;
  saveProcessedCopy: (source: WorkspaceImage, result: ProcessedImageResult) => Promise<string | undefined>;
  publishPreview: (image: WorkspaceImage, source: Blob) => Promise<void>;
  persistCollaborationActivity: (workspaceId: string, kind: string, imageId: string, detail: unknown, actorId?: string) => Promise<void>;
  sendRealtime: (type: string, payload: Record<string, unknown>) => void;
}) {
  const saveCollaborativeImage = React.useCallback(async () => {
    if (!workspace || workspace.role !== "owner" || !selected?.shared || !selected.sourceCached) return;
    setCollaborationSaving(true);
    try {
      const container = await syncCollaborationContainer(selected, selected.parameterDocument || emptyImageParameterDocument());
      if (!container) throw new Error("Source data is unavailable");
      const result = { blob: container.rendered, name: container.name, mimeType: container.mimeType, width: container.width, height: container.height };
      if (collaborationSaveChoice === "copy") {
        await saveProcessedCopy(selected, { ...result, operation: "adjust", parameters: {} } as ProcessedImageResult);
        await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", selected.imageId, { mode: "copy", commitId: selected.currentCommitId }, "owner");
      } else {
        const thumbnail = await generateShareThumbnail(result.blob, 320, 240);
        const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
        const baseline: WorkspaceCommit = { commitId: id("commit"), imageId: selected.imageId, authorId: "owner",
          parentCommitId: selected.currentCommitId, mergeParentCommitIds: [], operations: [], snapshot: result.blob,
          snapshotName: result.name, snapshotMimeType: result.mimeType, snapshotWidth: result.width, snapshotHeight: result.height, createdAt: Date.now() };
        await saveCommit(baseline);
        setCommits((current) => [...current, cachedCommit(baseline)]);
        const parameterDocument = emptyImageParameterDocument();
        await updateImage(selected.imageId, { source: result.blob, preview, name: result.name, mimeType: result.mimeType,
          size: result.blob.size, width: result.width, height: result.height, currentCommitId: baseline.commitId, parameterDocument, state: "shared" });
        await publishPreview({ ...selected, ...result, size: result.blob.size, currentCommitId: baseline.commitId, parameterDocument }, result.blob);
        sendRealtime("commitCreated", { commit: cachedCommit(baseline), parameterDocument });
        const previous = collaborationContainers.current.get(selected.imageId);
        if (previous) disposeCollaborationImageContainer(previous);
        collaborationContainers.current.set(selected.imageId, createCollaborationImageContainer({ imageId: selected.imageId, source: result.blob,
          sourceKind: "source", name: result.name, mimeType: result.mimeType, width: result.width, height: result.height, parameterDocument }));
        await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", selected.imageId, { mode: "replace", commitId: baseline.commitId }, "owner");
      }
      setSaveCollaborationOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save collaborative image");
    } finally { setCollaborationSaving(false); }
  }, [collaborationContainers, collaborationSaveChoice, persistCollaborationActivity, publishPreview, saveProcessedCopy, selected, sendRealtime, setCollaborationSaving, setCommits, setNotice, setSaveCollaborationOpen, syncCollaborationContainer, updateImage, workspace]);
  return { saveCollaborativeImage };
}
