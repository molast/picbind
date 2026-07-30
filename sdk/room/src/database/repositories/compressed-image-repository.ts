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

type CompressedImageMetadata = Omit<CachedCompressedImage, "blob"> & {
  filePath: string;
};

// Image bytes stay in OPFS. This map only keeps association metadata available
// in the current tab when the SQLite OPFS VFS cannot start.
const volatileCompressedImages = new Map<string, CompressedImageMetadata>();

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
    volatileCompressedImages.delete(image.id);
  } catch {
    volatileCompressedImages.set(image.id, {
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
}

export async function listCompressed() {
  let database: Awaited<ReturnType<typeof getDatabaseClient>> | null = null;
  let rows: CompressedImageRow[] = [];
  try {
    database = await getDatabaseClient();
    rows = await database.query<CompressedImageRow>(
      "SELECT * FROM compressed_images ORDER BY created_at DESC",
    );
  } catch {
    // Same-tab metadata below keeps compressed results selectable.
  }

  const metadata = new Map<string, CompressedImageMetadata>();
  rows.forEach((row) => {
    metadata.set(row.id, {
      id: row.id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceSize: Number(row.source_size),
      name: row.name,
      type: row.type,
      format: row.format,
      size: Number(row.size),
      filePath: row.file_path,
      createdAt: Number(row.created_at),
    });
  });
  volatileCompressedImages.forEach((image) => metadata.set(image.id, image));

  const images = await Promise.all(
    [...metadata.values()].map(async (image): Promise<CachedCompressedImage | null> => {
      try {
        const blob = await fileStorage.read(image.filePath);
        return {
          id: image.id,
          sourceId: image.sourceId,
          sourceName: image.sourceName,
          sourceSize: image.sourceSize,
          name: image.name,
          type: image.type,
          format: image.format,
          size: image.size,
          blob: new Blob([blob], { type: image.type }),
          createdAt: image.createdAt,
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          volatileCompressedImages.delete(image.id);
          await database
            ?.execute("DELETE FROM compressed_images WHERE id = ?", [image.id])
            .catch(() => undefined);
          return null;
        }
        throw error;
      }
    }),
  );
  return images
    .filter((image): image is CachedCompressedImage => image !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCompressed(id: string) {
  const volatile = volatileCompressedImages.get(id);
  volatileCompressedImages.delete(id);
  let path = volatile?.filePath ?? imagePath(id);
  try {
    const database = await getDatabaseClient();
    const [row] = await database.query<
      Record<string, SqlValue> & { file_path: string }
    >("SELECT file_path FROM compressed_images WHERE id = ?", [id]);
    await database.execute("DELETE FROM compressed_images WHERE id = ?", [id]);
    path = row?.file_path ?? path;
  } catch {
    // The OPFS path is deterministic when only volatile metadata is available.
  }
  await fileStorage.remove(path);
}

export async function clearCompressed() {
  const paths = new Set(
    [...volatileCompressedImages.values()].map((image) => image.filePath),
  );
  volatileCompressedImages.clear();
  try {
    const database = await getDatabaseClient();
    const rows = await database.query<
      Record<string, SqlValue> & { file_path: string }
    >("SELECT file_path FROM compressed_images");
    rows.forEach((row) => paths.add(row.file_path));
    await database.execute("DELETE FROM compressed_images");
  } catch {
    // Volatile OPFS files can still be cleared without SQLite metadata.
  }
  await Promise.all([...paths].map((path) => fileStorage.remove(path)));
}
