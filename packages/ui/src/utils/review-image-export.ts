"use client";

import type { RoomCompressionFormat } from "./room-image-compression";
import { compressRoomImageTask } from "./room-image-compression-task";

export type ReviewImageExport = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  format: Exclude<RoomCompressionFormat, "auto">;
  parameters?: Record<string, unknown>;
};

export type ReviewImageExportStage =
  | "preparing"
  | "waiting"
  | "transferring"
  | "complete";

export type ReviewImageExportOutcome = {
  status: "saved" | "shared" | "rejected";
  imageId: string;
};

function reviewOutputFormat(type: string): Exclude<RoomCompressionFormat, "auto"> {
  const subtype = type.split("/")[1]?.toLowerCase();
  if (subtype === "jpg" || subtype === "jpeg") return "jpeg";
  if (subtype === "png" || subtype === "webp" || subtype === "avif") return subtype;
  return "webp";
}

function reviewOutputName(
  name: string | undefined,
  format: Exclude<RoomCompressionFormat, "auto">,
) {
  const stem = (name || "image").replace(/\.[^.]+$/, "") || "image";
  const extension = format === "jpeg" ? "jpg" : format;
  return `${stem}-annotated.${extension}`;
}

export async function generateReviewImage(
  source: Blob & { name?: string },
  annotationSnapshot: string | null,
  signal?: AbortSignal,
): Promise<ReviewImageExport> {
  const sourceBitmap = await createImageBitmap(source);
  let annotationBitmap: ImageBitmap | null = null;
  try {
    if (annotationSnapshot) {
      const response = await fetch(annotationSnapshot);
      annotationBitmap = await createImageBitmap(await response.blob());
    }
    const canvas = new OffscreenCanvas(sourceBitmap.width, sourceBitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(sourceBitmap, 0, 0);
    if (annotationBitmap) {
      context.drawImage(
        annotationBitmap,
        0,
        0,
        annotationBitmap.width,
        annotationBitmap.height,
        0,
        0,
        sourceBitmap.width,
        sourceBitmap.height,
      );
    }
    const composite = await canvas.convertToBlob({ type: "image/png" });
    const controller = signal ? null : new AbortController();
    const preferredFormat = reviewOutputFormat(source.type);
    let compressed = await compressRoomImageTask(
      new File([composite], source.name || "review.png", { type: composite.type }),
      preferredFormat,
      signal || controller!.signal,
    );
    const oversizedThreshold = Math.max(source.size * 1.5, source.size + 512 * 1024);
    if (compressed.blob.size > oversizedThreshold) {
      const fallbackFormat = preferredFormat === "webp" ? "avif" : "webp";
      try {
        const fallback = await compressRoomImageTask(
          new File([composite], source.name || "review.png", { type: composite.type }),
          fallbackFormat,
          signal || controller!.signal,
        );
        if (fallback.blob.size < compressed.blob.size) compressed = fallback;
      } catch {
        // The preferred encoding remains valid when the optional fallback fails.
      }
    }
    return {
      blob: compressed.blob,
      name: reviewOutputName(source.name, compressed.format),
      width: sourceBitmap.width,
      height: sourceBitmap.height,
      format: compressed.format,
    };
  } finally {
    annotationBitmap?.close();
    sourceBitmap.close();
  }
}
