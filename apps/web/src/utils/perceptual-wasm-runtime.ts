"use client";

let cachedModule: Promise<typeof import("@picbind/perceptual-wasm")> | null = null;

export async function initPerceptualWasm() {
  if (!cachedModule) {
    cachedModule = import("@picbind/perceptual-wasm").then(
      async (module) => {
        await module.default();
        return module;
      },
    );
  }
  return cachedModule;
}
