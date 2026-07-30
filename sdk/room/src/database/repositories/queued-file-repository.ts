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

type VolatileQueuedFile = {
  name: string;
  type: string;
  createdAt: number;
};

// OPFS file access does not require cross-origin isolation. Keep only the
// metadata in memory when the SQLite OPFS VFS cannot start in this tab.
const volatileQueuedFiles = new Map<string, VolatileQueuedFile>();

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
    volatileQueuedFiles.delete(id);
  } catch {
    volatileQueuedFiles.set(id, {
      name: file.name,
      type: file.type,
      createdAt: file.lastModified || Date.now(),
    });
  }
}

export async function getQueuedFile(id: string) {
  let row: QueuedFileRow | undefined;
  let database: Awaited<ReturnType<typeof getDatabaseClient>> | null = null;
  try {
    database = await getDatabaseClient();
    [row] = await database.query<QueuedFileRow>(
      "SELECT name, type, file_path, created_at FROM queued_files WHERE id = ?",
      [id],
    );
  } catch {
    // The in-memory metadata below keeps same-tab compression available.
  }

  const volatile = volatileQueuedFiles.get(id);
  if (!row && !volatile) return null;
  const path = row?.file_path ?? filePath(id);
  try {
    const blob = await fileStorage.read(path);
    return new File([blob], row?.name ?? volatile!.name, {
      type: row?.type ?? volatile!.type,
      lastModified: Number(row?.created_at ?? volatile!.createdAt),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      volatileQueuedFiles.delete(id);
      await database?.execute("DELETE FROM queued_files WHERE id = ?", [id]);
      return null;
    }
    throw error;
  }
}

export async function deleteQueuedFile(id: string) {
  volatileQueuedFiles.delete(id);
  let path = filePath(id);
  try {
    const database = await getDatabaseClient();
    const [row] = await database.query<
      Record<string, SqlValue> & { file_path: string }
    >("SELECT file_path FROM queued_files WHERE id = ?", [id]);
    await database.execute("DELETE FROM queued_files WHERE id = ?", [id]);
    path = row?.file_path ?? path;
  } catch {
    // The deterministic OPFS path is enough to clean up the volatile entry.
  }
  await fileStorage.remove(path);
}
