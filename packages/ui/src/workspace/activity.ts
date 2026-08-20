import type { WorkspaceActivity } from "./types";

export const COLLABORATION_ACTIVITY_KINDS = new Set([
  "operationCommitted",
  "proposalSubmitted",
  "proposalApproved",
  "proposalRejected",
  "proposalDeferred",
  "collaborationSaved",
]);

export function isCollaborationActivity(value: WorkspaceActivity) {
  return value.scope === "collaborationActivity"
    && COLLABORATION_ACTIVITY_KINDS.has(value.kind)
    && Boolean(value.imageId);
}

export function collaborationActivitiesForImage(
  activities: WorkspaceActivity[],
  imageId: string,
) {
  return activities.filter((activity) =>
    activity.imageId === imageId && isCollaborationActivity(activity));
}

export function currentActivityEventId(
  activities: WorkspaceActivity[],
  currentCommitId?: string | null,
) {
  if (!currentCommitId) return null;
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const detail = activities[index].detail;
    if (activities[index].kind === "proposalSubmitted") continue;
    if (detail && typeof detail === "object"
      && (detail as Record<string, unknown>).commitId === currentCommitId) {
      return activities[index].eventId;
    }
  }
  return null;
}
