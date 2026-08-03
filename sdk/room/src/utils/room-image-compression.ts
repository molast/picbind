/// <reference path="../types/asset-url.d.ts" />

"use client";

import { initWasm } from "./wasm-runtime";
import { replaceFileExtension } from "./image-object";
import { encodeWithLibavif, encodeWithLibwebp } from "@picbind/image-codecs";
import { getLang, getShareRoomLabels, type Lang, type ShareRoomLabels } from "../locales";

export type RoomCompressionFormat = "auto" | "jpeg" | "png" | "webp" | "avif";

export type RoomCompressionResult = {
  blob: Blob;
  format: Exclude<RoomCompressionFormat, "auto">;
  name: string;
  width: number;
  height: number;
  operation: "compress";
};

export type RoomCompressionDimensions = {
  width: number;
  height: number;
};

type CompressionResultHandle = {
  readonly bytes: Uint8Array;
  readonly ext: string;
  readonly mime: string;
  free?(): void;
};

const FORMATS = new Set(["jpeg", "png", "webp", "avif"]);
const ROOM_OUTPUT_FORMATS = new Set(["jpeg", "webp", "avif"]);

function sourceFormat(blob: Blob) {
  const subtype = blob.type.split("/")[1]?.toLowerCase();
  if (subtype === "jpg") return "jpeg";
  return FORMATS.has(subtype) ? subtype : "jpeg";
}

async function decodeImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function resizeImageWithWasm(
  blob: Blob,
  width: number,
  height: number,
) {
  const mod = await initWasm();
  const input = new Uint8Array(await blob.arrayBuffer());
  const rgba = mod.resize_image_to_rgba(input, width, height) as Uint8Array;
  return new ImageData(new Uint8ClampedArray(rgba), width, height);
}

function toBlobPart(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function resultFromHandle(handle: CompressionResultHandle) {
  try {
    const bytes = new Uint8Array(handle.bytes);
    return new Blob([toBlobPart(bytes)], { type: handle.mime });
  } finally {
    handle.free?.();
  }
}

function hasRealAlpha(image: ImageData) {
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] < 255) return true;
  }
  return false;
}

async function encodeWasm(
  blob: Blob,
  format: "jpeg" | "png",
  labels: ShareRoomLabels,
  allowAlphaLoss: boolean,
  dimensions?: RoomCompressionDimensions,
) {
  const mod = await initWasm();
  const input = new Uint8Array(await blob.arrayBuffer());
  try {
    const handle = dimensions
      ? mod.compress_image_to_format_with_resize_options(
          input,
          82,
          format,
          allowAlphaLoss,
          1,
          dimensions.width,
          dimensions.height,
        )
      : mod.compress_image_to_format_with_plan_options(
          input,
          82,
          format,
          allowAlphaLoss,
          1,
        );
    return resultFromHandle(handle as CompressionResultHandle);
  } catch (error) {
    const image = dimensions
      ? await resizeImageWithWasm(blob, dimensions.width, dimensions.height)
      : await decodeImage(blob);
    if (format === "png") {
      return resultFromHandle(
        mod.compress_rgba_to_png_with_gain(
          image.data,
          image.width,
          image.height,
          82,
          blob.size,
          1,
        ) as CompressionResultHandle,
      );
    }
    if (hasRealAlpha(image) && !allowAlphaLoss) {
      throw new Error(labels.jpegAlphaUnsupported);
    }
    if (dimensions) throw error;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d", { alpha: !allowAlphaLoss });
    if (!context) throw error;
    if (allowAlphaLoss) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, image.width, image.height);
    }
    const bitmap = await createImageBitmap(image);
    try {
      context.drawImage(bitmap, 0, 0);
    } finally {
      bitmap.close();
    }
    const encoded = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    if (encoded.type !== "image/jpeg") throw error;
    return encoded;
  }
}

async function encodeJsquash(
  image: ImageData,
  format: "webp" | "avif",
) {
  let bytes: ArrayBuffer;
  if (format === "webp") {
    bytes = toBlobPart(await encodeWithLibwebp(image, { quality: 82 }));
  } else {
    const encoded = await encodeWithLibavif(
      image,
      {
        quality: 62,
        qualityAlpha: -1,
        denoiseLevel: 0,
        tileColsLog2: 0,
        tileRowsLog2: 0,
        speed: 8,
        subsample: 1,
        chromaDeltaQ: false,
        sharpness: 0,
        tune: 0,
        enableSharpYUV: false,
        bitDepth: 8,
        lossless: false,
      },
    );
    bytes = toBlobPart(encoded);
  }
  return new Blob([bytes], { type: `image/${format}` });
}

async function recommendedFormat(blob: Blob, resizedImage?: ImageData) {
  const fallback = sourceFormat(blob);
  try {
    const mod = await initWasm();
    const prediction = (resizedImage
      ? mod.predict_compression_rgba(
          resizedImage.data,
          resizedImage.width,
          resizedImage.height,
          blob.size,
          fallback,
        )
      : mod.predict_compression(new Uint8Array(await blob.arrayBuffer()))) as {
      recommendedFormat?: string;
    };
    return ROOM_OUTPUT_FORMATS.has(prediction.recommendedFormat || "")
      ? (prediction.recommendedFormat as "jpeg" | "webp" | "avif")
      : fallback === "jpeg" || fallback === "webp" || fallback === "avif"
        ? fallback
        : "webp";
  } catch {
    return fallback === "jpeg" || fallback === "webp" || fallback === "avif"
      ? fallback
      : "webp";
  }
}

export async function compressRoomImage(
  image: Blob & { name?: string },
  requestedFormat: RoomCompressionFormat,
  dimensions?: RoomCompressionDimensions,
  lang: Lang = getLang(),
  allowAlphaLoss = false,
): Promise<RoomCompressionResult> {
  const labels = getShareRoomLabels(lang);
  const decoded = await decodeImage(image);
  const targetWidth = Math.round(dimensions?.width ?? decoded.width);
  const targetHeight = Math.round(dimensions?.height ?? decoded.height);
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    targetWidth < 1 ||
    targetHeight < 1 ||
    targetWidth > 16384 ||
    targetHeight > 16384
  ) {
    throw new Error(labels.imageDimensionInvalid);
  }
  const resized = targetWidth !== decoded.width || targetHeight !== decoded.height;
  let resizedImage: ImageData | undefined;
  if (resized && (requestedFormat === "auto" || requestedFormat === "webp" || requestedFormat === "avif")) {
    resizedImage = await resizeImageWithWasm(image, targetWidth, targetHeight);
  }
  const format =
    requestedFormat === "auto"
      ? await recommendedFormat(image, resizedImage)
      : requestedFormat;
  if (format === "jpeg" && hasRealAlpha(decoded) && !allowAlphaLoss) {
    throw new Error(labels.jpegAlphaUnsupported);
  }
  let blob =
    format === "webp" || format === "avif"
      ? await encodeJsquash(
          resizedImage ??
            (resized
              ? await resizeImageWithWasm(image, targetWidth, targetHeight)
              : decoded),
          format,
        )
      : await encodeWasm(
          image,
          format,
          labels,
          allowAlphaLoss,
          resized ? { width: targetWidth, height: targetHeight } : undefined,
        );
  if (!resized && format === sourceFormat(image) && blob.size >= image.size) {
    blob = image;
  }
  const extension = format === "jpeg" ? "jpg" : format;
  return {
    blob,
    format,
    name: replaceFileExtension(image.name || "image", extension),
    width: targetWidth,
    height: targetHeight,
    operation: "compress",
  };
}
