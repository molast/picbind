import React from "react";
import { readWorkspaceImageSource } from "../repository";
import { generateSharePlaceholder } from "../../utils/share-placeholder";
import { generateShareThumbnail } from "../../utils/share-thumbnail";
import { canStartImageCollaboration } from "../image-flow";
import { emptyImageParameterDocument } from "../image-protocol";
import { createCollaborationImageContainer, type CollaborationImageContainer } from "../collaboration-image-container";
import { dimensions } from "../utils/workspace-image-display";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspacePublishing({ workspace, imagesRef, collaborationContainers, updateImage, syncCollaborationPreview, clearCollaborationHistory, persistWorkspaceLog, setNotice, sendRealtime, sendRealtimeBinary, }: {
  workspace: WorkspaceIdentity | null;
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  syncCollaborationPreview: (image: WorkspaceImage, document: any) => Promise<CollaborationImageContainer | null>;
  clearCollaborationHistory: (imageId: string) => Promise<void>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string) => Promise<void>;
  setNotice: (message: string) => void;
  sendRealtime: (type: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => void;
  sendRealtimeBinary: (type: string, payload: Record<string, unknown>, bytes: ArrayBuffer, options?: Record<string, unknown>) => void;
}) {
  const publishPreview = React.useCallback(async (image: WorkspaceImage, source: Blob, targetUserId?: string) => {
    const revision = image.previewRevision + 1;
    const [placeholder, thumbnail] = await Promise.all([
      generateSharePlaceholder(source), generateShareThumbnail(source, 640, 480),
    ]);
    const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) return;
    await updateImage(image.imageId, { placeholder, preview, previewRevision: revision });
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) return;
    const route = targetUserId ? "user" : "workspace";
    const options = { route, targetUserId, delivery: "reliable", dataClass: "preview" };
    sendRealtime("placeholderUpsert", {
      imageId: image.imageId, imageName: image.name, mimeType: image.mimeType, size: image.size,
      width: image.width, height: image.height, placeholder, revision, currentCommitId: image.currentCommitId,
    }, options);
    sendRealtimeBinary("previewUpsert", {
      image: { imageId: image.imageId, imageName: image.name, mimeType: "image/webp", sourceMimeType: image.mimeType,
        width: image.width, height: image.height, placeholder, version: revision, currentCommitId: image.currentCommitId },
    }, thumbnail.slice().buffer as ArrayBuffer, { ...options, delivery: "bulk" });
  }, [imagesRef, sendRealtime, sendRealtimeBinary, updateImage]);

  const publishImage = React.useCallback(async (image: WorkspaceImage) => {
    if (!workspace || !image.sourceCached) return;
    const shared = !image.shared;
    if (shared && !canStartImageCollaboration(imagesRef.current, image.imageId)) {
      setNotice("Only one image can be shared at a time");
      return;
    }
    const nextState = shared ? "shared" as const : image.workspaceLocation === "working" ? "working" as const : "private" as const;
    const next = { ...image, shared, state: nextState };
    await updateImage(image.imageId, {
      shared,
      state: nextState,
      ...(!shared ? { currentCommitId: `initial_${image.imageId}` } : {}),
    });
    if (!shared) {
      sendRealtime("previewRemove", { imageId: image.imageId }, { delivery: "reliable", dataClass: "preview" });
      await clearCollaborationHistory(image.imageId);
      await persistWorkspaceLog(workspace.workspaceId, "imageUnshared", image.imageId);
      return;
    }
    const source = await readWorkspaceImageSource(image);
    if (!source) return;
    const sourceSize = await dimensions(source);
    const parameterDocument = image.parameterDocument || emptyImageParameterDocument();
    const container = createCollaborationImageContainer({ imageId: image.imageId, source, sourceKind: "source", name: image.name,
      mimeType: image.mimeType, width: sourceSize.width, height: sourceSize.height, parameterDocument: emptyImageParameterDocument() });
    collaborationContainers.current.set(image.imageId, container);
    const rendered = await syncCollaborationPreview({ ...next, parameterDocument }, parameterDocument);
    await publishPreview(next, rendered?.preview || source);
    await persistWorkspaceLog(workspace.workspaceId, "imageShared", image.imageId);
  }, [clearCollaborationHistory, collaborationContainers, imagesRef, persistWorkspaceLog, publishPreview, sendRealtime, setNotice, syncCollaborationPreview, updateImage, workspace]);

  return { publishPreview, publishImage };
}
