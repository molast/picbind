"use client";

export { default as ShareRoomPage } from "./components/share/share-room-page";
export { default as CreateRoomButton } from "./components/share/create-room-button";
export { configureRoomSdk } from "./config";
export { ROOM_VERSION } from "./version";
export { default as WorkerVersionWarning } from "./components/share/worker-version-warning";
export {
  EXPECTED_WORKER_VERSION,
  WORKER_VERSION_HEADER,
  checkWorkerVersion,
  type WorkerVersionMismatch,
} from "./worker-version";
export * from "./messaging";
export type { RoomSdkConfig } from "./config";
export type { ShareRoom } from "./utils/share-room";
export {
  getLang,
  getShareRoomLabels,
  setLang,
  type Lang,
  type ShareRoomLabels,
} from "./locales";
export type {
  ActivityItem,
  ConnectionState,
  RoomImage,
} from "./components/share/share-room-types";
export type { ImagePlaceholderMetadata } from "./utils/share-placeholder";
export type {
  ReviewAnchor,
  ReviewAnnotation,
  ReviewOperation,
} from "./utils/review-collaboration";
