"use client";

export type OutputFormat = "jpeg" | "png" | "webp" | "avif";

export function buildCompressedFileName(fileName: string, ext: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "compressed-image";
  return `nanoimg-${baseName}.${ext}`;
}
