"use client";

import type { CachedCompressedImage } from "../types/storage";
import { mapWithConcurrency } from "../async-utils";
import { getImageStorageRepository } from "./image-storage-repository-selector";

export type CompressedImageSummary = Omit<CachedCompressedImage, "blob">;
type CompressedMetadata = CompressedImageSummary;

export async function storeCompressed(image: CachedCompressedImage) {
  const { blob, ...metadata } = image;
  await getImageStorageRepository().put({
    scope: "compressed",
    id: image.id,
    metadata,
    mimeType: image.type,
    data: blob,
    createdAt: image.createdAt,
  });
}

export async function listCompressedMetadata(limit = 100, offset = 0) {
  const records = await getImageStorageRepository().list<CompressedMetadata>(
    "compressed",
    "",
    limit,
    offset,
  );
  return records.map((record) => record.metadata);
}

export async function readCompressedImage(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const repository = getImageStorageRepository();
  const record = await repository.get<CompressedMetadata>("compressed", "", id);
  if (!record) return null;
  const blob = await repository.read(
    "compressed",
    "",
    id,
    "output",
    record.mimeType,
    signal,
  );
  return blob ? { ...record.metadata, blob } : null;
}

export async function listCompressed() {
  const summaries = await listCompressedMetadata(1_000, 0);
  const images = await mapWithConcurrency(summaries, 4, (summary) =>
    readCompressedImage(summary.id));
  return images.filter((image): image is CachedCompressedImage => image !== null);
}

export function deleteCompressed(id: string) {
  return getImageStorageRepository().delete("compressed", "", id);
}

export function clearCompressed() {
  return getImageStorageRepository().clear("compressed");
}
