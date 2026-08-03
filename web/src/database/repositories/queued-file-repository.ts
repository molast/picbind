"use client";

import { getDatabase } from "../database";
import { fileStorage } from "../file-storage";

function filePath(id: string) {
  return `temp/compression/${fileStorage.segment(id)}`;
}

export async function storeQueuedFile(id: string, file: File) {
  const path = filePath(id);
  await fileStorage.write(path, file);
  await getDatabase().queuedFiles.put({
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    filePath: path,
    createdAt: file.lastModified || Date.now(),
  });
}

export async function getQueuedFile(id: string) {
  const database = getDatabase();
  const record = await database.queuedFiles.get(id);
  if (!record) return null;
  try {
    const blob = await fileStorage.read(record.filePath);
    return new File([blob], record.name, {
      type: record.type,
      lastModified: record.createdAt,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      await database.queuedFiles.delete(id);
      return null;
    }
    throw error;
  }
}

export async function deleteQueuedFile(id: string) {
  const database = getDatabase();
  const record = await database.queuedFiles.get(id);
  await database.queuedFiles.delete(id);
  await fileStorage.remove(record?.filePath ?? filePath(id));
}
