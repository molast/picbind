"use client";

import {
  deleteQueuedFile,
  getQueuedFile,
  storeQueuedFile,
} from "../database/repositories/queued-file-repository";

const COMPRESSION_HANDOFF_KEY = "picbind:compression-handoff";
export const COMPRESSION_HANDOFF_EVENT = "picbind:compression-handoff-ready";

const stagedFiles = new Map<string, File>();
const pendingStores = new Map<string, Promise<void>>();
const persistedFiles = new Set<string>();

export function stageQueuedImageFile(id: string, file: File) {
  stagedFiles.set(id, file);
}

export function storeQueuedImageFile(id: string, file: File) {
  stageQueuedImageFile(id, file);
  const pending = storeQueuedFile(id, file)
    .then(() => {
      persistedFiles.add(id);
    })
    .finally(() => {
      if (pendingStores.get(id) === pending) {
        pendingStores.delete(id);
      }
    });
  pendingStores.set(id, pending);
  return pending;
}

export async function getQueuedImageFile(id: string) {
  return stagedFiles.get(id) ?? getQueuedFile(id);
}

export async function releaseStagedQueuedImageFile(id: string) {
  const pending = pendingStores.get(id);
  if (pending) {
    try {
      await pending;
    } catch {
      return false;
    }
  }

  if (!persistedFiles.has(id)) return false;
  persistedFiles.delete(id);
  return stagedFiles.delete(id);
}

export async function deleteQueuedImageFile(id: string) {
  stagedFiles.delete(id);
  persistedFiles.delete(id);
  await pendingStores.get(id)?.catch(() => undefined);
  await deleteQueuedFile(id);
}

export async function queueFilesForCompression(files: File[]) {
  const entries = files.map((file) => ({
    id: `handoff-${crypto.randomUUID()}`,
    file,
  }));
  await Promise.all(
    entries.map(({ id, file }) => storeQueuedImageFile(id, file)),
  );
  localStorage.setItem(
    COMPRESSION_HANDOFF_KEY,
    JSON.stringify(entries.map(({ id }) => id)),
  );
  window.dispatchEvent(new Event(COMPRESSION_HANDOFF_EVENT));
}

export async function consumeFilesForCompression() {
  const raw = localStorage.getItem(COMPRESSION_HANDOFF_KEY);
  localStorage.removeItem(COMPRESSION_HANDOFF_KEY);
  if (!raw) return [];
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      ids = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    return [];
  }
  const files = await Promise.all(ids.map((id) => getQueuedImageFile(id)));
  await Promise.all(ids.map((id) => deleteQueuedImageFile(id)));
  return files.filter((file): file is File => file instanceof File);
}
