"use client";

import { getDatabase, type CompressedImageRecord } from "../database";
import { fileStorage } from "../file-storage";
import type { CachedCompressedImage } from "../types/storage";

function imagePath(id: string) {
  return `files/compressed/${fileStorage.segment(id)}`;
}

export async function storeCompressed(image: CachedCompressedImage) {
  const path = imagePath(image.id);
  await fileStorage.write(path, image.blob);
  await getDatabase().compressedImages.put({
    id: image.id,
    sourceId: image.sourceId,
    sourceName: image.sourceName,
    sourceSize: image.sourceSize,
    name: image.name,
    type: image.type,
    format: image.format,
    size: image.size,
    createdAt: image.createdAt,
    filePath: path,
  });
}

export async function listCompressed() {
  const database = getDatabase();
  const records = await database.compressedImages
    .orderBy("createdAt")
    .reverse()
    .toArray();
  const images = await Promise.all(
    records.map(async (record): Promise<CachedCompressedImage | null> => {
      try {
        const blob = await fileStorage.read(record.filePath);
        return {
          id: record.id,
          sourceId: record.sourceId,
          sourceName: record.sourceName,
          sourceSize: record.sourceSize,
          name: record.name,
          type: record.type,
          format: record.format,
          size: record.size,
          blob: new Blob([blob], { type: record.type }),
          createdAt: record.createdAt,
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await database.compressedImages.delete(record.id);
          return null;
        }
        throw error;
      }
    }),
  );
  return images.filter((image): image is CachedCompressedImage => image !== null);
}

export async function deleteCompressed(id: string) {
  const database = getDatabase();
  const record = await database.compressedImages.get(id);
  await database.compressedImages.delete(id);
  await fileStorage.remove(record?.filePath ?? imagePath(id));
}

export async function clearCompressed() {
  const database = getDatabase();
  const records: CompressedImageRecord[] = await database.compressedImages.toArray();
  await database.compressedImages.clear();
  await Promise.all(records.map((record) => fileStorage.remove(record.filePath)));
}
