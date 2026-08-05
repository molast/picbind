"use client";

import type { CachedRoomImage } from "../types/storage";
import { mapWithConcurrency } from "../async-utils";
import { getImageStorageRepository } from "./image-storage-repository-selector";

type RoomImageMetadata = Omit<CachedRoomImage, "blob" | "thumbnail">;
const CACHE_MAX_BYTES = 512 * 1024 * 1024;
const CACHE_MAX_AGE_MILLIS = 30 * 24 * 60 * 60 * 1_000;

export type RoomImageSummary = RoomImageMetadata & {
  byteSize: number;
  thumbnailAvailable: boolean;
};

export async function storeRoom(image: CachedRoomImage) {
  const { blob, thumbnail, ...metadata } = image;
  const repository = getImageStorageRepository();
  await repository.put({
    scope: "room",
    scopeKey: image.roomId,
    id: image.id,
    metadata: {
      ...metadata,
      workspaceLocation: image.workspaceLocation ?? "outbox",
      outboxOrigin: image.outboxOrigin
        ?? (image.direction === "received" ? "received" : "direct"),
      updatedAt: image.updatedAt ?? image.createdAt,
      pinnedAt: image.pinnedAt ?? null,
      wantedByMe: image.wantedByMe ?? false,
      wantedByPeer: image.wantedByPeer ?? false,
      likeCount: image.likeCount ?? 0,
    },
    mimeType: image.type,
    data: blob.size > 0 ? blob : undefined,
    thumbnail,
    thumbnailMimeType: thumbnail?.type || "image/webp",
    createdAt: image.createdAt,
  });
  if (thumbnail) {
    await repository.pruneCache({
      maxBytes: CACHE_MAX_BYTES,
      maxAgeMillis: CACHE_MAX_AGE_MILLIS,
      limit: 250,
    });
  }
}

export async function listRoom(roomId: string) {
  const summaries = await listRoomMetadata(roomId, 1_000, 0);
  const images = await mapWithConcurrency(summaries, 4, (summary) =>
    readRoomImage(roomId, summary.id));
  return images
    .filter((image): image is CachedRoomImage => image !== null)
    .sort((a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt));
}

export async function listRoomMetadata(roomId: string, limit = 100, offset = 0) {
  const records = await getImageStorageRepository().list<RoomImageMetadata>(
    "room",
    roomId,
    limit,
    offset,
  );
  return records.map((record) => ({
    ...record.metadata,
    byteSize: record.byteSize,
    thumbnailAvailable: record.thumbnailAvailable,
  }));
}

export function readRoomImageVariant(
  roomId: string,
  id: string,
  variant: "original" | "thumbnail",
  mimeType: string,
  signal?: AbortSignal,
) {
  return getImageStorageRepository().read(
    "room",
    roomId,
    id,
    variant,
    mimeType,
    signal,
  );
}

export async function readRoomImage(
  roomId: string,
  id: string,
  signal?: AbortSignal,
): Promise<CachedRoomImage | null> {
  const repository = getImageStorageRepository();
  const record = await repository.get<RoomImageMetadata>("room", roomId, id);
  if (!record) return null;
  const [blob, thumbnail] = await Promise.all([
    repository.read("room", roomId, id, "original", record.mimeType, signal),
    repository.read("room", roomId, id, "thumbnail", "image/webp", signal)
      .catch(() => null),
  ]);
  return {
    ...record.metadata,
    blob: blob ?? new Blob([], { type: record.mimeType }),
    thumbnail: thumbnail ?? undefined,
  };
}

export function deleteRoom(roomId: string, id: string) {
  return getImageStorageRepository().delete("room", roomId, id);
}
