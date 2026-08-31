import React from "react";
import { useImageProcessing } from "../../image-processing";
import {
  deleteWorkspaceImage,
  getWorkspaceImageProcessingSource,
} from "../repository";
import { browserReportsWeakNetwork, canDeleteWorkspaceImage, shouldSuggestWorkspaceCompression } from "../image-flow";
import { emptyImageParameterDocument } from "../image-protocol";
import type { CollaborationImageContainer } from "../collaboration-image-container";
import {
  COLLABORATION_PREVIEW_MAX_HEIGHT,
  COLLABORATION_PREVIEW_MAX_WIDTH,
  COLLABORATION_PREVIEW_QUALITY,
} from "../collaboration-image-container";
import type { WorkspaceProcessingSource } from "./use-workspace-preview";
import type { WorkspaceActivity, WorkspaceCommit, WorkspaceIdentity, WorkspaceImage, WorkspaceProposal } from "../types";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

type ImageCommandsOptions = {
  workspace: WorkspaceIdentity | null;
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  selectedId: string | null;
  maximizedImageId: string | null;
  processingSource: { imageId: string } | null;
  activityPreview: { activity: { imageId?: string } } | null;
  rollbackTarget: { imageId: string } | null;
  deletingImage: WorkspaceImage | null;
  setSelectedId: SetState<string | null>;
  setPendingWorkingImageId: SetState<string | null>;
  setMovingToWorkingImageIds: SetState<ReadonlySet<string>>;
  setCompressionSuggestionWeakNetwork: SetState<boolean>;
  setImages: SetState<WorkspaceImage[]>;
  setCommits: SetState<WorkspaceCommit[]>;
  setActivities: SetState<WorkspaceActivity[]>;
  setProposals: SetState<WorkspaceProposal[]>;
  setNewVersions: SetState<Record<string, string>>;
  setMaximizedImageId: SetState<string | null>;
  setProcessingSource: SetState<WorkspaceProcessingSource | null>;
  setEditing: SetState<any>;
  setReviewOpen: SetState<boolean>;
  setActivityPreview: SetState<any>;
  setRollbackTarget: SetState<any>;
  setRollbackPreview: SetState<any>;
  setDeletingImage: SetState<WorkspaceImage | null>;
  setNotice: (message: string) => void;
  collaborationDeleteBlockedMessage: string;
  imageActionFailedMessage: string;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string, detail?: unknown) => Promise<void>;
  releaseCollaborationContainer: (imageId: string) => void;
};

