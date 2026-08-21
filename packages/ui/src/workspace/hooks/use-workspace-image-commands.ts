import React from "react";
import {
  clearWorkspaceImageHistory,
  deleteWorkspaceImage,
  saveCommit,
} from "../repository";
import { cachedCommit } from "../utils/workspace-page-utils";
import { browserReportsWeakNetwork, canDeleteWorkspaceImage, shouldSuggestWorkspaceCompression } from "../image-flow";
import { emptyImageParameterDocument } from "../image-protocol";
import { dimensions } from "../utils/workspace-image-display";
import { readWorkspaceImageSource } from "../repository";
import { disposeCollaborationImageContainer, type CollaborationImageContainer } from "../collaboration-image-container";
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
  setCompressionSuggestionWeakNetwork: SetState<boolean>;
  setImages: SetState<WorkspaceImage[]>;
  setCommits: SetState<WorkspaceCommit[]>;
  setActivities: SetState<WorkspaceActivity[]>;
  setProposals: SetState<WorkspaceProposal[]>;
  setNewVersions: SetState<Record<string, string>>;
  setMaximizedImageId: SetState<string | null>;
  setProcessingSource: SetState<{ imageId: string; blob: Blob; width: number; height: number } | null>;
  setEditing: SetState<any>;
  setReviewOpen: SetState<boolean>;
  setActivityPreview: SetState<any>;
  setRollbackTarget: SetState<any>;
  setRollbackPreview: SetState<any>;
  setDeletingImage: SetState<WorkspaceImage | null>;
  setDeleteChoice: SetState<"library" | "permanent">;
  setNotice: (message: string) => void;
  sendRealtime: (type: string, payload: Record<string, unknown>) => void;
  collaborationDeleteBlockedMessage: string;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string, detail?: unknown) => Promise<void>;
  releaseProcessingSource: () => void;
};

export function useWorkspaceImageCommands(options: ImageCommandsOptions) {
  const {
    workspace, imagesRef, collaborationContainers, selectedId, maximizedImageId,
    processingSource, activityPreview, rollbackTarget, deleteChoice, deletingImage,
    setSelectedId, setPendingWorkingImageId, setCompressionSuggestionWeakNetwork, setImages, setCommits, setActivities, setProposals, setNewVersions,
    setMaximizedImageId, setProcessingSource, setEditing, setReviewOpen, setActivityPreview,
    setRollbackTarget, setRollbackPreview, setDeletingImage, setDeleteChoice, setNotice,
    sendRealtime, collaborationDeleteBlockedMessage, updateImage, persistWorkspaceLog, releaseProcessingSource,
  } = options;

  const clearTransientState = React.useCallback((imageId: string) => {
    const container = collaborationContainers.current.get(imageId);
    if (container) disposeCollaborationImageContainer(container);
    collaborationContainers.current.delete(imageId);
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
  }, [activityPreview, collaborationContainers, maximizedImageId, processingSource, rollbackTarget, setActivityPreview, setEditing, setMaximizedImageId, setProcessingSource, setReviewOpen, setRollbackPreview, setRollbackTarget]);

  const moveImageToWorking = React.useCallback(async (image: WorkspaceImage) => {
    if (!workspace || workspace.role !== "owner") return;
    await updateImage(image.imageId, {
      workspaceLocation: "working",
      state: image.state === "private" ? "working" : image.state,
    });
    setSelectedId(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId, "imageMovedToWorking", image.imageId);
  }, [persistWorkspaceLog, setSelectedId, updateImage, workspace]);

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
    if (!workspace || workspace.role !== "owner") return;
    if (image.shared) {
      setNotice(collaborationDeleteBlockedMessage);
      return;
    }
    sendRealtime("previewRemove", { imageId: image.imageId });
    const source = image.sourceCached ? await readWorkspaceImageSource(image) : null;
    const sourceSize = source ? await dimensions(source) : { width: image.width, height: image.height };
    const initialCommitId = `initial_${image.imageId}`;
    await clearWorkspaceImageHistory(image.imageId);
    await updateImage(image.imageId, {
      workspaceLocation: "library", shared: false, state: "private", currentCommitId: initialCommitId,
      parameterDocument: emptyImageParameterDocument(), width: sourceSize.width, height: sourceSize.height,
    });
    const initialCommit: WorkspaceCommit = {
      commitId: initialCommitId, imageId: image.imageId, authorId: "owner", parentCommitId: null,
      mergeParentCommitIds: [], operations: [], createdAt: Date.now(),
    };
    await saveCommit(initialCommit);
    setCommits((current) => [...current.filter((commit) => commit.imageId !== image.imageId), cachedCommit(initialCommit)]);
    setActivities((current) => current.filter((activity) => activity.imageId !== image.imageId));
    setProposals((current) => current.filter((proposal) => proposal.imageId !== image.imageId));
    setNewVersions((current) => { const next = { ...current }; delete next[image.imageId]; return next; });
    clearTransientState(image.imageId);
    if (processingSource?.imageId === image.imageId) releaseProcessingSource();
    setSelectedId(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId, "imageMovedToLibrary", image.imageId);
  }, [clearTransientState, collaborationDeleteBlockedMessage, persistWorkspaceLog, processingSource, releaseProcessingSource, sendRealtime, setActivities, setCommits, setNewVersions, setNotice, setProposals, setSelectedId, updateImage, workspace]);

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
