"use client";

import { getDatabaseClient } from "../client";
import { fileStorage } from "../file-storage";
import type { SqlValue } from "../types/client";
import type { CachedCompressedImage } from "../types/storage";

type CompressedImageRow = Record<string, SqlValue> & {
  id: string;
  source_id: string;
  source_name: string;
  source_size: number;
  name: string;
  type: string;
  format: string;
  size: number;
  file_path: string;
  created_at: number;
};

function imagePath(id: string) {
  return `files/compressed/${fileStorage.segment(id)}`;
}

export async function storeCompressed(image: CachedCompressedImage) {
  const path = imagePath(image.id);
  await fileStorage.write(path, image.blob);
  try {
    const database = await getDatabaseClient();
    await database.execute(
      `INSERT INTO compressed_images (
         id, source_id, source_name, source_size, name, type, format,
         size, file_path, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         source_name = excluded.source_name,
         source_size = excluded.source_size,
         name = excluded.name,
         type = excluded.type,
         format = excluded.format,
         size = excluded.size,
         file_path = excluded.file_path,
         created_at = excluded.created_at`,
      [
        image.id,
        image.sourceId,
        image.sourceName,
        image.sourceSize,
        image.name,
        image.type,
        image.format,
        image.size,
        path,
        image.createdAt,
      ],
    );
  } catch (error) {
    await fileStorage.remove(path).catch(() => undefined);
    throw error;
  }
}

export async function listCompressed() {
  const database = await getDatabaseClient();
  const rows = await database.query<CompressedImageRow>(
    "SELECT * FROM compressed_images ORDER BY created_at DESC",
  );
  const images = await Promise.all(
    rows.map(async (row): Promise<CachedCompressedImage | null> => {
      try {
        const blob = await fileStorage.read(row.file_path);
        return {
          id: row.id,
          sourceId: row.source_id,
          sourceName: row.source_name,
          sourceSize: Number(row.source_size),
          name: row.name,
          type: row.type,
          format: row.format,
          size: Number(row.size),
          blob: new Blob([blob], { type: row.type }),
          createdAt: Number(row.created_at),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await database.execute("DELETE FROM compressed_images WHERE id = ?", [row.id]);
          return null;
        }
        throw error;
      }
    }),
  );
  return images.filter((image): image is CachedCompressedImage => image !== null);
}

export async function deleteCompressed(id: string) {
  const database = await getDatabaseClient();
  const [row] = await database.query<Record<string, SqlValue> & { file_path: string }>(
    "SELECT file_path FROM compressed_images WHERE id = ?",
    [id],
  );
  await database.execute("DELETE FROM compressed_images WHERE id = ?", [id]);
  await fileStorage.remove(row?.file_path);
}

export async function clearCompressed() {
  const database = await getDatabaseClient();
  const rows = await database.query<Record<string, SqlValue> & { file_path: string }>(
    "SELECT file_path FROM compressed_images",
  );
  await database.execute("DELETE FROM compressed_images");
  await Promise.all(rows.map((row) => fileStorage.remove(row.file_path)));
}
