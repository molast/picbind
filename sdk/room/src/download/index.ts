import { getDownloadRepository } from "./download-repository-selector";

function safeFileName(fileName: string) {
  const name = fileName.split(/[\\/]/).pop()?.trim();
  return name || "picbind-download";
}

export function saveDownloadedBlob(blob: Blob, fileName: string) {
  return getDownloadRepository().save(blob, safeFileName(fileName));
}

export async function downloadUrl(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download source failed (${response.status})`);
  }
  return saveDownloadedBlob(await response.blob(), fileName);
}

export type { DownloadRepository } from "./download-repository";
