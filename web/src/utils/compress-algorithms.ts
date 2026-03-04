"use client";

import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
import { initWasm } from "@/utils/wasm-runtime";

export type CompressResult = {
  blob: Blob;
  mime: string;
  ext: string;
  fileName: string;
};

type JsQuashWebpModule = {
  encode: (
    data: ImageData,
    options?: {
      quality?: number;
      alpha_quality?: number;
      lossless?: 0 | 1 | boolean;
      method?: number;
      sns_strength?: number;
      filter_strength?: number;
      filter_sharpness?: number;
      filter_type?: number;
      segments?: number;
      pass?: number;
      autofilter?: number;
      alpha_compression?: number;
      alpha_filtering?: number;
      exact?: number;
      preprocessing?: number;
      use_sharp_yuv?: number;
      near_lossless?: number;
      image_hint?: number;
    },
  ) => Promise<ArrayBuffer>;
};

let cachedWebpCodec: Promise<JsQuashWebpModule> | null = null;

function toBlobPart(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function clampQuality(quality: number) {
  return Math.max(0, Math.min(quality, 100));
}

function hasTransparency(imageData: ImageData) {
  const { data } = imageData;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) {
      return true;
    }
  }

  return false;
}

async function decodeFileToImageData(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }

    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function getWebpCodec() {
  if (!cachedWebpCodec) {
    cachedWebpCodec = import("@jsquash/webp") as unknown as Promise<JsQuashWebpModule>;
  }

  return cachedWebpCodec;
}

type WebpEncodeOptions = NonNullable<Parameters<JsQuashWebpModule["encode"]>[1]>;

async function encodeSmallestWebp(
  codec: JsQuashWebpModule,
  imageData: ImageData,
  optionsList: WebpEncodeOptions[],
) {
  let smallest: Uint8Array | null = null;

  for (const options of optionsList) {
    const encoded = new Uint8Array(await codec.encode(imageData, options));
    if (!smallest || encoded.byteLength < smallest.byteLength) {
      smallest = encoded;
    }
  }

  if (!smallest) {
    throw new Error("Failed to encode WebP image");
  }

  return smallest;
}

async function compressWithWebpCodec(file: File, quality = 80): Promise<CompressResult> {
  const codec = await getWebpCodec();
  const imageData = await decodeFileToImageData(file);
  const normalizedQuality = clampQuality(quality);
  const transparent = hasTransparency(imageData);
  const isPngInput = file.type === "image/png";

  const webpCandidates: WebpEncodeOptions[] = transparent
    ? [
        {
          quality: Math.max(40, normalizedQuality - 4),
          alpha_quality: Math.max(88, normalizedQuality),
          lossless: 0,
          method: 6,
          pass: 4,
          sns_strength: 35,
          filter_strength: 18,
          filter_sharpness: 4,
          filter_type: 1,
          autofilter: 1,
          alpha_compression: 1,
          alpha_filtering: 2,
          exact: 0,
          preprocessing: 0,
          use_sharp_yuv: 1,
        },
        {
          quality: Math.max(34, normalizedQuality - 10),
          alpha_quality: Math.max(82, normalizedQuality - 2),
          lossless: 0,
          method: 6,
          pass: 5,
          sns_strength: 20,
          filter_strength: 12,
          filter_sharpness: 5,
          filter_type: 1,
          autofilter: 1,
          alpha_compression: 1,
          alpha_filtering: 2,
          exact: 0,
          preprocessing: 0,
          use_sharp_yuv: 1,
        },
      ]
    : [
        {
          quality: isPngInput ? Math.max(38, normalizedQuality - 8) : normalizedQuality,
          lossless: 0,
          method: 6,
          pass: 4,
          sns_strength: isPngInput ? 25 : 75,
          filter_strength: isPngInput ? 18 : 32,
          filter_sharpness: isPngInput ? 5 : 3,
          filter_type: 1,
          autofilter: 1,
          preprocessing: 0,
          segments: 4,
          use_sharp_yuv: 1,
        },
        {
          quality: isPngInput ? Math.max(30, normalizedQuality - 14) : Math.max(36, normalizedQuality - 6),
          lossless: 0,
          method: 6,
          pass: 5,
          sns_strength: isPngInput ? 12 : 55,
          filter_strength: isPngInput ? 8 : 24,
          filter_sharpness: isPngInput ? 6 : 4,
          filter_type: 1,
          autofilter: 1,
          preprocessing: 0,
          segments: 4,
          use_sharp_yuv: 1,
        },
      ];

  const bytes = await encodeSmallestWebp(codec, imageData, webpCandidates);

  const blob = new Blob([toBlobPart(bytes)], { type: "image/webp" });
  return {
    blob,
    mime: "image/webp",
    ext: "webp",
    fileName: buildCompressedFileName(file.name, "webp"),
  };
}

async function compressWithWasmCodec(
  file: File,
  quality = 80,
  targetFormat?: Exclude<OutputFormat, "webp">,
): Promise<CompressResult> {
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

  const bytes = output.bytes as Uint8Array;
  const mime = output.mime as string;
  const ext = output.ext as string;

  return {
    blob: new Blob([toBlobPart(bytes)], { type: mime }),
    mime,
    ext,
    fileName: buildCompressedFileName(file.name, ext),
  };
}

export async function compressImageWithAlgorithms(
  file: File,
  quality = 80,
  targetFormat?: OutputFormat,
): Promise<CompressResult> {
  if (targetFormat === "webp") {
    return compressWithWebpCodec(file, quality);
  }

  if (targetFormat === "avif") {
    throw new Error("AVIF compression is not supported yet");
  }

  return compressWithWasmCodec(file, quality, targetFormat);
}
