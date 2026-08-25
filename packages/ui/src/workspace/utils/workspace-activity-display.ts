import type { WorkspaceActivity } from "../types";
import { getLang, getWorkspaceLabels, type Lang, type WorkspaceLabels } from "../../locales";

export function activityOperationName(activity: WorkspaceActivity) {
  const detail = activity.detail && typeof activity.detail === "object" ? activity.detail as Record<string, unknown> : {};
  if (typeof detail.operationType === "string") return detail.operationType;
  const first = Array.isArray(detail.operations) ? detail.operations[0] : undefined;
  if (first && typeof first === "object") { const value = first as Record<string, unknown>; if (typeof value.operationType === "string") return value.operationType; if (typeof value.type === "string") return value.type; }
  return null;
}

export function readableOperationName(value: string, labels: WorkspaceLabels) {
  const readable = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
  const names: Record<string, string> = {
    brightness: labels.brightness,
    color: labels.color,
    crop: labels.crop,
    resize: labels.resize,
    draw: labels.doodle,
    compression: labels.compress,
    other: labels.convert,
  };
  return names[value] || readable(value);
}

export function readableActivityName(activity: WorkspaceActivity, lang: Lang = getLang()) {
  const labels = getWorkspaceLabels(lang);
  const readable = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
  const operation = activityOperationName(activity);
  const suffix: Record<string, string> = {
    operationCommitted: labels.applied,
    proposalSubmitted: labels.proposalSubmitted,
    proposalApproved: labels.proposalApproved,
    proposalRejected: labels.proposalRejected,
    proposalDeferred: labels.proposalDeferred,
    historyRolledBack: labels.historyRolledBack,
    collaborationSaved: labels.imageSaved,
  };
  return operation
    ? `${readableOperationName(operation, labels)} · ${suffix[activity.kind] || readable(activity.kind)}`
    : suffix[activity.kind] || readable(activity.kind);
}

export function proposalIdForActivity(activity: WorkspaceActivity) {
  if (!activity.detail || typeof activity.detail !== "object") return null;
  const proposalId = (activity.detail as Record<string, unknown>).proposalId;
  return typeof proposalId === "string" ? proposalId : null;
}
