"use client";

import Dexie from "dexie";
import {
  getDatabase,
  type CompressedImageRecord,
  type MessagingImageRecord,
  type QueuedFileRecord,
  type RoomImageRecord,
} from "../database";
import { fileStorage } from "../file-storage";
import type {
  ImageStorageRecord,
  ImageStorageRepository,
  ImageStorageScope,
  ImageStorageVariant,
  PutImageStorageInput,
} from "./image-storage-repository";

function segment(value: string) {
  return fileStorage.segment(value);
}

function primaryPath(scope: ImageStorageScope, scopeKey: string, id: string) {
  switch (scope) {
    case "compressed":
      return `files/compressed/${segment(id)}`;
    case "queued":
      return `temp/compression/${segment(id)}`;
    case "room":
      return `files/images/${segment(id)}`;
    case "messaging":
      return `cache/messaging/${segment(scopeKey)}/${segment(id)}`;
  }
}

function roomThumbnailPath(id: string) {
  return `thumbnails/images/${segment(id)}.webp`;
}

function storageRecord<T extends Record<string, unknown>>(input: {
  scope: ImageStorageScope;
  scopeKey?: string;
  id: string;
  metadata: T;
  mimeType: string;
  byteSize: number;
  thumbnailAvailable?: boolean;
  createdAt: number;
  updatedAt?: number;
}): ImageStorageRecord<T> {
  return {
    scope: input.scope,
    scopeKey: input.scopeKey ?? "",
    id: input.id,
    metadata: input.metadata,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    thumbnailAvailable: input.thumbnailAvailable ?? false,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

function withoutPaths<T extends { filePath?: unknown; thumbnailPath?: unknown }>(record: T) {
  const { filePath: _filePath, thumbnailPath: _thumbnailPath, ...metadata } = record;
  return metadata;
}

function asMetadata<T extends Record<string, unknown>>(value: unknown) {
  return value as T;
}

async function putCompressed<T extends Record<string, unknown>>(
  input: PutImageStorageInput<T>,
) {
  if (!input.data) throw new Error("compressed image data is required");
  const path = primaryPath("compressed", "", input.id);
  await fileStorage.write(path, input.data);
  await getDatabase().compressedImages.put({
    ...input.metadata,
    id: input.id,
    type: input.mimeType,
    createdAt: input.createdAt,
    filePath: path,
  } as unknown as CompressedImageRecord);
  return storageRecord({ ...input, byteSize: input.data.size });
}

async function putQueued<T extends Record<string, unknown>>(
  input: PutImageStorageInput<T>,
) {
  if (!input.data) throw new Error("queued file data is required");
  const path = primaryPath("queued", "", input.id);
  await fileStorage.write(path, input.data);
  await getDatabase().queuedFiles.put({
    ...input.metadata,
    id: input.id,
    type: input.mimeType,
    size: input.data.size,
    createdAt: input.createdAt,
    filePath: path,
  } as unknown as QueuedFileRecord);
  return storageRecord({ ...input, byteSize: input.data.size });
}

async function putRoom<T extends Record<string, unknown>>(
  input: PutImageStorageInput<T>,
) {
  const database = getDatabase();
  const scopeKey = input.scopeKey ?? "";
  const existing = await database.roomImages.get([scopeKey, input.id]);
  const contentReference = existing?.filePath
    ? existing
    : await database.roomImages
        .where("id")
        .equals(input.id)
        .filter((record) => Boolean(record.filePath))
        .first();
  let filePath = existing?.filePath ?? contentReference?.filePath ?? null;
  const data = input.data;
  const shouldWriteFile = data && data.size > 0
    && (!filePath || Boolean(existing?.placeholderOnly) || Boolean(existing?.previewOnly));
  if (data && shouldWriteFile) {
    filePath = primaryPath("room", scopeKey, input.id);
    await fileStorage.write(filePath, data);
  }
  let thumbnailPath = existing?.thumbnailPath ?? null;
  if (input.thumbnail) {
    thumbnailPath = roomThumbnailPath(input.id);
    await fileStorage.write(thumbnailPath, input.thumbnail);
  }
  const updatedAt = Number(input.metadata.updatedAt ?? input.createdAt);
  await database.roomImages.put({
    ...input.metadata,
    id: input.id,
    roomId: scopeKey,
    type: input.mimeType,
    createdAt: input.createdAt,
    updatedAt,
    filePath,
    thumbnailPath,
  } as unknown as RoomImageRecord);
  return storageRecord({
    ...input,
    scopeKey,
    byteSize: input.data?.size ?? Number(input.metadata.size ?? 0),
    thumbnailAvailable: Boolean(thumbnailPath),
    updatedAt,
  });
}

async function putMessaging<T extends Record<string, unknown>>(
  input: PutImageStorageInput<T>,
) {
  if (!input.data) throw new Error("messaging image data is required");
  const scopeKey = input.scopeKey ?? "";
  const path = primaryPath("messaging", scopeKey, input.id);
  await fileStorage.write(path, input.data);
  await getDatabase().messagingImages.put({
    ...input.metadata,
    roomId: scopeKey,
    mimeType: input.mimeType,
    size: input.data.size,
    createdAt: input.createdAt,
    filePath: path,
  } as unknown as MessagingImageRecord);
  return storageRecord({ ...input, scopeKey, byteSize: input.data.size });
}

async function getRecord<T extends Record<string, unknown>>(
  scope: ImageStorageScope,
  scopeKey: string,
  id: string,
): Promise<ImageStorageRecord<T> | null> {
  const database = getDatabase();
  if (scope === "compressed") {
    const record = await database.compressedImages.get(id);
    if (!record) return null;
    return storageRecord({
      scope,
      id,
      metadata: asMetadata<T>(withoutPaths(record)),
      mimeType: record.type,
      byteSize: record.size,
      createdAt: record.createdAt,
    });
  }
  if (scope === "queued") {
    const record = await database.queuedFiles.get(id);
    if (!record) return null;
    return storageRecord({
      scope,
      id,
      metadata: asMetadata<T>(withoutPaths(record)),
      mimeType: record.type,
      byteSize: record.size,
      createdAt: record.createdAt,
    });
  }
  if (scope === "room") {
    const record = await database.roomImages.get([scopeKey, id]);
    if (!record) return null;
    return storageRecord({
      scope,
      scopeKey,
      id,
      metadata: asMetadata<T>(withoutPaths(record)),
      mimeType: record.type,
      byteSize: record.size,
      thumbnailAvailable: Boolean(record.thumbnailPath),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
  const [providerId, messageId] = JSON.parse(id) as [string, string];
  const record = await database.messagingImages.get([scopeKey, providerId, messageId]);
  if (!record) return null;
  return storageRecord({
    scope,
    scopeKey,
    id,
    metadata: asMetadata<T>(withoutPaths(record)),
    mimeType: record.mimeType,
    byteSize: record.size,
    createdAt: record.createdAt,
  });
}

async function listRecords<T extends Record<string, unknown>>(
  scope: ImageStorageScope,
  scopeKey: string,
  limit: number,
  offset: number,
) {
  const database = getDatabase();
  const pageSize = Math.min(Math.max(1, limit), 1_000);
  if (scope === "compressed") {
    const records = await database.compressedImages.orderBy("createdAt").reverse()
      .offset(offset).limit(pageSize).toArray();
    return records.map((record) => storageRecord({
      scope,
      id: record.id,
      metadata: asMetadata<T>(withoutPaths(record)),
      mimeType: record.type,
      byteSize: record.size,
      createdAt: record.createdAt,
    }));
  }
  if (scope === "queued") {
    const records = await database.queuedFiles.orderBy("createdAt").reverse()
      .offset(offset).limit(pageSize).toArray();
    return records.map((record) => storageRecord({
      scope,
      id: record.id,
      metadata: asMetadata<T>(withoutPaths(record)),
      mimeType: record.type,
      byteSize: record.size,
      createdAt: record.createdAt,
    }));
  }
  if (scope === "room") {
    const records = await database.roomImages.where("[roomId+updatedAt]")
      .between([scopeKey, Dexie.minKey], [scopeKey, Dexie.maxKey], true, true)
      .reverse().offset(offset).limit(pageSize).toArray();
    return records.map((record) => storageRecord({
      scope,
      scopeKey,
      id: record.id,
      metadata: asMetadata<T>(withoutPaths(record)),
      mimeType: record.type,
      byteSize: record.size,
      thumbnailAvailable: Boolean(record.thumbnailPath),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
  }
  const records = await database.messagingImages.where("[roomId+createdAt]")
    .between([scopeKey, Dexie.minKey], [scopeKey, Dexie.maxKey], true, true)
    .reverse().offset(offset).limit(pageSize).toArray();
  return records.map((record) => storageRecord({
    scope,
    scopeKey,
    id: JSON.stringify([record.providerId, record.messageId]),
    metadata: asMetadata<T>(withoutPaths(record)),
    mimeType: record.mimeType,
    byteSize: record.size,
    createdAt: record.createdAt,
  }));
}

async function readRecord(
  scope: ImageStorageScope,
  scopeKey: string,
  id: string,
  variant: ImageStorageVariant,
  mimeType: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const database = getDatabase();
  let path: string | null | undefined;
  if (scope === "compressed") path = (await database.compressedImages.get(id))?.filePath;
  if (scope === "queued") path = (await database.queuedFiles.get(id))?.filePath;
  if (scope === "room") {
    const record = await database.roomImages.get([scopeKey, id]);
    path = variant === "thumbnail" ? record?.thumbnailPath : record?.filePath;
  }
  if (scope === "messaging") {
    const [providerId, messageId] = JSON.parse(id) as [string, string];
    path = (await database.messagingImages.get([scopeKey, providerId, messageId]))?.filePath;
  }
  if (!path) return null;
  try {
    const stored = await fileStorage.read(path);
    signal?.throwIfAborted();
    return new Blob([stored], { type: mimeType });
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
    if (scope === "compressed") await database.compressedImages.delete(id);
    if (scope === "queued") await database.queuedFiles.delete(id);
    if (scope === "messaging") {
      const [providerId, messageId] = JSON.parse(id) as [string, string];
      await database.messagingImages.delete([scopeKey, providerId, messageId]);
    }
    return null;
  }
}

async function deleteRecord(scope: ImageStorageScope, scopeKey: string, id: string) {
  const database = getDatabase();
  if (scope === "compressed") {
    const record = await database.compressedImages.get(id);
    await database.compressedImages.delete(id);
    await fileStorage.remove(record?.filePath ?? primaryPath(scope, scopeKey, id));
    return;
  }
  if (scope === "queued") {
    const record = await database.queuedFiles.get(id);
    await database.queuedFiles.delete(id);
    await fileStorage.remove(record?.filePath ?? primaryPath(scope, scopeKey, id));
    return;
  }
  if (scope === "room") {
    const record = await database.roomImages.get([scopeKey, id]);
    await database.roomImages.delete([scopeKey, id]);
    if (await database.roomImages.where("id").equals(id).count() === 0) {
      await Promise.all([
        fileStorage.remove(record?.filePath),
        fileStorage.remove(record?.thumbnailPath),
      ]);
    }
    return;
  }
  const [providerId, messageId] = JSON.parse(id) as [string, string];
  const record = await database.messagingImages.get([scopeKey, providerId, messageId]);
  await database.messagingImages.delete([scopeKey, providerId, messageId]);
  await fileStorage.remove(record?.filePath);
}

async function deleteVariant(
  scope: ImageStorageScope,
  scopeKey: string,
  id: string,
  variant: ImageStorageVariant,
) {
  if (scope !== "room") {
    await deleteRecord(scope, scopeKey, id);
    return;
  }
  const database = getDatabase();
  const record = await database.roomImages.get([scopeKey, id]);
  if (!record) return;
  const thumbnail = variant === "thumbnail";
  const path = thumbnail ? record.thumbnailPath : record.filePath;
  if (!path) return;
  await database.roomImages.update([scopeKey, id], thumbnail
    ? { thumbnailPath: null }
    : { filePath: null });
  const stillReferenced = await database.roomImages
    .filter((candidate) => candidate.filePath === path || candidate.thumbnailPath === path)
    .count();
  if (stillReferenced === 0) await fileStorage.remove(path);
}

async function clearRecords(scope: ImageStorageScope, scopeKey?: string) {
  const database = getDatabase();
  if (scope === "compressed") {
    const records = await database.compressedImages.toArray();
    await database.compressedImages.clear();
    await Promise.all(records.map((record) => fileStorage.remove(record.filePath)));
    return;
  }
  if (scope === "queued") {
    const records = await database.queuedFiles.toArray();
    await database.queuedFiles.clear();
    await Promise.all(records.map((record) => fileStorage.remove(record.filePath)));
    return;
  }
  if (scope === "room") {
    const records = scopeKey === undefined
      ? await database.roomImages.toArray()
      : await database.roomImages.where("roomId").equals(scopeKey).toArray();
    await Promise.all(records.map((record) =>
      deleteRecord(scope, record.roomId, record.id)));
    return;
  }
  const records = scopeKey === undefined
    ? await database.messagingImages.toArray()
    : await database.messagingImages.where("roomId").equals(scopeKey).toArray();
  await Promise.all(records.map((record) =>
    deleteRecord(
      scope,
      record.roomId,
      JSON.stringify([record.providerId, record.messageId]),
    )));
}

export const webImageStorageRepository: ImageStorageRepository = {
  put(input) {
    if (input.scope === "compressed") return putCompressed(input);
    if (input.scope === "queued") return putQueued(input);
    if (input.scope === "room") return putRoom(input);
    return putMessaging(input);
  },
  get: getRecord,
  list: listRecords,
  read: readRecord,
  delete: deleteRecord,
  deleteVariant,
  clear: clearRecords,
  async pruneCache() {
    return {
      removedRecords: 0,
      removedThumbnails: 0,
      reclaimedBytes: 0,
      remainingCacheBytes: 0,
    };
  },
};
