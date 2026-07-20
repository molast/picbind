"use client";

import {
  deleteQueuedFile,
  getQueuedFile,
  storeQueuedFile,
} from "@/database/repositories/queued-file-repository";

const COMPRESSION_HANDOFF_KEY = "picbind:compression-handoff";
export const COMPRESSION_HANDOFF_EVENT = "picbind:compression-handoff-ready";

export const storeQueuedImageFile = storeQueuedFile;
export const getQueuedImageFile = getQueuedFile;
export const deleteQueuedImageFile = deleteQueuedFile;

export async function queueFilesForCompression(files: File[]) {
  const entries = files.map((file) => ({
    id: `handoff-${crypto.randomUUID()}`,
    file,
  }));
  await Promise.all(entries.map(({ id, file }) => storeQueuedFile(id, file)));
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
  const files = await Promise.all(ids.map((id) => getQueuedFile(id)));
  await Promise.all(ids.map((id) => deleteQueuedFile(id)));
  return files.filter((file): file is File => file instanceof File);
}
