"use client";

import { getDatabaseClient } from "../client";
import { fileStorage } from "../file-storage";
import type { SqlValue } from "../types/client";

type QueuedFileRow = Record<string, SqlValue> & {
  name: string;
  type: string;
  file_path: string;
  created_at: number;
};

function filePath(id: string) {
  return `temp/compression/${fileStorage.segment(id)}`;
}

export async function storeQueuedFile(id: string, file: File) {
  const path = filePath(id);
  await fileStorage.write(path, file);
  try {
    const database = await getDatabaseClient();
    await database.execute(
      `INSERT INTO queued_files (id, name, type, size, file_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         size = excluded.size,
         file_path = excluded.file_path,
         created_at = excluded.created_at`,
      [id, file.name, file.type, file.size, path, Date.now()],
    );
  } catch (error) {
    await fileStorage.remove(path).catch(() => undefined);
    throw error;
  }
}

export async function getQueuedFile(id: string) {
  const database = await getDatabaseClient();
  const [row] = await database.query<QueuedFileRow>(
    "SELECT name, type, file_path, created_at FROM queued_files WHERE id = ?",
    [id],
  );
  if (!row) return null;
  try {
    const blob = await fileStorage.read(row.file_path);
    return new File([blob], row.name, {
      type: row.type,
      lastModified: Number(row.created_at),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      await database.execute("DELETE FROM queued_files WHERE id = ?", [id]);
      return null;
    }
    throw error;
  }
}

export async function deleteQueuedFile(id: string) {
  const database = await getDatabaseClient();
  const [row] = await database.query<Record<string, SqlValue> & { file_path: string }>(
    "SELECT file_path FROM queued_files WHERE id = ?",
    [id],
  );
  await database.execute("DELETE FROM queued_files WHERE id = ?", [id]);
  await fileStorage.remove(row?.file_path);
}
