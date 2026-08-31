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
  const thumbnail = new Uint8Array(
    mod.generate_share_preview_thumbnail(input, width, height) as Uint8Array,
  );
  if (thumbnail.byteLength > 10 * 1024) {
    throw new Error("WASM thumbnail exceeds the 10 KiB limit");
  }
  return thumbnail;
}
