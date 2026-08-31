import React from "react";
import { useImageProcessing } from "../../image-processing";
import {
  clearWorkspaceImageHistory,
  deleteWorkspaceImage,
  getWorkspaceImageProcessingSource,
  saveCommit,
} from "../repository";
import { cachedCommit } from "../utils/workspace-page-utils";
import { browserReportsWeakNetwork, canDeleteWorkspaceImage, shouldSuggestWorkspaceCompression } from "../image-flow";
import { emptyImageParameterDocument } from "../image-protocol";
import { initialWorkspaceCommitId } from "../../utils/id";
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
  deleteChoice: "library" | "permanent";
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
  setDeleteChoice: SetState<"library" | "permanent">;
  setNotice: (message: string) => void;
  collaborationDeleteBlockedMessage: string;
  imageActionFailedMessage: string;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string, detail?: unknown) => Promise<void>;
  releaseProcessingSource: () => void;
  releaseCollaborationContainer: (imageId: string) => void;
};

export function useWorkspaceImageCommands(options: ImageCommandsOptions) {
  const imageProcessing = useImageProcessing();
  const movingToWorkingImageIdsRef = React.useRef(new Set<string>());
  const {
    workspace, imagesRef, collaborationContainers, selectedId, maximizedImageId,
    processingSource, activityPreview, rollbackTarget, deleteChoice, deletingImage,
    setSelectedId, setPendingWorkingImageId, setMovingToWorkingImageIds, setCompressionSuggestionWeakNetwork, setImages, setCommits, setActivities, setProposals, setNewVersions,
    setMaximizedImageId, setProcessingSource, setEditing, setReviewOpen, setActivityPreview,
    setRollbackTarget, setRollbackPreview, setDeletingImage, setDeleteChoice, setNotice,
    collaborationDeleteBlockedMessage, imageActionFailedMessage, updateImage, persistWorkspaceLog,
    releaseProcessingSource, releaseCollaborationContainer,
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
      let sourceSize: { width: number; height: number } | undefined;
      if (source) {
        if (image.width < 1 || image.height < 1) {
          const metadata = await imageProcessing.inspect(source, {
            requestId: `workspace-working-source-metadata:${image.imageId}`,
          });
          sourceSize = { width: metadata.width, height: metadata.height };
        }
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
      }
      await updateImage(image.imageId, {
        workspaceLocation: "working",
        state: image.state === "private" ? "working" : image.state,
        ...(preview ? {
          preview,
          previewCached: true,
          previewRevision: image.previewRevision + 1,
        } : {}),
        ...(sourceSize || {}),
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

  const moveImageToLibrary = React.useCallback(async (image: WorkspaceImage) => {
    const current = imagesRef.current.find((candidate) => candidate.imageId === image.imageId) || image;
    if (!workspace || workspace.role !== "owner" || current.workspaceLocation !== "working"
      || current.shared || movingToWorkingImageIdsRef.current.has(current.imageId)) return false;
    movingToWorkingImageIdsRef.current.add(current.imageId);
    setMovingToWorkingImageIds((value) => new Set(value).add(current.imageId));
    try {
      const source = current.sourceCached ? await getWorkspaceImageProcessingSource(current) : null;
      const metadata = source
        ? await imageProcessing.inspect(source, { requestId: `workspace-return-library:${current.imageId}` }).catch(() => null)
        : null;
      const sourceSize = metadata
        ? { width: metadata.width, height: metadata.height }
        : { width: current.width, height: current.height };
      const initialCommitId = initialWorkspaceCommitId(current.imageId);
      await clearWorkspaceImageHistory(current.imageId);
      await updateImage(current.imageId, {
        workspaceLocation: "library",
        shared: false,
        state: "private",
        currentCommitId: initialCommitId,
        parameterDocument: emptyImageParameterDocument(),
        placeholder: undefined,
        width: sourceSize.width,
        height: sourceSize.height,
      });
      const initialCommit: WorkspaceCommit = {
        commitId: initialCommitId,
        imageId: current.imageId,
        authorId: "owner",
        parentCommitId: null,
        mergeParentCommitIds: [],
        operations: [],
        snapshotCached: Boolean(source),
        snapshotName: current.name,
        snapshotMimeType: current.mimeType,
        snapshotWidth: sourceSize.width,
        snapshotHeight: sourceSize.height,
        createdAt: Date.now(),
      };
      await saveCommit(initialCommit);
      setCommits((value) => [...value.filter((commit) => commit.imageId !== current.imageId), cachedCommit(initialCommit)]);
      setActivities((value) => value.filter((activity) => activity.imageId !== current.imageId));
      setProposals((value) => value.filter((proposal) => proposal.imageId !== current.imageId));
      setNewVersions((value) => {
        if (!(current.imageId in value)) return value;
        const next = { ...value };
        delete next[current.imageId];
        return next;
      });
      if (processingSource?.imageId === current.imageId) releaseProcessingSource();
      clearTransientState(current.imageId);
      setSelectedId(current.imageId);
      await persistWorkspaceLog(workspace.workspaceId, "imageMovedToLibrary", current.imageId);
      return true;
    } catch (error) {
      console.error("Failed to return image to Library", error);
      setNotice(imageActionFailedMessage);
      return false;
    } finally {
      movingToWorkingImageIdsRef.current.delete(current.imageId);
      setMovingToWorkingImageIds((value) => {
        if (!value.has(current.imageId)) return value;
        const next = new Set(value);
        next.delete(current.imageId);
        return next;
      });
    }
  }, [clearTransientState, imageActionFailedMessage, imageProcessing, imagesRef, persistWorkspaceLog, processingSource, releaseProcessingSource, setActivities, setCommits, setMovingToWorkingImageIds, setNewVersions, setNotice, setProposals, setSelectedId, updateImage, workspace]);

  const requestDeleteImage = React.useCallback((image: WorkspaceImage) => {
    if (!canDeleteWorkspaceImage(image)) {
      setNotice(collaborationDeleteBlockedMessage);
      return;
    }
    setDeleteChoice(image.workspaceLocation === "working" ? "library" : "permanent");
    setDeletingImage(image);
  }, [collaborationDeleteBlockedMessage, setDeleteChoice, setDeletingImage, setNotice]);

  const confirmDeleteImage = React.useCallback(async () => {
    if (!workspace || !deletingImage) return;
    const image = deletingImage;
    setDeletingImage(null);
    if (deleteChoice === "library" && image.workspaceLocation === "working") {
      await moveImageToLibrary(image);
      return;
    }
    await deleteWorkspaceImage(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId, "imageDeleted", undefined, { imageId: image.imageId, name: image.name });
    setImages((current) => current.filter((item) => item.imageId !== image.imageId));
    setCommits((current) => current.filter((commit) => commit.imageId !== image.imageId));
    setActivities((current) => current.filter((activity) => activity.imageId !== image.imageId));
    setProposals((current) => current.filter((proposal) => proposal.imageId !== image.imageId));
    setNewVersions((current) => { const next = { ...current }; delete next[image.imageId]; return next; });
    clearTransientState(image.imageId);
    if (selectedId === image.imageId) setSelectedId(null);
  }, [clearTransientState, deleteChoice, deletingImage, moveImageToLibrary, persistWorkspaceLog, selectedId, setActivities, setCommits, setDeletingImage, setImages, setNewVersions, setProposals, setSelectedId, workspace]);

  return { moveImageToWorking, requestMoveImageToWorking, moveImageToLibrary, requestDeleteImage, confirmDeleteImage };
}
