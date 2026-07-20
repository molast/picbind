"use client";

import {
  deleteRoom,
  listRoom,
  storeRoom,
} from "@/database/repositories/room-image-repository";
import {
  deleteFallbackRoomImage,
  listFallbackRoomImages,
  storeFallbackRoomImage,
} from "@/database/room-image-fallback";
import type { CachedRoomImage } from "@/database/types/storage";

export type { CachedRoomImage } from "@/database/types/storage";

let sqliteUnavailable = false;
let sqliteFailureReported = false;

function disableSqliteCache(operation: string, error: unknown) {
  sqliteUnavailable = true;
  if (sqliteFailureReported) return;
  sqliteFailureReported = true;
  console.warn(
    `[PicBind Cache] SQLite/OPFS ${operation} failed; using IndexedDB fallback.`,
    error,
  );
}

export async function storeRoomImage(image: CachedRoomImage) {
  if (!sqliteUnavailable) {
    try {
      await storeRoom(image);
      await deleteFallbackRoomImage(image.id).catch(() => undefined);
      return;
    } catch (error) {
      disableSqliteCache("write", error);
    }
  }
  await storeFallbackRoomImage(image);
}

export async function listRoomImages(roomId: string) {
  if (!sqliteUnavailable) {
    try {
      const [stored, fallback] = await Promise.all([
        listRoom(roomId),
        listFallbackRoomImages(roomId).catch(() => []),
      ]);
      const images = new Map(stored.map((image) => [image.id, image]));
      fallback.forEach((image) => images.set(image.id, image));
      return [...images.values()].sort((a, b) => a.createdAt - b.createdAt);
    } catch (error) {
      disableSqliteCache("read", error);
    }
  }
  return listFallbackRoomImages(roomId);
}

export async function deleteRoomImage(id: string) {
  await deleteFallbackRoomImage(id).catch(() => undefined);
  if (sqliteUnavailable) return;
  try {
    await deleteRoom(id);
  } catch (error) {
    disableSqliteCache("delete", error);
  }
}
