"use client";

import { getImageStorageRepository } from "./image-storage-repository-selector";

type QueuedFileMetadata = {
  name: string;
  type: string;
  size: number;
  createdAt: number;
};

export async function storeQueuedFile(id: string, file: File) {
  const createdAt = file.lastModified || Date.now();
  await getImageStorageRepository().put({
    scope: "queued",
    id,
    metadata: { name: file.name, type: file.type, size: file.size, createdAt },
    mimeType: file.type,
    data: file,
    createdAt,
  });
}

export async function getQueuedFile(id: string) {
  const repository = getImageStorageRepository();
  const record = await repository.get<QueuedFileMetadata>("queued", "", id);
  if (!record) return null;
  const blob = await repository.read("queued", "", id, "original", record.mimeType);
  if (!blob) return null;
  return new File([blob], record.metadata.name, {
    type: record.metadata.type,
    lastModified: record.metadata.createdAt,
  });
}

export function deleteQueuedFile(id: string) {
  return getImageStorageRepository().delete("queued", "", id);
}
