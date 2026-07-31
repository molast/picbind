"use client";

import type { ImageObjectOperation } from "./image-object";
import { replaceFileExtension } from "./image-object";
import {
  applyRoomColorAdjustments,
  type RoomColorAdjustments,
} from "./room-color-adjustments";
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

async function encodeCanvas(canvas: OffscreenCanvas, sourceType: string) {
  const preferredType = normalizedMime(sourceType);
  const candidates = [
    preferredType,
    preferredType === "image/jpeg" ? "image/webp" : "image/png",
  ].filter((type, index, values) => MIME_EXTENSIONS[type] && values.indexOf(type) === index);

  for (const type of candidates) {
    try {
      const blob = await canvas.convertToBlob({
        type,
        quality: type === "image/jpeg" || type === "image/webp" || type === "image/avif" ? 0.92 : undefined,
      });
      if (normalizedMime(blob.type) === type) return blob;
    } catch {
      // Try the next Alpha-safe browser encoder.
    }
  }
  throw new Error("当前浏览器无法编码编辑后的图片");
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
    const blob = await encodeCanvas(canvas, image.type);
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
    const blob = await encodeCanvas(canvas, image.type);
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
  const bitmap = await decodeImage(image);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    context.putImageData(applyRoomColorAdjustments(pixels, adjustments), 0, 0);
    const blob = await encodeCanvas(canvas, image.type);
    return {
      blob,
      name: resultName(image.name || "image", blob),
      width: bitmap.width,
      height: bitmap.height,
      operation: "adjust",
    };
  } finally {
    bitmap.close();
  }
}
