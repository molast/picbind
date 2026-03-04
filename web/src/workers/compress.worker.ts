/// <reference lib="webworker" />

import type { OutputFormat } from "@/utils/wasm";

type WasmCompressionModule = {
  default: () => Promise<unknown>;
  compress_image: (input: Uint8Array, quality: number) => {
    bytes: Uint8Array;
    mime: string;
    ext: string;
  };
  compress_image_to_format?: (
    input: Uint8Array,
    quality: number,
    targetFormat: OutputFormat,
  ) => {
    bytes: Uint8Array;
    mime: string;
    ext: string;
  };
};

type WorkerRequest = {
  id: string;
  file: File;
  quality: number;
  targetFormat?: OutputFormat;
};

const workerScope = self as DedicatedWorkerGlobalScope;
let cachedMod: WasmCompressionModule | null = null;

function buildCompressedFileName(fileName: string, ext: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "compressed-image";
  return `${baseName}.${ext}`;
}

async function initWasm() {
  if (!cachedMod) {
    const mod = (await import("@wasm/image_wasm")) as WasmCompressionModule;
    await mod.default();
    cachedMod = mod;
  }

  return cachedMod;
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file, quality, targetFormat } = event.data;

  try {
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

    const bytes = output.bytes;
    const mime = output.mime;
    const ext = output.ext;
    const cloned = new Uint8Array(bytes.length);
    cloned.set(bytes);

    workerScope.postMessage(
      {
        id,
        ok: true,
        bytes: cloned.buffer,
        mime,
        ext,
        fileName: buildCompressedFileName(file.name, ext),
      },
      [cloned.buffer],
    );
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown compression error",
    });
  }
};

export {};
