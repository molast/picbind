"use client";

let cachedMod: any = null;

// 初始化 wasm 模块（使用 wasm-pack 生成的默认 init 函数）
export async function initWasm() {
  if (!cachedMod) {
    try {
      const mod: any = await import("@wasm/image_wasm");
      // 不传参数，交给 wasm-pack 生成的 init 自己去加载 image_wasm_bg.wasm
      await mod.default();
      cachedMod = mod;
    } catch (err) {
      console.error("WASM load failed:", err);
      throw err;
    }
  }

  return cachedMod;
}

// 用 wasm 压缩单张图片
export async function compressWithWasm(file: File, quality = 80) {
  const mod = await initWasm();
  if (!mod || typeof mod.compress_image !== "function") {
    throw new Error("WASM 模块未正确加载");
  }

  const buffer = await file.arrayBuffer();
  const input = new Uint8Array(buffer);

  const output = mod.compress_image(input, quality) as Uint8Array;

  return new Blob([output], { type: "image/jpeg" });
}