export function useWorkspaceImageCommands(options: ImageCommandsOptions) {
  const imageProcessing = useImageProcessing();
  const movingToWorkingImageIdsRef = React.useRef(new Set<string>());
  const {
    workspace, imagesRef, collaborationContainers, selectedId, maximizedImageId,
    processingSource, activityPreview, rollbackTarget, deletingImage,
    setSelectedId, setPendingWorkingImageId, setMovingToWorkingImageIds, setCompressionSuggestionWeakNetwork, setImages, setCommits, setActivities, setProposals, setNewVersions,
    setMaximizedImageId, setProcessingSource, setEditing, setReviewOpen, setActivityPreview,
    setRollbackTarget, setRollbackPreview, setDeletingImage, setNotice,
    collaborationDeleteBlockedMessage, imageActionFailedMessage, updateImage, persistWorkspaceLog,
    releaseCollaborationContainer,
  } = options;

  const clearTransientState = React.useCallback((imageId: string) => {
    releaseCollaborationContainer(imageId);
    if (maximizedImageId === imageId) setMaximizedImageId(null);
    if (processingSource?.imageId === imageId) {
      setProcessingSource(null);
      setEditing(null);
      setReviewOpen(false);
    }
    if (activityPreview?.activity.imageId === imageId) setActivityPreview(null);
    if (rollbackTarget?.imageId === imageId) {
      setRollbackTarget(null);
      setRollbackPreview(null);
    }
  }, [activityPreview, maximizedImageId, processingSource, releaseCollaborationContainer, rollbackTarget, setActivityPreview, setEditing, setMaximizedImageId, setProcessingSource, setReviewOpen, setRollbackPreview, setRollbackTarget]);

  const moveImageToWorking = React.useCallback(async (image: WorkspaceImage) => {
    if (!workspace || workspace.role !== "owner" || image.workspaceLocation !== "library" || movingToWorkingImageIdsRef.current.has(image.imageId)) return false;
    movingToWorkingImageIdsRef.current.add(image.imageId);
    setMovingToWorkingImageIds((current) => new Set(current).add(image.imageId));
    try {
      const source = image.sourceCached ? await getWorkspaceImageProcessingSource(image) : null;
      let preview: Blob | undefined;
      let previewSize: { width: number; height: number } | undefined;
      if (source) {
        const result = await imageProcessing.renderPreview({
          source,
          document: emptyImageParameterDocument(),
          maxWidth: COLLABORATION_PREVIEW_MAX_WIDTH,
          maxHeight: COLLABORATION_PREVIEW_MAX_HEIGHT,
          mimeType: "image/webp",
          quality: COLLABORATION_PREVIEW_QUALITY,
        }, { requestId: `workspace-working-thumbnail:${image.imageId}:${image.previewRevision + 1}` });
        if (result.artifact.kind !== "blob") throw new Error("Working thumbnail did not return cache file bytes");
        preview = result.artifact.blob;
        previewSize = { width: result.width, height: result.height };
      }
      await updateImage(image.imageId, {
        workspaceLocation: "working",
        state: image.state === "private" ? "working" : image.state,
        ...(preview ? {
          preview,
          previewCached: true,
          previewRevision: image.previewRevision + 1,
          width: previewSize!.width,
          height: previewSize!.height,
        } : {}),
      });
      setSelectedId(image.imageId);
      await persistWorkspaceLog(workspace.workspaceId, "imageMovedToWorking", image.imageId);
      return true;
    } catch (error) {
      console.error("Failed to move image to Working", error);
      setNotice(imageActionFailedMessage);
      return false;
    } finally {
      movingToWorkingImageIdsRef.current.delete(image.imageId);
      setMovingToWorkingImageIds((current) => {
        if (!current.has(image.imageId)) return current;
        const next = new Set(current);
        next.delete(image.imageId);
        return next;
      });
    }
  }, [imageActionFailedMessage, imageProcessing, persistWorkspaceLog, setMovingToWorkingImageIds, setNotice, setSelectedId, updateImage, workspace]);

  const requestMoveImageToWorking = React.useCallback((image: WorkspaceImage) => {
    const weakNetwork = browserReportsWeakNetwork();
    if (shouldSuggestWorkspaceCompression(image.size, weakNetwork)) {
      setCompressionSuggestionWeakNetwork(weakNetwork);
      setPendingWorkingImageId(image.imageId);
      return;
    }
    void moveImageToWorking(image);
  }, [moveImageToWorking, setCompressionSuggestionWeakNetwork, setPendingWorkingImageId]);

  const requestDeleteImage = React.useCallback((image: WorkspaceImage) => {
    if (!canDeleteWorkspaceImage(image)) {
      setNotice(collaborationDeleteBlockedMessage);
      return;
    }
    setDeletingImage(image);
  }, [collaborationDeleteBlockedMessage, setDeletingImage, setNotice]);

  const confirmDeleteImage = React.useCallback(async () => {
    if (!workspace || !deletingImage) return;
    const image = deletingImage;
    setDeletingImage(null);
    await deleteWorkspaceImage(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId, "imageDeleted", undefined, { imageId: image.imageId, name: image.name });
    setImages((current) => current.filter((item) => item.imageId !== image.imageId));
    setCommits((current) => current.filter((commit) => commit.imageId !== image.imageId));
    setActivities((current) => current.filter((activity) => activity.imageId !== image.imageId));
    setProposals((current) => current.filter((proposal) => proposal.imageId !== image.imageId));
    setNewVersions((current) => { const next = { ...current }; delete next[image.imageId]; return next; });
    clearTransientState(image.imageId);
    if (selectedId === image.imageId) setSelectedId(null);
  }, [clearTransientState, deletingImage, persistWorkspaceLog, selectedId, setActivities, setCommits, setDeletingImage, setImages, setNewVersions, setProposals, setSelectedId, workspace]);

  return { moveImageToWorking, requestMoveImageToWorking, requestDeleteImage, confirmDeleteImage };
}
