"use client";

export type OutputFormat = "jpeg" | "png" | "webp" | "avif";

export function buildCompressedFileName(fileName: string, ext: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "compressed-image";
  return `${baseName}.${ext}`;
}

export function buildZipEntryFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `picbind-${fileName}`;
  }

  const baseName = fileName.slice(0, dotIndex);
  const ext = fileName.slice(dotIndex + 1);
  return `picbind-${baseName}.${ext}`;
}
