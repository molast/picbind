"use client";

let cachedMod: any = null;
export type OutputFormat = "jpeg" | "png" | "webp" | "avif";

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

export async function compressWithWasm(
  file: File,
  quality = 80,
  targetFormat?: OutputFormat,
) {
  const mod = await initWasm();
  if (!mod || typeof mod.compress_image !== "function") {
    throw new Error("WASM module failed to load correctly");
  }

  const buffer = await file.arrayBuffer();
  const input = new Uint8Array(buffer);
  const output =
    targetFormat && typeof mod.compress_image_to_format === "function"
      ? mod.compress_image_to_format(input, quality, targetFormat)
      : mod.compress_image(input, quality);
  const bytes = output.bytes as Uint8Array;
  const mime = output.mime as string;
  const ext = output.ext as string;
  const byteView = new Uint8Array(bytes);

  return {
    blob: new Blob([byteView], { type: mime }),
    mime,
    ext,
    fileName: buildCompressedFileName(file.name, ext),
  };
}
