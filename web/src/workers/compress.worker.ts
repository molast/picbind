let cachedMod = null;

function buildCompressedFileName(fileName, ext) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || "compressed-image";
  return `${baseName}.${ext}`;
}

async function initWasm() {
  if (!cachedMod) {
    const mod = await import("@wasm/image_wasm");
    await mod.default();
    cachedMod = mod;
  }
  return cachedMod;
}

self.onmessage = async (event) => {
  const { id, file, quality } = event.data;

  try {
    const mod = await initWasm();
    if (!mod || typeof mod.compress_image !== "function") {
      throw new Error("WASM module failed to load correctly");
    }

    const buffer = await file.arrayBuffer();
    const input = new Uint8Array(buffer);
    const output = mod.compress_image(input, quality);
    const bytes = output.bytes;
    const mime = output.mime;
    const ext = output.ext;
    const cloned = new Uint8Array(bytes.length);
    cloned.set(bytes);

    self.postMessage(
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
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown compression error",
    });
  }
};
