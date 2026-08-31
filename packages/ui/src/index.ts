"use client";

export { default as WorkerVersionWarning } from "./components/share/worker-version-warning";
export { default as WorkspacePage } from "./workspace/page/workspace-page";
export { WorkspaceLanguageSwitcher } from "./workspace/components/workspace-language-switcher";
export { default as WorkspaceShareIdEntryDialog } from "./workspace/dialogs/workspace-share-id-entry-dialog";
export * from "./image-processing";
export * from "./realtime";
export * from "./workspace/types";
export {
  EXPECTED_WORKER_VERSION,
  WORKER_VERSION_HEADER,
  checkWorkerVersion,
  type WorkerVersionMismatch,
} from "./worker-version";
export * from "./messaging";
export {
  getLang,
  getShareRoomLabels,
  setLang,
  type Lang,
  type ShareRoomLabels,
} from "./locales";
export type { ImagePlaceholderMetadata } from "./utils/share-placeholder";
export {
  compactUuid,
  createCompactId,
  createPrefixedId,
  createUuid,
  createWorkspaceCommitId,
  initialWorkspaceCommitId,
  isInitialWorkspaceCommitId,
} from "./utils/id";
export type {
  ReviewAnchor,
  ReviewAnnotation,
  ReviewOperation,
} from "./utils/review-collaboration";
