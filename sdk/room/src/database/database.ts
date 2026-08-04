"use client";

import Dexie, { type Table } from "dexie";
import type { RoomEventItem } from "../utils/room-event";
import type {
  CachedCompressedImage,
  CachedRoomImage,
  StoredReviewHistory,
} from "./types/storage";

export type CompressedImageRecord = Omit<CachedCompressedImage, "blob"> & {
  filePath: string;
};

export type QueuedFileRecord = {
  id: string;
  name: string;
  type: string;
  size: number;
  filePath: string;
  createdAt: number;
};

export type RoomImageRecord = Omit<CachedRoomImage, "blob" | "thumbnail"> & {
  filePath: string | null;
  thumbnailPath: string | null;
  updatedAt: number;
};

export type ReviewHistoryRecord = StoredReviewHistory & {
  roomId: string;
  imageId: string;
  updatedAt: number;
};

export type OperationLogRecord = RoomEventItem & {
  roomId: string;
};

export type MessagingImageRecord = {
  providerId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  direction?: "incoming" | "outgoing";
  filePath: string;
};

class PicbindDatabase extends Dexie {
  compressedImages!: Table<CompressedImageRecord, string>;
  queuedFiles!: Table<QueuedFileRecord, string>;
  roomImages!: Table<RoomImageRecord, [string, string]>;
  reviewHistories!: Table<ReviewHistoryRecord, [string, string]>;
  operationLogs!: Table<OperationLogRecord, [string, string]>;
  messagingImages!: Table<MessagingImageRecord, [string, string]>;

  constructor() {
    super("picbind-local");
    this.version(1).stores({
      compressedImages: "id, sourceId, createdAt",
      queuedFiles: "id, createdAt",
      roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
      reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
      operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
    });
    this.version(2).stores({
      compressedImages: "id, sourceId, createdAt",
      queuedFiles: "id, createdAt",
      roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
      reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
      operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
      messagingImages:
        "[providerId+messageId], providerId, messageId, createdAt",
    });
  }
}

let database: PicbindDatabase | null = null;

export function getDatabase() {
  if (typeof indexedDB === "undefined") {
    throw new Error("Local database is only available in the browser");
  }
  database ??= new PicbindDatabase();
  return database;
}
