"use client";

import { mapWithConcurrency } from "../async-utils";
import type { ImageStorageRecord } from "./image-storage-repository";
import { getImageStorageRepository } from "./image-storage-repository-selector";

const MAX_MESSAGING_IMAGES = 100;
const CACHE_MAX_BYTES = 512 * 1024 * 1024;
const CACHE_MAX_AGE_MILLIS = 30 * 24 * 60 * 60 * 1_000;

export type CachedMessagingImage = {
  roomId: string;
  providerId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  direction: "incoming" | "outgoing";
  blob: Blob;
};

export type MessagingImageSummary = Omit<CachedMessagingImage, "blob">;
type MessagingImageMetadata = MessagingImageSummary;

function imageId(providerId: string, messageId: string) {
  return JSON.stringify([providerId, messageId]);
}

async function listAllMessagingRecords(roomId: string) {
  const repository = getImageStorageRepository();
  const records: Array<ImageStorageRecord<MessagingImageMetadata>> = [];
  const pageSize = 250;
  while (true) {
    const page = await repository.list<MessagingImageMetadata>(
      "messaging",
      roomId,
      pageSize,
      records.length,
    );
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

export async function storeMessagingImage(image: CachedMessagingImage) {
  const { blob, ...metadata } = image;
  const repository = getImageStorageRepository();
  await repository.put({
    scope: "messaging",
    scopeKey: image.roomId,
    id: imageId(image.providerId, image.messageId),
    metadata: { ...metadata, size: blob.size },
    mimeType: image.mimeType,
    data: blob,
    createdAt: image.createdAt,
  });
  const records = await listAllMessagingRecords(image.roomId);
  const expired = records
    .sort((a, b) => b.metadata.createdAt - a.metadata.createdAt)
    .slice(MAX_MESSAGING_IMAGES);
  await mapWithConcurrency(expired, 4, (record) =>
    repository.delete("messaging", image.roomId, record.id));
  await repository.pruneCache({
    maxBytes: CACHE_MAX_BYTES,
    maxAgeMillis: CACHE_MAX_AGE_MILLIS,
    limit: 250,
  });
}

export async function listMessagingImages(roomId: string) {
  const records = await listMessagingImageMetadata(roomId, MAX_MESSAGING_IMAGES, 0);
  const images = await mapWithConcurrency(records, 4, (record) =>
    readMessagingImage(roomId, record.providerId, record.messageId));
  return images
    .filter((image): image is CachedMessagingImage => image !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listMessagingImageMetadata(
  roomId: string,
  limit = MAX_MESSAGING_IMAGES,
  offset = 0,
) {
  const records = await getImageStorageRepository().list<MessagingImageMetadata>(
    "messaging",
    roomId,
    Math.min(limit, MAX_MESSAGING_IMAGES),
    offset,
  );
  return records.map((record) => ({
    ...record.metadata,
    direction: record.metadata.direction || "incoming" as const,
  }));
}

export async function readMessagingImage(
  roomId: string,
  providerId: string,
  messageId: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const repository = getImageStorageRepository();
  const id = imageId(providerId, messageId);
  const record = await repository.get<MessagingImageMetadata>("messaging", roomId, id);
  if (!record) return null;
  const blob = await repository.read(
    "messaging",
    roomId,
    id,
    "original",
    record.mimeType,
    signal,
  );
  return blob ? { ...record.metadata, blob } : null;
}
