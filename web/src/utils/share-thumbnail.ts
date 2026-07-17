"use client";

import { initWasm } from "./wasm-runtime";

export async function generateShareThumbnail(
  image: Blob,
  containerWidth: number,
  containerHeight: number,
) {
  const mod = await initWasm();
  if (!mod || typeof mod.generate_share_preview_thumbnail !== "function") {
    throw new Error(
      "WASM module does not expose generate_share_preview_thumbnail",
    );
  }
  const input = new Uint8Array(await image.arrayBuffer());
  const width = Math.max(1, Math.min(2048, Math.round(containerWidth)));
  const height = Math.max(1, Math.min(2048, Math.round(containerHeight)));
  let thumbnail: Uint8Array;
  try {
    thumbnail = new Uint8Array(
      mod.generate_share_preview_thumbnail(input, width, height) as Uint8Array,
    );
  } catch (error) {
    if (image.type !== "image/avif") throw error;
    thumbnail = await generateAvifThumbnail(mod, image, width, height);
  }
  if (thumbnail.byteLength > 10 * 1024) {
    throw new Error("WASM thumbnail exceeds the 10 KiB limit");
  }
  return thumbnail;
}

async function generateAvifThumbnail(
  mod: Record<string, unknown>,
  image: Blob,
  width: number,
  height: number,
) {
  const generateFromRgba = mod.generate_share_preview_thumbnail_from_rgba;
  if (typeof generateFromRgba !== "function") {
    throw new Error(
      "WASM module does not expose generate_share_preview_thumbnail_from_rgba",
    );
  }
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable for AVIF decoding");
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    const rgba = context.getImageData(0, 0, width, height).data;
    return new Uint8Array(
      generateFromRgba(width, height, rgba) as Uint8Array,
    );
  } finally {
    bitmap.close();
  }
}
