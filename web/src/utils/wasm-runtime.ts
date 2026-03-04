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
