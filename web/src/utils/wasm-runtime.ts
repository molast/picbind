"use client";

let cachedMod: any = null;
let cachedModPromise: Promise<any> | null = null;

export async function initWasm() {
  if (cachedMod) return cachedMod;
  if (!cachedModPromise) {
    cachedModPromise = (async () => {
      try {
        const mod: any = await import("@image-wasm/image_wasm");
        await mod.default();
        cachedMod = mod;
        return mod;
      } catch (err) {
        cachedModPromise = null;
        console.error("WASM load failed:", err);
        throw err;
      }
    })();
  }
  return cachedModPromise;
}
