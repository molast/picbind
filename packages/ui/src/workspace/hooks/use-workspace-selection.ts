import React from "react";
import { collaborationActivitiesForImage, currentActivityEventId } from "../activity";
import { initialWorkspaceCommitId } from "../../utils/id";
import type { Collaborator, WorkspaceActivity, WorkspaceCommit, WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspaceSelection({ images, workspace, selectedId, pendingWorkingImageId, compressingToWorkingImageId, collaborators, runtime, activities, operationLogs, commits, activityPreviewEventId }: { images: WorkspaceImage[]; workspace: WorkspaceIdentity | null; selectedId: string | null; pendingWorkingImageId: string | null; compressingToWorkingImageId: string | null; collaborators: Collaborator[]; runtime: string; activities: WorkspaceActivity[]; operationLogs: WorkspaceActivity[]; commits: WorkspaceCommit[]; activityPreviewEventId?: string }) {
  const deduplicatedImages = React.useMemo(() => [...new Map(images.map((image) => [image.imageId, image])).values()], [images]);
  const selected = deduplicatedImages.find((image) => image.imageId === selectedId) || null;
  const selectedIsLibrary = workspace?.role === "owner" && selected?.workspaceLocation === "library";
  const realtimeConnected = runtime === "connected" || runtime === "available" || runtime === "syncing";
  const deduplicatedCollaborators = React.useMemo(() => [...new Map(collaborators.map((person) => [person.clientId, person])).values()], [collaborators]);
  const onlineCollaborators = realtimeConnected ? deduplicatedCollaborators.filter((value) => value.online) : [];
  const onlinePeers = onlineCollaborators.length;
  const libraryImages = deduplicatedImages.filter((image) => workspace?.role === "owner" && image.workspaceLocation === "library");
  const workingImages = deduplicatedImages.filter((image) => workspace?.role === "collaborator" || image.workspaceLocation === "working");
  const workingImagesSorted = [...workingImages].sort((left, right) => (right.pinnedAt || 0) - (left.pinnedAt || 0) || right.updatedAt - left.updatedAt);
  const pendingWorkingImage = images.find((image) => image.imageId === pendingWorkingImageId) || null;
  const compressingToWorkingImage = images.find((image) => image.imageId === compressingToWorkingImageId) || null;
  const completeOperationLog = [...operationLogs, ...activities.filter((activity) => activity.kind !== "historyRolledBack")].sort((left, right) => left.createdAt - right.createdAt);
  const selectedCollaborationActivities = selected?.shared ? collaborationActivitiesForImage(activities, selected.imageId) : [];
  const currentCollaborationActivityId = currentActivityEventId(selectedCollaborationActivities, selected?.currentCommitId);
  const activityPreviewIsCurrent = activityPreviewEventId === currentCollaborationActivityId;
  const selectedImageCommits = selected ? commits.filter((commit) => commit.imageId === selected.imageId).sort((left, right) => left.createdAt - right.createdAt) : [];
  const selectedOriginalCommit = selected ? selectedImageCommits.find((commit) => commit.commitId.startsWith("initial_")) || { commitId: initialWorkspaceCommitId(selected.imageId), imageId: selected.imageId, authorId: "owner", parentCommitId: null, mergeParentCommitIds: [], operations: [], createdAt: 0 } : undefined;
  return { deduplicatedImages, selected, selectedIsLibrary, realtimeConnected, onlineCollaborators, onlinePeers, libraryImages, workingImages, workingImagesSorted, pendingWorkingImage, compressingToWorkingImage, completeOperationLog, selectedCollaborationActivities, currentCollaborationActivityId, activityPreviewIsCurrent, selectedImageCommits, selectedOriginalCommit };
}
