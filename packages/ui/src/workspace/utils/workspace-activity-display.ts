import type { WorkspaceActivity } from "../types";

export function activityOperationName(activity: WorkspaceActivity) {
  const detail = activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : {};
  if (typeof detail.operationType === "string") return detail.operationType;
  const first = Array.isArray(detail.operations) ? detail.operations[0] : undefined;
  if (first && typeof first === "object") { const value = first as Record<string, unknown>; if (typeof value.operationType === "string") return value.operationType; if (typeof value.type === "string") return value.type; }
  return null;
}

export function readableActivityName(activity: WorkspaceActivity) {
  const readable = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
  const operation = activityOperationName(activity);
  const suffix: Record<string, string> = { operationCommitted: "applied", proposalSubmitted: "proposal submitted", proposalApproved: "proposal approved", proposalRejected: "proposal rejected", proposalDeferred: "proposal deferred", historyRolledBack: "history rolled back", collaborationSaved: "image saved" };
  return operation ? `${readable(operation)} · ${suffix[activity.kind] || readable(activity.kind)}` : suffix[activity.kind] ? readable(suffix[activity.kind]) : readable(activity.kind);
}

export function proposalIdForActivity(activity: WorkspaceActivity) {
  if (!activity.detail || typeof activity.detail !== "object") return null;
  const proposalId = (activity.detail as Record<string, unknown>).proposalId;
  return typeof proposalId === "string" ? proposalId : null;
}
