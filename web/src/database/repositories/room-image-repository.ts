"use client";

import { getDatabaseClient } from "../client";
import { fileStorage } from "../file-storage";
import type { SqlValue } from "../types/client";
import type { CachedRoomImage } from "../types/storage";
import type { ImagePlaceholderMetadata } from "@/utils/share-placeholder";

type RoomImageRow = Record<string, SqlValue> & {
  id: string;
  room_id: string;
  name: string;
  type: string;
  size: number;
  file_path: string | null;
  direction: "sent" | "received";
  transfer_status: CachedRoomImage["transferStatus"] | null;
  progress: number | null;
  transfer_mode: CachedRoomImage["transferMode"] | null;
  preview_only: number;
  placeholder_only: number;
  placeholder_json: string | null;
  thumbnail_path: string | null;
  review_status: CachedRoomImage["reviewStatus"] | null;
  review_anchor_count: number | null;
  created_at: number;
};

function roomFilePath(image: CachedRoomImage) {
  return `files/rooms/${fileStorage.segment(image.roomId)}/${fileStorage.segment(image.id)}`;
}

function thumbnailPath(image: CachedRoomImage) {
  return `thumbnails/rooms/${fileStorage.segment(image.roomId)}/${fileStorage.segment(image.id)}.webp`;
}

function parsePlaceholder(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ImagePlaceholderMetadata;
  } catch {
    return undefined;
  }
}

export async function storeRoom(image: CachedRoomImage) {
  const database = await getDatabaseClient();
  const [existing] = await database.query<RoomImageRow>(
    "SELECT * FROM room_images WHERE id = ?",
    [image.id],
  );

  let path = existing?.file_path ?? null;
  const shouldWriteFile =
    image.blob.size > 0 &&
    (!path || Boolean(existing?.placeholder_only) || Boolean(existing?.preview_only));
  if (shouldWriteFile) {
    path = roomFilePath(image);
    await fileStorage.write(path, image.blob);
  }

  let thumbPath = existing?.thumbnail_path ?? null;
  if (image.thumbnail) {
    thumbPath = thumbnailPath(image);
    await fileStorage.write(thumbPath, image.thumbnail);
  }

  await database.execute(
    `INSERT INTO room_images (
       id, room_id, name, type, size, file_path, direction, transfer_status,
       progress, transfer_mode, preview_only, placeholder_only,
       placeholder_json, thumbnail_path, review_status, review_anchor_count,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       room_id = excluded.room_id,
       name = excluded.name,
       type = excluded.type,
       size = excluded.size,
       file_path = excluded.file_path,
       direction = excluded.direction,
       transfer_status = excluded.transfer_status,
       progress = excluded.progress,
       transfer_mode = excluded.transfer_mode,
       preview_only = excluded.preview_only,
       placeholder_only = excluded.placeholder_only,
       placeholder_json = excluded.placeholder_json,
       thumbnail_path = excluded.thumbnail_path,
       review_status = excluded.review_status,
       review_anchor_count = excluded.review_anchor_count,
       created_at = excluded.created_at`,
    [
      image.id,
      image.roomId,
      image.name,
      image.type,
      image.size,
      path,
      image.direction,
      image.transferStatus ?? null,
      image.progress ?? null,
      image.transferMode ?? null,
      image.previewOnly ? 1 : 0,
      image.placeholderOnly ? 1 : 0,
      image.placeholder ? JSON.stringify(image.placeholder) : null,
      thumbPath,
      image.reviewStatus ?? null,
      image.reviewAnchorCount ?? null,
      image.createdAt,
    ],
  );
}

export async function listRoom(roomId: string) {
  const database = await getDatabaseClient();
  const rows = await database.query<RoomImageRow>(
    "SELECT * FROM room_images WHERE room_id = ? ORDER BY created_at ASC",
    [roomId],
  );
  const images = await Promise.all(
    rows.map(async (row): Promise<CachedRoomImage | null> => {
      try {
        const storedFile = row.file_path
          ? await fileStorage.read(row.file_path)
          : new Blob([], { type: row.type });
        const thumbnail = row.thumbnail_path
          ? await fileStorage.read(row.thumbnail_path).catch(() => undefined)
          : undefined;
        return {
          id: row.id,
          roomId: row.room_id,
          name: row.name,
          type: row.type,
          size: Number(row.size),
          blob: new Blob([storedFile], { type: row.type }),
          direction: row.direction,
          transferStatus: row.transfer_status ?? undefined,
          progress: row.progress === null ? undefined : Number(row.progress),
          transferMode: row.transfer_mode ?? undefined,
          previewOnly: Boolean(row.preview_only),
          placeholderOnly: Boolean(row.placeholder_only),
          placeholder: parsePlaceholder(row.placeholder_json),
          thumbnail: thumbnail
            ? new Blob([thumbnail], { type: thumbnail.type || "image/webp" })
            : undefined,
          reviewStatus: row.review_status ?? undefined,
          reviewAnchorCount:
            row.review_anchor_count === null
              ? undefined
              : Number(row.review_anchor_count),
          createdAt: Number(row.created_at),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await database.execute("DELETE FROM room_images WHERE id = ?", [row.id]);
          return null;
        }
        throw error;
      }
    }),
  );
  return images.filter((image): image is CachedRoomImage => image !== null);
}

export async function deleteRoom(id: string) {
  const database = await getDatabaseClient();
  const [row] = await database.query<RoomImageRow>(
    "SELECT * FROM room_images WHERE id = ?",
    [id],
  );
  await database.execute("DELETE FROM room_images WHERE id = ?", [id]);
  await Promise.all([
    fileStorage.remove(row?.file_path),
    fileStorage.remove(row?.thumbnail_path),
  ]);
}
