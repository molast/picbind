"use client";

let cachedModule: Promise<typeof import("@perceptual-wasm/perceptual_wasm")> | null = null;

export async function initPerceptualWasm() {
  if (!cachedModule) {
    cachedModule = import("@perceptual-wasm/perceptual_wasm").then(
      async (module) => {
        await module.default();
        return module;
      },
    );
  }
  return cachedModule;
}
