"use client";

let cachedMod: any = null;

export async function initWasm() {
  if (!cachedMod) {
    try {
      const mod: any = await import("@wasm/image_wasm");
      await mod.default();
      cachedMod = mod;
    } catch (err) {
      console.error("WASM load failed:", err);
      throw err;
    }
  }

  return cachedMod;
}

export function buildCompressedFileName(fileName: string, ext: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "compressed-image";
  return `${baseName}.${ext}`;
}

export async function compressWithWasm(file: File, quality = 80) {
  const mod = await initWasm();
  if (!mod || typeof mod.compress_image !== "function") {
    throw new Error("WASM module failed to load correctly");
  }

  const buffer = await file.arrayBuffer();
  const input = new Uint8Array(buffer);
  const output = mod.compress_image(input, quality);
  const bytes = output.bytes as Uint8Array;
  const mime = output.mime as string;
  const ext = output.ext as string;

  return {
    blob: new Blob([bytes], { type: mime }),
    mime,
    ext,
    fileName: buildCompressedFileName(file.name, ext),
  };
}