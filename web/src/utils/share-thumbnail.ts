"use client";

import { initWasm } from "./wasm-runtime";

export async function generateShareThumbnail(image: Blob) {
  const mod = await initWasm();
  if (!mod || typeof mod.generate_share_thumbnail !== "function") {
    throw new Error("WASM module does not expose generate_share_thumbnail");
  }
  const input = new Uint8Array(await image.arrayBuffer());
  return new Uint8Array(mod.generate_share_thumbnail(input) as Uint8Array);
}
