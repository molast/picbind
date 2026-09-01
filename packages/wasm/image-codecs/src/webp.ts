"use client";

// Owns the browser WebP runtime shared by Web and Workspace workers.

import webpEncoderWasmUrl from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import webpEncoderSimdWasmUrl from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";
import { simd } from "wasm-feature-detect";

export type LibwebpEncodeOptions = {
  quality: number;
  target_size: number;
  target_PSNR: number;
  method: number;
  sns_strength: number;
  filter_strength: number;
  filter_sharpness: number;
  filter_type: number;
  partitions: number;
  segments: number;
  pass: number;
  show_compressed: number;
  preprocessing: number;
  autofilter: number;
  partition_limit: number;
  alpha_compression: number;
  alpha_filtering: number;
  alpha_quality: number;
  lossless: number;
  exact: number;
  image_hint: number;
  emulate_jpeg_size: number;
  thread_level: number;
  low_memory: number;
  near_lossless: number;
  use_delta_palette: number;
  use_sharp_yuv: number;
};

type RawLibwebpModule = {
  encode(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: LibwebpEncodeOptions,
  ): Uint8Array | null;
};

const defaultOptions: LibwebpEncodeOptions = {
  quality: 75,
  target_size: 0,
  target_PSNR: 0,
  method: 4,
  sns_strength: 50,
  filter_strength: 60,
  filter_sharpness: 0,
  filter_type: 1,
  partitions: 0,
  segments: 4,
  pass: 1,
  show_compressed: 0,
  preprocessing: 0,
  autofilter: 0,
  partition_limit: 0,
  alpha_compression: 1,
  alpha_filtering: 1,
  alpha_quality: 100,
  lossless: 0,
  exact: 0,
  image_hint: 0,
  emulate_jpeg_size: 0,
  thread_level: 0,
  low_memory: 0,
  near_lossless: 100,
  use_delta_palette: 0,
  use_sharp_yuv: 0,
};

let simdSupport: Promise<boolean> | null = null;
let scalarModule: Promise<RawLibwebpModule> | null = null;
let simdModule: Promise<RawLibwebpModule> | null = null;

function webpEncoderAsset(path: string) {
  return path.includes("webp_enc_simd.wasm")
    ? webpEncoderSimdWasmUrl
    : webpEncoderWasmUrl;
}

async function createLibwebpModule(useSimd: boolean) {
  const { default: createModule } = useSimd
    ? await import("@jsquash/webp/codec/enc/webp_enc_simd.js")
    : await import("@jsquash/webp/codec/enc/webp_enc.js");
  return (await createModule({
    noInitialRun: true,
    locateFile: webpEncoderAsset,
  })) as RawLibwebpModule;
}

function getLibwebpModule(useSimd: boolean) {
  if (useSimd) {
    simdModule ??= createLibwebpModule(true);
    return simdModule;
  }
  scalarModule ??= createLibwebpModule(false);
  return scalarModule;
}

function invalidateLibwebpModule(useSimd: boolean) {
  if (useSimd) simdModule = null;
  else scalarModule = null;
}

function encode(
  module: RawLibwebpModule,
  image: ImageData,
  options: LibwebpEncodeOptions,
) {
  const encoded = module.encode(image.data, image.width, image.height, options);
  if (!encoded) throw new Error("libwebp failed to encode image");
  return encoded.slice();
}

export async function encodeWithLibwebp(
  image: ImageData,
  options: Partial<LibwebpEncodeOptions> = {},
) {
  const resolvedOptions = { ...defaultOptions, ...options };
  simdSupport ??= simd();
  const useSimd = await simdSupport;
  let initialError: unknown;

  try {
    const module = await getLibwebpModule(useSimd);
    return encode(module, image, resolvedOptions);
  } catch (error) {
    initialError = error;
    invalidateLibwebpModule(useSimd);
  }

  try {
    const module = await getLibwebpModule(false);
    return encode(module, image, resolvedOptions);
  } catch (error) {
    invalidateLibwebpModule(false);
    const details = [initialError, error]
      .map((value) =>
        value instanceof Error ? value.message : String(value ?? ""),
      )
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `libwebp failed to encode ${image.width}x${image.height} image` +
        (details ? ` (${details})` : ""),
    );
  }
}
