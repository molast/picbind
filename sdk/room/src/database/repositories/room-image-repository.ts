"use client";

import { getDatabaseClient } from "../client";
import { fileStorage } from "../file-storage";
import type { SqlValue } from "../types/client";
import type { CachedRoomImage } from "../types/storage";
import type { ImagePlaceholderMetadata } from "../../utils/share-placeholder";
import type {
  ImageObjectOperation,
  ImageObjectSource,
  ImageShareStatus,
} from "../../utils/image-object";

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
  root_image_id: string;
  parent_image_id: string | null;
  owner_id: string;
  width: number;
  height: number;
  source: ImageObjectSource;
  operation: ImageObjectOperation;
  version: number;
  share_status: ImageShareStatus | null;
  workspace_location: "library" | "outbox";
  outbox_origin: "library" | "direct" | "received";
  created_at: number;
  updated_at: number | null;
  pinned_at: number | null;
  wanted_by_me: number;
  wanted_by_peer: number;
  like_count: number;
};

function roomFilePath(image: CachedRoomImage) {
  return `files/images/${fileStorage.segment(image.id)}`;
}

function thumbnailPath(image: CachedRoomImage) {
  return `thumbnails/images/${fileStorage.segment(image.id)}.webp`;
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
    "SELECT * FROM room_images WHERE room_id = ? AND id = ?",
    [image.roomId, image.id],
  );
  const [contentReference] = existing?.file_path
    ? [existing]
    : await database.query<RoomImageRow>(
        "SELECT * FROM room_images WHERE id = ? AND file_path IS NOT NULL LIMIT 1",
        [image.id],
      );

  let path = existing?.file_path ?? contentReference?.file_path ?? null;
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
       root_image_id, parent_image_id, owner_id, width, height, source,
       operation, version, share_status, workspace_location, outbox_origin,
       created_at, updated_at, pinned_at, wanted_by_me, wanted_by_peer,
       like_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, id) DO UPDATE SET
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
       root_image_id = excluded.root_image_id,
       parent_image_id = excluded.parent_image_id,
       owner_id = excluded.owner_id,
       width = excluded.width,
       height = excluded.height,
       source = excluded.source,
       operation = excluded.operation,
       version = excluded.version,
       share_status = excluded.share_status,
       workspace_location = excluded.workspace_location,
       outbox_origin = excluded.outbox_origin,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at,
       pinned_at = excluded.pinned_at,
       wanted_by_me = excluded.wanted_by_me,
       wanted_by_peer = excluded.wanted_by_peer,
       like_count = excluded.like_count`,
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
      image.rootImageId,
      image.parentImageId,
      image.ownerId,
      image.width,
      image.height,
      image.source,
      image.operation,
      image.version,
      image.shareStatus ?? null,
      image.workspaceLocation ?? "outbox",
      image.outboxOrigin ?? (image.direction === "received" ? "received" : "direct"),
      image.createdAt,
      image.updatedAt ?? image.createdAt,
      image.pinnedAt ?? null,
      image.wantedByMe ? 1 : 0,
      image.wantedByPeer ? 1 : 0,
      image.likeCount ?? 0,
    ],
  );
}

export async function listRoom(roomId: string) {
  const database = await getDatabaseClient();
  const rows = await database.query<RoomImageRow>(
    "SELECT * FROM room_images WHERE room_id = ? ORDER BY COALESCE(updated_at, created_at) ASC",
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
          rootImageId: row.root_image_id || row.id,
          parentImageId: row.parent_image_id,
          ownerId: row.owner_id,
          width: Number(row.width),
          height: Number(row.height),
          source: row.source,
          operation: row.operation,
          version: Number(row.version),
          shareStatus: row.share_status ?? undefined,
          workspaceLocation: row.workspace_location || "outbox",
          outboxOrigin:
            row.outbox_origin ||
            (row.direction === "received" ? "received" : "direct"),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at ?? row.created_at),
          pinnedAt: row.pinned_at === null ? undefined : Number(row.pinned_at),
          wantedByMe: Boolean(row.wanted_by_me),
          wantedByPeer: Boolean(row.wanted_by_peer),
          likeCount: Number(row.like_count || 0),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await database.execute(
            "DELETE FROM room_images WHERE room_id = ? AND id = ?",
            [row.room_id, row.id],
          );
          return null;
        }
        throw error;
      }
    }),
  );
  return images.filter((image): image is CachedRoomImage => image !== null);
}

export async function deleteRoom(roomId: string, id: string) {
  const database = await getDatabaseClient();
  const [row] = await database.query<RoomImageRow>(
    "SELECT * FROM room_images WHERE room_id = ? AND id = ?",
    [roomId, id],
  );
  await database.execute("DELETE FROM room_images WHERE room_id = ? AND id = ?", [
    roomId,
    id,
  ]);
  const [reference] = await database.query<{ count: number }>(
    "SELECT COUNT(*) AS count FROM room_images WHERE id = ?",
    [id],
  );
  if (Number(reference?.count || 0) === 0) {
    await Promise.all([
      fileStorage.remove(row?.file_path),
      fileStorage.remove(row?.thumbnail_path),
    ]);
  }
}
