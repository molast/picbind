"use client";

import type { ImageObjectOperation } from "./image-object";
import { replaceFileExtension } from "./image-object";
import { getLang, getShareRoomLabels } from "../locales";
import {
  type RoomColorAdjustments,
} from "./room-color-adjustments";
import type { RoomCompressionFormat } from "./room-image-compression";
import { compressRoomImageTask } from "./room-image-compression-task";
import { getRoomSdkConfig } from "../config";
export type { RoomColorAdjustments } from "./room-color-adjustments";

export type RoomImageEditResult = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  operation: Extract<ImageObjectOperation, "adjust" | "convert" | "crop" | "resize">;
};

export type NormalizedCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function normalizedMime(type: string) {
  return type === "image/jpg" ? "image/jpeg" : type;
}

function outputFormat(sourceType: string): Exclude<RoomCompressionFormat, "auto"> | null {
  const type = normalizedMime(sourceType);
  if (type === "image/jpeg") return "jpeg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/avif") return "avif";
  return null;
}

function editingEncodingPreset(format: Exclude<RoomCompressionFormat, "auto">) {
  if (format === "avif") return { quality: 58, compressionGain: 1 };
  if (format === "png") return { quality: 78, compressionGain: 1.12 };
  return { quality: 78, compressionGain: format === "jpeg" ? 1.08 : 1 };
}

async function encodeEditedPixels(
  pixels: Blob,
  source: Blob & { name?: string },
) {
  const format = outputFormat(source.type);
  if (!format) throw new Error(getShareRoomLabels(getLang()).browserCannotEncode);

  const input = new File([pixels], source.name || "image.png", { type: pixels.type });
  const controller = new AbortController();
  const preset = editingEncodingPreset(format);
  const result = await compressRoomImageTask(
    input,
    format,
    controller.signal,
    undefined,
    false,
    {
      ...preset,
      sourceSizeBytes: source.size,
      forceEncode: true,
    },
  );
  return result.blob;
}

async function encodeCanvas(
  canvas: OffscreenCanvas,
  source: Blob & { name?: string },
) {
  // Canvas PNG is only a short-lived lossless pixel carrier. The shared codec
  // chain performs the final source-format encoding and PNG optimization.
  return encodeEditedPixels(
    await canvas.convertToBlob({ type: "image/png" }),
    source,
  );
}

type ColorWorkerMessage =
  | { ok: true; bytes: ArrayBuffer; mime: string; width: number; height: number }
  | { ok: false; error: string };

function adjustPixelsInWorker(
  image: File,
  adjustments: RoomColorAdjustments,
  format: Exclude<RoomCompressionFormat, "auto">,
): Promise<{ blob: Blob; width: number; height: number }> {
  const worker = new Worker(
    new URL("../workers/room-color-adjustment.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void) => {
      worker.terminate();
      callback();
    };
    worker.onmessage = (event: MessageEvent<ColorWorkerMessage>) => {
      const message = event.data;
      if (!message.ok) {
        finish(() => reject(new Error(message.error)));
        return;
      }
      finish(() => resolve({
        blob: new Blob([message.bytes], { type: message.mime }),
        width: message.width,
        height: message.height,
      }));
    };
    worker.onerror = (event) => {
      finish(() => reject(event.error || new Error(event.message)));
    };
    worker.postMessage({
      image,
      adjustments,
      format,
      lang: getLang(),
      sourceSizeBytes: image.size,
      encodingOptions: editingEncodingPreset(format),
      wasmBaseUrl: getRoomSdkConfig().wasmBaseUrl,
    });
  });
}

async function decodeImage(blob: Blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(blob);
  }
}

function resultName(name: string, blob: Blob) {
  return replaceFileExtension(name, MIME_EXTENSIONS[normalizedMime(blob.type)] || "png");
}

export async function resizeRoomImage(
  image: Blob & { name?: string },
  width: number,
  height: number,
): Promise<RoomImageEditResult> {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const bitmap = await decodeImage(image);
  try {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await encodeCanvas(canvas, image);
    return {
      blob,
      name: resultName(image.name || "image", blob),
      width: targetWidth,
      height: targetHeight,
      operation: "resize",
    };
  } finally {
    bitmap.close();
  }
}

export async function cropRoomImage(
  image: Blob & { name?: string },
  crop: NormalizedCrop,
): Promise<RoomImageEditResult> {
  const bitmap = await decodeImage(image);
  try {
    const sourceX = Math.max(0, Math.min(bitmap.width - 1, Math.round(crop.x * bitmap.width)));
    const sourceY = Math.max(0, Math.min(bitmap.height - 1, Math.round(crop.y * bitmap.height)));
    const width = Math.max(1, Math.min(bitmap.width - sourceX, Math.round(crop.width * bitmap.width)));
    const height = Math.max(1, Math.min(bitmap.height - sourceY, Math.round(crop.height * bitmap.height)));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, sourceX, sourceY, width, height, 0, 0, width, height);
    const blob = await encodeCanvas(canvas, image);
    return {
      blob,
      name: resultName(image.name || "image", blob),
      width,
      height,
      operation: "crop",
    };
  } finally {
    bitmap.close();
  }
}

export async function adjustRoomImage(
  image: Blob & { name?: string },
  adjustments: RoomColorAdjustments,
): Promise<RoomImageEditResult> {
  const format = outputFormat(image.type);
  if (!format) throw new Error(getShareRoomLabels(getLang()).browserCannotEncode);
  const source = new File([image], image.name || "image", { type: image.type });
  const adjusted = await adjustPixelsInWorker(source, adjustments, format);
  const blob = adjusted.blob;
  return {
    blob,
    name: resultName(image.name || "image", blob),
    width: adjusted.width,
    height: adjusted.height,
    operation: "adjust",
  };
}
