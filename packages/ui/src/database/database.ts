"use client";

import Dexie, { type Table } from "dexie";
import { fileStorage } from "./file-storage";
import type {
  CachedCompressedImage,
  CachedWorkspaceImage,
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

export type WorkspaceImageRecord = Omit<CachedWorkspaceImage, "blob" | "thumbnail"> & {
  filePath: string | null;
  thumbnailPath: string | null;
  updatedAt: number;
};

export type ReviewHistoryRecord = StoredReviewHistory & {
  workspaceId: string;
  imageId: string;
  updatedAt: number;
};

export type MessagingImageRecord = {
  workspaceId: string;
  providerId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  direction?: "incoming" | "outgoing";
  filePath: string;
};

type LegacyWorkspaceRecord = { roomId: string } & Record<string, unknown>;

export class PicbindDatabase extends Dexie {
  compressedImages!: Table<CompressedImageRecord, string>;
  queuedFiles!: Table<QueuedFileRecord, string>;
  workspaceImages!: Table<WorkspaceImageRecord, [string, string]>;
  workspaceReviewHistories!: Table<ReviewHistoryRecord, [string, string]>;
  workspaceMessagingImages!: Table<MessagingImageRecord, [string, string, string]>;

  constructor(name = "picbind-local") {
    super(name);

    // Versions 1-5 describe the released legacy schema exactly so Dexie can
    // open an existing database before the Workspace migration runs.
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
      messagingImages: "[providerId+messageId], providerId, messageId, createdAt",
    });
    this.version(3).stores({
      compressedImages: "id, sourceId, createdAt",
      queuedFiles: "id, createdAt",
      roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
      reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
      operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
      messagingImages: "[providerId+messageId], providerId, messageId, createdAt",
      imageDeliveries:
        "[roomId+id], roomId, imageId, recipientId, [roomId+imageId], [roomId+recipientId], updatedAt",
    });
    this.version(4)
      .stores({
        compressedImages: "id, sourceId, createdAt",
        queuedFiles: "id, createdAt",
        roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
        reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
        operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
        messagingImages: null,
        imageDeliveries:
          "[roomId+id], roomId, imageId, recipientId, [roomId+imageId], [roomId+recipientId], updatedAt",
      })
      .upgrade(async (transaction) => {
        const records = await transaction.table("messagingImages").toArray() as Array<{
          filePath?: string;
        }>;
        await Dexie.waitFor(Promise.all(
          records.map((record) =>
            fileStorage.remove(record.filePath).catch(() => undefined),
          ),
        ));
      });
    this.version(5).stores({
      compressedImages: "id, sourceId, createdAt",
      queuedFiles: "id, createdAt",
      roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
      reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
      operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
      messagingImages:
        "[roomId+providerId+messageId], roomId, providerId, messageId, [roomId+createdAt], createdAt",
      imageDeliveries:
        "[roomId+id], roomId, imageId, recipientId, [roomId+imageId], [roomId+recipientId], updatedAt",
    });

    this.version(6)
      .stores({
        compressedImages: "id, sourceId, createdAt",
        queuedFiles: "id, createdAt",
        roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
        reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
        operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
        messagingImages:
          "[roomId+providerId+messageId], roomId, providerId, messageId, [roomId+createdAt], createdAt",
        imageDeliveries:
          "[roomId+id], roomId, imageId, recipientId, [roomId+imageId], [roomId+recipientId], updatedAt",
        workspaceImages:
          "[workspaceId+id], workspaceId, id, [workspaceId+updatedAt], updatedAt",
        workspaceReviewHistories:
          "[workspaceId+imageId], workspaceId, imageId, updatedAt",
        workspaceMessagingImages:
          "[workspaceId+providerId+messageId], workspaceId, providerId, messageId, [workspaceId+createdAt], createdAt",
        workspaceImageDeliveries:
          "[workspaceId+id], workspaceId, imageId, recipientId, [workspaceId+imageId], [workspaceId+recipientId], updatedAt",
      })
      .upgrade(async (transaction) => {
        const migrate = async (legacyTable: string, workspaceTable: string) => {
          const records = await transaction.table(legacyTable).toArray() as LegacyWorkspaceRecord[];
          if (!records.length) return;
          await transaction.table(workspaceTable).bulkPut(records.map((record) => {
            const { roomId, ...value } = record;
            return { ...value, workspaceId: roomId };
          }));
        };
        await migrate("roomImages", "workspaceImages");
        await migrate("reviewHistories", "workspaceReviewHistories");
        await migrate("messagingImages", "workspaceMessagingImages");
        await migrate("imageDeliveries", "workspaceImageDeliveries");
      });

    this.version(7).stores({
      compressedImages: "id, sourceId, createdAt",
      queuedFiles: "id, createdAt",
      roomImages: null,
      reviewHistories: null,
      operationLogs: null,
      messagingImages: null,
      imageDeliveries: null,
      workspaceImages:
        "[workspaceId+id], workspaceId, id, [workspaceId+updatedAt], updatedAt",
      workspaceReviewHistories:
        "[workspaceId+imageId], workspaceId, imageId, updatedAt",
      workspaceMessagingImages:
        "[workspaceId+providerId+messageId], workspaceId, providerId, messageId, [workspaceId+createdAt], createdAt",
      workspaceImageDeliveries:
        "[workspaceId+id], workspaceId, imageId, recipientId, [workspaceId+imageId], [workspaceId+recipientId], updatedAt",
    });

    // V8 removes the unused image-delivery table. It remains in the V1-V7
    // declarations only so databases that already reached those versions can upgrade safely.
    this.version(8).stores({
      workspaceImageDeliveries: null,
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
