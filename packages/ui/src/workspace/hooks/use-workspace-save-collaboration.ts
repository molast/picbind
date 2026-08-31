import React from "react";
import { useImageProcessing } from "../../image-processing";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import {
  COLLABORATION_PREVIEW_MAX_HEIGHT,
  COLLABORATION_PREVIEW_MAX_WIDTH,
  COLLABORATION_PREVIEW_QUALITY,
  type CollaborationImageContainer,
} from "../collaboration-image-container";
import { emptyImageParameterDocument } from "../image-protocol";
import { initialWorkspaceCommitId } from "../../utils/id";
import { workspaceEditedImageName } from "../utils/workspace-image-output";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export type CollaborationSaveChoice = "copy" | "replace";

export function useWorkspaceSaveCollaboration({
  workspace,
  selected,
  imagesRef,
  setCollaborationSaving,
  setNotice,
  updateImage,
  syncCollaborationContainer,
  syncCollaborationPreview,
  releaseCollaborationContainer,
  clearCollaborationHistory,
  saveProcessedCopy,
  persistCollaborationActivity,
  broadcastWorkspaceSnapshot,
}: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  setCollaborationSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  syncCollaborationContainer: (image: WorkspaceImage, document: any) => Promise<CollaborationImageContainer | null>;
  syncCollaborationPreview: (image: WorkspaceImage, document: any, sourceOverride?: Blob) => Promise<CollaborationImageContainer | null>;
  releaseCollaborationContainer: (imageId: string) => void;
  clearCollaborationHistory: (imageId: string) => Promise<void>;
  saveProcessedCopy: (source: WorkspaceImage, result: ProcessedImageResult) => Promise<string | undefined>;
  persistCollaborationActivity: (workspaceId: string, kind: string, imageId: string, detail: unknown, actorId?: string) => Promise<void>;
  broadcastWorkspaceSnapshot: () => Promise<void>;
}) {
  const imageProcessing = useImageProcessing();
  const saveInFlight = React.useRef(false);

  const currentRender = React.useCallback(async (image: WorkspaceImage) => {
    const container = await syncCollaborationContainer(
      image,
      image.parameterDocument || emptyImageParameterDocument(),
    );
    if (!container) throw new Error("Source data is unavailable");
    return container;
  }, [syncCollaborationContainer]);

  const saveCollaborativeCopy = React.useCallback(async (image: WorkspaceImage) => {
    if (!workspace || workspace.role !== "owner" || image.workspaceLocation !== "working" || !image.sourceCached) return null;
    const container = await currentRender(image);
    const result = {
      blob: container.workingBlob,
      name: workspaceEditedImageName(image.name, container.mimeType),
      mimeType: container.mimeType,
      width: container.width,
      height: container.height,
    };
    const savedImageId = await saveProcessedCopy(image, {
      ...result,
      operation: "adjust",
      parameters: {},
    } as ProcessedImageResult);
    if (!savedImageId) return null;
    if (image.shared) {
      await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", image.imageId, {
        mode: "copy",
        commitId: image.currentCommitId,
      }, "owner");
    }
    return savedImageId;
  }, [currentRender, persistCollaborationActivity, saveProcessedCopy, workspace]);

  const replaceCollaborativeImage = React.useCallback(async (
    image: WorkspaceImage,
    continueCollaboration: boolean,
  ) => {
    if (!workspace || workspace.role !== "owner" || image.workspaceLocation !== "working" || !image.sourceCached) return null;
    const container = await currentRender(image);
    const rendered = container.workingBlob;
    const thumbnail = await imageProcessing.renderPreview({
      source: {
        kind: "blob",
        blob: rendered,
        name: container.name,
        mimeType: rendered.type || container.mimeType,
      },
      document: emptyImageParameterDocument(),
      maxWidth: COLLABORATION_PREVIEW_MAX_WIDTH,
      maxHeight: COLLABORATION_PREVIEW_MAX_HEIGHT,
      mimeType: "image/webp",
      quality: COLLABORATION_PREVIEW_QUALITY,
    }, { requestId: `workspace-image-replace-thumbnail:${image.imageId}:${image.previewRevision + 1}` });
    if (thumbnail.artifact.kind !== "blob") {
      throw new Error("Working thumbnail did not return cache file bytes");
    }

    const parameterDocument = emptyImageParameterDocument();
    const currentCommitId = initialWorkspaceCommitId(image.imageId);
    await updateImage(image.imageId, {
      source: rendered,
      sourceCached: true,
      preview: thumbnail.artifact.blob,
      previewCached: true,
      previewRevision: image.previewRevision + 1,
      placeholder: undefined,
      name: container.name,
      mimeType: rendered.type || container.mimeType,
      size: rendered.size,
      width: container.width,
      height: container.height,
      currentCommitId,
      parameterDocument,
      state: image.shared ? "shared" : "working",
    });
    await clearCollaborationHistory(image.imageId);
    releaseCollaborationContainer(image.imageId);

    if (image.shared && continueCollaboration) {
      const rebased = imagesRef.current.find((candidate) => candidate.imageId === image.imageId);
      if (!rebased) throw new Error("Rebased image is unavailable");
      await syncCollaborationPreview(rebased, parameterDocument, rendered);
      await broadcastWorkspaceSnapshot();
    }

    if (image.shared) {
      await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", image.imageId, {
        mode: "replace",
        commitId: currentCommitId,
      }, "owner");
    }
    return image.imageId;
  }, [broadcastWorkspaceSnapshot, clearCollaborationHistory, currentRender, imageProcessing, imagesRef, persistCollaborationActivity, releaseCollaborationContainer, syncCollaborationPreview, updateImage, workspace]);

  const saveCurrentImage = React.useCallback(async (
    choice: CollaborationSaveChoice,
    image = selected,
    options: { continueCollaboration?: boolean } = {},
  ) => {
    if (!image || saveInFlight.current) return null;
    const current = imagesRef.current.find((candidate) => candidate.imageId === image.imageId) || image;
    saveInFlight.current = true;
    setCollaborationSaving(true);
    try {
      return choice === "copy"
        ? await saveCollaborativeCopy(current)
        : await replaceCollaborativeImage(current, options.continueCollaboration !== false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save image");
      return null;
    } finally {
      saveInFlight.current = false;
      setCollaborationSaving(false);
    }
  }, [imagesRef, replaceCollaborativeImage, saveCollaborativeCopy, selected, setCollaborationSaving, setNotice]);

  const saveCollaborativeImage = React.useCallback(async (
    choice: CollaborationSaveChoice,
    image = selected,
    options: { continueCollaboration?: boolean } = {},
  ) => Boolean(await saveCurrentImage(choice, image, options)), [saveCurrentImage, selected]);

  return { saveCollaborativeImage, saveCurrentImage };
}
