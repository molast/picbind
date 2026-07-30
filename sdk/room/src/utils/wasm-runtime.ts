"use client";

import { getRoomSdkConfig } from "../config";

let cachedMod: any = null;
let cachedModPromise: Promise<any> | null = null;

export async function initWasm() {
  if (cachedMod) return cachedMod;
  if (!cachedModPromise) {
    cachedModPromise = (async () => {
      try {
        const baseUrl = (getRoomSdkConfig().wasmBaseUrl || "/wasm").replace(
          /\/$/,
          "",
        );
        const moduleUrl = `${baseUrl}/image_wasm.js`;
        const mod: any = await import(
          /* webpackIgnore: true */ /* @vite-ignore */ moduleUrl
        );
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
