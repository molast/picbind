"use client";

import { getRoomSdkConfig } from "../config";

let cachedMod: any = null;
let cachedModPromise: Promise<any> | null = null;

async function loadWasmModule() {
  const configuredBaseUrl = getRoomSdkConfig().wasmBaseUrl?.trim();
  if (!configuredBaseUrl) {
    return import("@picbind/image-wasm");
  }

  const baseUrl = configuredBaseUrl.replace(/\/$/, "");
  const moduleUrl = `${baseUrl}/image_wasm.js`;
  return import(/* webpackIgnore: true */ /* @vite-ignore */ moduleUrl);
}

export async function initWasm() {
  if (cachedMod) return cachedMod;
  if (!cachedModPromise) {
    cachedModPromise = (async () => {
      try {
        const mod: any = await loadWasmModule();
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
