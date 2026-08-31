import React from "react";
import { useImageProcessing } from "../../image-processing";
import { readWorkspaceImageSource } from "../repository";
import { canStartImageCollaboration } from "../image-flow";
import { emptyImageParameterDocument } from "../image-protocol";
import { initialWorkspaceCommitId } from "../../utils/id";
import type { CollaborationImageContainer } from "../collaboration-image-container";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspacePublishing({ workspace, imagesRef, updateImage, syncCollaborationPreview, releaseCollaborationContainer, clearCollaborationHistory, persistWorkspaceLog, setNotice, sendRealtime, sendRealtimeBinary, }: {
  workspace: WorkspaceIdentity | null;
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  syncCollaborationPreview: (image: WorkspaceImage, document: any, sourceOverride?: Blob) => Promise<CollaborationImageContainer | null>;
  releaseCollaborationContainer: (imageId: string) => void;
  clearCollaborationHistory: (imageId: string) => Promise<void>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string) => Promise<void>;
  setNotice: (message: string) => void;
  sendRealtime: (type: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => void;
  sendRealtimeBinary: (type: string, payload: Record<string, unknown>, bytes: ArrayBuffer, options?: Record<string, unknown>) => void;
}) {
  const imageProcessing = useImageProcessing();
  const publishPreview = React.useCallback(async (image: WorkspaceImage, source: Blob, targetUserId?: string) => {
    const revision = image.previewRevision + 1;
    const assets = await imageProcessing.createShareAssets({
      source: { kind: "blob", blob: source, name: image.name, mimeType: source.type || image.mimeType },
      container: { width: 640, height: 480 },
    }, { requestId: `workspace-share-assets:${image.imageId}:${revision}` });
    const placeholder = assets.placeholder;
    const preview = assets.thumbnail.blob;
    const thumbnail = await preview.arrayBuffer();
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) return;
    // The Owner's repository thumbnail is the stable pre-collaboration Working thumbnail.
    // The rendered collaboration preview is transmitted but not persisted over that file.
    await updateImage(image.imageId, { placeholder, previewRevision: revision });
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
    }, thumbnail, { ...options, delivery: "bulk" });
  }, [imageProcessing, imagesRef, sendRealtime, sendRealtimeBinary, updateImage]);

  const publishImage = React.useCallback(async (image: WorkspaceImage) => {
    if (!workspace || !image.sourceCached) return;
    const shared = !image.shared;
    if (shared && !canStartImageCollaboration(imagesRef.current, image.imageId)) {
      setNotice("Only one image can be shared at a time");
      return;
    }
    if (!shared) {
      const currentImage = imagesRef.current.find((candidate) => candidate.imageId === image.imageId) || image;
      await updateImage(image.imageId, {
        shared: false,
        state: currentImage.workspaceLocation === "working" ? "working" : "private",
        currentCommitId: initialWorkspaceCommitId(image.imageId),
        parameterDocument: emptyImageParameterDocument(),
      });
      releaseCollaborationContainer(image.imageId);
      sendRealtime("previewRemove", { imageId: image.imageId }, { delivery: "reliable", dataClass: "preview" });
      await clearCollaborationHistory(image.imageId);
      await persistWorkspaceLog(workspace.workspaceId, "imageUnshared", image.imageId);
      return;
    }
    const next = { ...image, shared: true, state: "shared" as const };
    await updateImage(image.imageId, { shared: true, state: "shared" });
    const source = await readWorkspaceImageSource(image);
    if (!source) return;
    const parameterDocument = image.parameterDocument || emptyImageParameterDocument();
    const rendered = await syncCollaborationPreview({ ...next, parameterDocument }, parameterDocument, source);
    await publishPreview(next, rendered?.workingBlob || source);
    await persistWorkspaceLog(workspace.workspaceId, "imageShared", image.imageId);
  }, [clearCollaborationHistory, imageProcessing, imagesRef, persistWorkspaceLog, publishPreview, releaseCollaborationContainer, sendRealtime, setNotice, syncCollaborationPreview, updateImage, workspace]);

  return { publishPreview, publishImage };
}
