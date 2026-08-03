"use client";

import Dexie, { type Table } from "dexie";
import type { CachedCompressedImage } from "./types/storage";

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

class PicbindDatabase extends Dexie {
  compressedImages!: Table<CompressedImageRecord, string>;
  queuedFiles!: Table<QueuedFileRecord, string>;

  constructor() {
    super("picbind-local");
    this.version(1).stores({
      compressedImages: "id, sourceId, createdAt",
      queuedFiles: "id, createdAt",
      roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
      reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
      operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
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
