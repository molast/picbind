"use client";

import { getDatabase, type RoomImageRecord } from "../database";
import { fileStorage } from "../file-storage";
import type { CachedRoomImage } from "../types/storage";

function roomFilePath(image: CachedRoomImage) {
  return `files/images/${fileStorage.segment(image.id)}`;
}

function thumbnailPath(image: CachedRoomImage) {
  return `thumbnails/images/${fileStorage.segment(image.id)}.webp`;
}

export async function storeRoom(image: CachedRoomImage) {
  const database = getDatabase();
  const existing = await database.roomImages.get([image.roomId, image.id]);
  const contentReference = existing?.filePath
    ? existing
    : await database.roomImages
        .where("id")
        .equals(image.id)
        .filter((record) => Boolean(record.filePath))
        .first();

  let filePath = existing?.filePath ?? contentReference?.filePath ?? null;
  const shouldWriteFile = image.blob.size > 0
    && (!filePath || Boolean(existing?.placeholderOnly) || Boolean(existing?.previewOnly));
  if (shouldWriteFile) {
    filePath = roomFilePath(image);
    await fileStorage.write(filePath, image.blob);
  }

  let storedThumbnailPath = existing?.thumbnailPath ?? null;
  if (image.thumbnail) {
    storedThumbnailPath = thumbnailPath(image);
    await fileStorage.write(storedThumbnailPath, image.thumbnail);
  }

  const { blob: _blob, thumbnail: _thumbnail, ...metadata } = image;
  const record: RoomImageRecord = {
    ...metadata,
    workspaceLocation: image.workspaceLocation ?? "outbox",
    outboxOrigin: image.outboxOrigin
      ?? (image.direction === "received" ? "received" : "direct"),
    updatedAt: image.updatedAt ?? image.createdAt,
    pinnedAt: image.pinnedAt ?? null,
    wantedByMe: image.wantedByMe ?? false,
    wantedByPeer: image.wantedByPeer ?? false,
    likeCount: image.likeCount ?? 0,
    filePath,
    thumbnailPath: storedThumbnailPath,
  };
  await database.roomImages.put(record);
}

export async function listRoom(roomId: string) {
  const database = getDatabase();
  const records = await database.roomImages.where("roomId").equals(roomId).toArray();
  records.sort((a, b) => a.updatedAt - b.updatedAt);
  const images = await Promise.all(
    records.map(async (record): Promise<CachedRoomImage | null> => {
      try {
        const storedFile = record.filePath
          ? await fileStorage.read(record.filePath)
          : new Blob([], { type: record.type });
        const thumbnail = record.thumbnailPath
          ? await fileStorage.read(record.thumbnailPath).catch(() => undefined)
          : undefined;
        const { filePath: _filePath, thumbnailPath: _thumbnailPath, ...metadata } = record;
        return {
          ...metadata,
          blob: new Blob([storedFile], { type: record.type }),
          thumbnail: thumbnail
            ? new Blob([thumbnail], { type: thumbnail.type || "image/webp" })
            : undefined,
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await database.roomImages.delete([record.roomId, record.id]);
          return null;
        }
        throw error;
      }
    }),
  );
  return images.filter((image): image is CachedRoomImage => image !== null);
}

export async function deleteRoom(roomId: string, id: string) {
  const database = getDatabase();
  const record = await database.roomImages.get([roomId, id]);
  await database.roomImages.delete([roomId, id]);
  const referenceCount = await database.roomImages.where("id").equals(id).count();
  if (referenceCount === 0) {
    await Promise.all([
      fileStorage.remove(record?.filePath),
      fileStorage.remove(record?.thumbnailPath),
    ]);
  }
}
