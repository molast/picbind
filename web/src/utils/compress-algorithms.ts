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

function sourceFormatFromFile(file: File): OutputFormat {
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  return "jpeg";
}

function extForFormat(format: OutputFormat) {
  if (format === "jpeg") {
    return "jpg";
  }
  return format;
}

function requiresSmallerResult(
  requestedFormat: OutputFormat,
  sourceFormat: OutputFormat,
) {
  if (requestedFormat === "jpeg") {
    return true;
  }

  if (requestedFormat === "png" || requestedFormat === "webp") {
    return false;
  }

  return requestedFormat === sourceFormat;
}

function buildJpegFallbackQualities(quality: number) {
  const start = Math.min(quality, 85);
  const candidates = [
    start,
    start - 5,
    start - 10,
    start - 15,
    start - 20,
    start - 25,
    start - 30,
    45,
    40,
    35,
    30,
    25,
    20,
    15,
    10,
    8,
    6,
  ]
    .map((value) => clampQuality(value))
    .filter((value) => value > 0);

  return Array.from(new Set(candidates)).sort((a, b) => b - a);
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

function analyzeImageData(imageData: ImageData) {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const sampleStride = Math.max(1, Math.floor(Math.sqrt(pixelCount / 12000)));

  let sampledPixels = 0;
  let alphaPixels = 0;
  let edgePixels = 0;
  let flatPixels = 0;
  let lumaSum = 0;
  let lumaSqSum = 0;

  const getIndex = (x: number, y: number) => (y * width + x) * 4;
  const lumaAt = (index: number) =>
    data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;

  for (let y = sampleStride; y < height - sampleStride; y += sampleStride) {
    for (let x = sampleStride; x < width - sampleStride; x += sampleStride) {
      const index = getIndex(x, y);
      const luma = lumaAt(index);
      const left = lumaAt(getIndex(x - sampleStride, y));
      const right = lumaAt(getIndex(x + sampleStride, y));
      const up = lumaAt(getIndex(x, y - sampleStride));
      const down = lumaAt(getIndex(x, y + sampleStride));

      const gradient = Math.abs(left - right) + Math.abs(up - down);

      sampledPixels += 1;
      lumaSum += luma;
      lumaSqSum += luma * luma;

      if (data[index + 3] < 255) {
        alphaPixels += 1;
      }

      if (gradient >= 24) {
        edgePixels += 1;
      } else if (gradient <= 8) {
        flatPixels += 1;
      }
    }
  }

  const meanLuma = sampledPixels ? lumaSum / sampledPixels : 0;
  const variance = sampledPixels
    ? Math.max(0, lumaSqSum / sampledPixels - meanLuma * meanLuma)
    : 0;

  return {
    pixelCount,
    sampledPixels,
    alphaRatio: sampledPixels ? alphaPixels / sampledPixels : 0,
    edgeCoverage: sampledPixels ? edgePixels / sampledPixels : 0,
    flatCoverage: sampledPixels ? flatPixels / sampledPixels : 0,
    lumaVariance: variance / (255 * 255),
  };
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

async function encodeCanvasJpeg(
  file: File,
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }

    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({
      type: "image/jpeg",
      quality: clampQuality(quality) / 100,
    });
  } finally {
    bitmap.close();
  }
}

async function compressJpegWithCanvasFallback(
  file: File,
  quality = 80,
  requireSmaller = true,
): Promise<CompressResult> {
  let bestBlob: Blob | null = null;
  let bestAnyBlob: Blob | null = null;

  for (const candidateQuality of buildJpegFallbackQualities(quality)) {
    const blob = await encodeCanvasJpeg(file, candidateQuality);

    if (!bestAnyBlob || blob.size < bestAnyBlob.size) {
      bestAnyBlob = blob;
    }

    if (blob.size >= file.size) {
      continue;
    }

    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }
  }

  const resultBlob = requireSmaller ? bestBlob : bestBlob || bestAnyBlob;
  if (!resultBlob) {
    throw new Error("JPEG fallback could not produce a smaller file");
  }

  return {
    blob: resultBlob,
    mime: "image/jpeg",
    ext: "jpg",
    fileName: buildCompressedFileName(file.name, "jpg"),
  };
}

async function encodeCanvasPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }

    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({
      type: "image/png",
    });
  } finally {
    bitmap.close();
  }
}

async function compressPngWithCanvasFallback(file: File): Promise<CompressResult> {
  const blob = await encodeCanvasPng(file);
  if (blob.size >= file.size) {
    throw new Error("PNG fallback could not produce a smaller file");
  }

  return {
    blob,
    mime: "image/png",
    ext: "png",
    fileName: buildCompressedFileName(file.name, "png"),
  };
}

function isJpegCompressionFailure(error?: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");

  return /unreachable|memory|allocation|JPEG encode failed/i.test(message);
}

function shouldUsePngCanvasFallback(
  file: File,
  targetFormat?: Exclude<OutputFormat, "webp">,
  error?: unknown,
) {
  if (file.type !== "image/png" || (targetFormat && targetFormat !== "png")) {
    return false;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");

  return /unreachable|memory|allocation|PNG|quantiz/i.test(message);
}

async function encodeCanvasWebp(file: File, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }

    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({
      type: "image/webp",
      quality: clampQuality(quality) / 100,
    });
  } finally {
    bitmap.close();
  }
}

async function compressWebpWithCanvasFallback(
  file: File,
  quality = 80,
  requireSmaller = true,
): Promise<CompressResult> {
  let bestBlob: Blob | null = null;
  let bestAnyBlob: Blob | null = null;

  for (const candidateQuality of buildJpegFallbackQualities(quality)) {
    const blob = await encodeCanvasWebp(file, candidateQuality);

    if (!bestAnyBlob || blob.size < bestAnyBlob.size) {
      bestAnyBlob = blob;
    }

    if (blob.size >= file.size) {
      continue;
    }

    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }
  }

  const resultBlob = requireSmaller ? bestBlob : bestBlob || bestAnyBlob;
  if (!resultBlob) {
    throw new Error("WebP fallback could not produce a usable file");
  }

  return {
    blob: resultBlob,
    mime: "image/webp",
    ext: "webp",
    fileName: buildCompressedFileName(file.name, "webp"),
  };
}

async function encodeCanvasAvif(file: File, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }

    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({
      type: "image/avif",
      quality: clampQuality(quality) / 100,
    });
  } finally {
    bitmap.close();
  }
}

async function compressAvifWithCanvasFallback(
  file: File,
  quality = 80,
  requireSmaller = true,
): Promise<CompressResult> {
  let bestBlob: Blob | null = null;
  let bestAnyBlob: Blob | null = null;

  for (const candidateQuality of buildJpegFallbackQualities(quality)) {
    const blob = await encodeCanvasAvif(file, candidateQuality);

    if (!bestAnyBlob || blob.size < bestAnyBlob.size) {
      bestAnyBlob = blob;
    }

    if (blob.size >= file.size) {
      continue;
    }

    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }
  }

  const resultBlob = requireSmaller ? bestBlob : bestBlob || bestAnyBlob;
  if (!resultBlob) {
    throw new Error("AVIF fallback could not produce a usable file");
  }

  return {
    blob: resultBlob,
    mime: "image/avif",
    ext: "avif",
    fileName: buildCompressedFileName(file.name, "avif"),
  };
}

async function getWebpCodec() {
  if (!cachedWebpCodec) {
    cachedWebpCodec = import("@jsquash/webp") as unknown as Promise<JsQuashWebpModule>;
  }

  return cachedWebpCodec;
}

type WebpEncodeOptions = NonNullable<Parameters<JsQuashWebpModule["encode"]>[1]>;

function dedupeWebpCandidates(optionsList: WebpEncodeOptions[]) {
  const seen = new Set<string>();
  return optionsList.filter((options) => {
    const key = JSON.stringify(options);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildWebpCandidates(
  file: File,
  imageData: ImageData,
  quality: number,
): WebpEncodeOptions[] {
  const normalizedQuality = clampQuality(quality);
  const transparent = hasTransparency(imageData);
  const isPngInput = file.type === "image/png";
  const isWebpInput = file.type === "image/webp";
  const sourceSizeMb = file.size / (1024 * 1024);
  const analysis = analyzeImageData(imageData);

  const sizeBias =
    sourceSizeMb >= 3
      ? 14
      : sourceSizeMb >= 2
        ? 10
        : sourceSizeMb >= 1
          ? 6
          : 2;

  const detailBias =
    analysis.edgeCoverage >= 0.28
      ? 0
      : analysis.edgeCoverage >= 0.18
        ? 3
        : 7;

  const flatBias =
    analysis.flatCoverage >= 0.45
      ? 8
      : analysis.flatCoverage >= 0.3
        ? 4
        : 0;

  const varianceBias =
    analysis.lumaVariance <= 0.018
      ? 6
      : analysis.lumaVariance <= 0.04
        ? 3
        : 0;

  const pixelBias =
    analysis.pixelCount >= 8_000_000
      ? 6
      : analysis.pixelCount >= 4_000_000
        ? 3
        : 0;

  const smallPngBias =
    isPngInput && file.size <= 220 * 1024
      ? 8
      : isPngInput && file.size <= 512 * 1024
        ? 4
        : 0;

  const webpRecompressBias =
    isWebpInput
      ? sourceSizeMb >= 2
        ? 14
        : sourceSizeMb >= 1
          ? 10
          : sourceSizeMb >= 0.5
            ? 7
            : 4
      : 0;

  const flatWebpBonus =
    isWebpInput && analysis.flatCoverage >= 0.4
      ? 6
      : isWebpInput && analysis.flatCoverage >= 0.28
        ? 3
        : 0;

  const aggressiveDrop =
    sizeBias +
    detailBias +
    flatBias +
    varianceBias +
    pixelBias +
    smallPngBias +
    webpRecompressBias +
    flatWebpBonus;
  const qualityBase = Math.max(18, normalizedQuality - aggressiveDrop);
  const qualityMid = Math.max(14, qualityBase - 8);
  const qualityLow = Math.max(10, qualityBase - 16);

  if (transparent) {
    const mostlyFlatTransparent =
      isPngInput &&
      analysis.alphaRatio > 0 &&
      analysis.flatCoverage >= 0.34 &&
      analysis.edgeCoverage <= 0.22;

    const candidates: WebpEncodeOptions[] = [
      {
        quality: Math.max(28, qualityBase),
        alpha_quality: Math.max(84, normalizedQuality),
        lossless: 0,
        method: 6,
        pass: 4,
        sns_strength: 24,
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
      {
        quality: Math.max(22, qualityMid),
        alpha_quality: Math.max(78, normalizedQuality - 4),
        lossless: 0,
        method: 6,
        pass: 5,
        sns_strength: 16,
        filter_strength: 8,
        filter_sharpness: 6,
        filter_type: 1,
        autofilter: 1,
        alpha_compression: 1,
        alpha_filtering: 2,
        exact: 0,
        preprocessing: 0,
        use_sharp_yuv: 1,
      },
    ];

    if (mostlyFlatTransparent) {
      candidates.push(
        {
          lossless: 1,
          method: 6,
          exact: 0,
          image_hint: 2,
        },
        {
          lossless: 1,
          method: 6,
          exact: 0,
          near_lossless: 72,
          image_hint: 2,
        },
        {
          lossless: 1,
          method: 6,
          exact: 0,
          near_lossless: 54,
          image_hint: 2,
        },
      );
    }

    return dedupeWebpCandidates(candidates);
  }

  const mostlyFlatOpaquePng =
    isPngInput &&
    analysis.flatCoverage >= 0.34 &&
    analysis.edgeCoverage <= 0.22 &&
    analysis.lumaVariance <= 0.05;

  const candidates: WebpEncodeOptions[] = [
    {
      quality: Math.max(isPngInput ? 24 : isWebpInput ? 26 : 34, qualityBase),
      lossless: 0,
      method: 6,
      pass: 4,
      sns_strength: isPngInput ? 14 : isWebpInput ? 42 : 68,
      filter_strength: isPngInput ? 12 : isWebpInput ? 18 : 28,
      filter_sharpness: isPngInput ? 6 : isWebpInput ? 5 : 4,
      filter_type: 1,
      autofilter: 1,
      preprocessing: 0,
      segments: 4,
      use_sharp_yuv: 1,
    },
    {
      quality: Math.max(isPngInput ? 18 : isWebpInput ? 20 : 28, qualityMid),
      lossless: 0,
      method: 6,
      pass: 5,
      sns_strength: isPngInput ? 6 : isWebpInput ? 24 : 48,
      filter_strength: isPngInput ? 6 : isWebpInput ? 10 : 20,
      filter_sharpness: isPngInput ? 7 : isWebpInput ? 6 : 5,
      filter_type: 1,
      autofilter: 1,
      preprocessing: 0,
      segments: 4,
      use_sharp_yuv: 1,
    },
    {
      quality: Math.max(isPngInput ? 12 : isWebpInput ? 14 : 22, qualityLow),
      lossless: 0,
      method: 6,
      pass: 6,
      sns_strength: isPngInput ? 0 : isWebpInput ? 8 : 28,
      filter_strength: isPngInput ? 4 : isWebpInput ? 6 : 14,
      filter_sharpness: 7,
      filter_type: 1,
      autofilter: 1,
      preprocessing: 0,
      segments: 4,
      use_sharp_yuv: 1,
    },
  ];

  if (isPngInput) {
    candidates.push({
      quality: Math.max(8, qualityLow - 10),
      lossless: 0,
      method: 6,
      pass: 6,
      sns_strength: 0,
      filter_strength: 2,
      filter_sharpness: 7,
      filter_type: 1,
      autofilter: 1,
      preprocessing: 0,
      segments: 4,
      use_sharp_yuv: 1,
    });
  }

  if (isWebpInput) {
    candidates.push(
      {
        quality: Math.max(12, qualityLow - 8),
        lossless: 0,
        method: 6,
        pass: 6,
        sns_strength: 4,
        filter_strength: 4,
        filter_sharpness: 7,
        filter_type: 1,
        autofilter: 1,
        preprocessing: 0,
        segments: 4,
        use_sharp_yuv: 1,
      },
      {
        quality: Math.max(8, qualityLow - 14),
        lossless: 0,
        method: 6,
        pass: 6,
        sns_strength: 0,
        filter_strength: 2,
        filter_sharpness: 7,
        filter_type: 1,
        autofilter: 1,
        preprocessing: 0,
        segments: 4,
        use_sharp_yuv: 1,
      },
    );
  }

  if (mostlyFlatOpaquePng) {
    candidates.push(
      {
        lossless: 1,
        method: 6,
        exact: 0,
        near_lossless: 72,
        image_hint: 2,
      },
      {
        lossless: 1,
        method: 6,
        exact: 0,
        near_lossless: 54,
        image_hint: 2,
      },
      {
        lossless: 1,
        method: 6,
        exact: 0,
        near_lossless: 36,
        image_hint: 2,
      },
    );
  }

  return dedupeWebpCandidates(candidates);
}

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

async function compressWithWebpCodec(
  file: File,
  quality = 80,
  requireSmaller = false,
): Promise<CompressResult> {
  const codec = await getWebpCodec();
  const imageData = await decodeFileToImageData(file);
  const webpCandidates = buildWebpCandidates(file, imageData, quality);

  const bytes = await encodeSmallestWebp(codec, imageData, webpCandidates);
  if (requireSmaller && bytes.byteLength >= file.size) {
    throw new Error("WebP output is not smaller than the source image");
  }

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
  targetFormat: Exclude<OutputFormat, "webp">,
  allowAlphaLoss = false,
): Promise<CompressResult> {
  const mod = await initWasm();
  if (!mod || typeof mod.compress_image !== "function") {
    throw new Error("WASM module failed to load correctly");
  }

  const buffer = await file.arrayBuffer();
  const input = new Uint8Array(buffer);
  const sourceFormat = sourceFormatFromFile(file);
  const requestedFormat = targetFormat ?? sourceFormat;
  const requireSmaller = requiresSmallerResult(requestedFormat, sourceFormat);
  try {
    const output =
      targetFormat &&
      allowAlphaLoss &&
      typeof mod.compress_image_to_format_with_options === "function"
        ? mod.compress_image_to_format_with_options(input, quality, targetFormat, true)
        : targetFormat && typeof mod.compress_image_to_format === "function"
          ? mod.compress_image_to_format(input, quality, targetFormat)
          : mod.compress_image(input, quality);

    const bytes = output.bytes as Uint8Array;
    const mime = output.mime as string;
    const ext = output.ext as string;

    if (requestedFormat === "jpeg" && bytes.byteLength >= file.size) {
      throw new Error("JPEG output is not smaller than the source image");
    }

    return {
      blob: new Blob([toBlobPart(bytes)], { type: mime }),
      mime,
      ext,
      fileName: buildCompressedFileName(file.name, ext),
    };
  } catch (error) {
    if (requestedFormat === "jpeg" && isJpegCompressionFailure(error)) {
      return compressJpegWithCanvasFallback(file, quality, requireSmaller);
    }
    if (shouldUsePngCanvasFallback(file, targetFormat, error)) {
      if (requireSmaller) {
        return compressPngWithCanvasFallback(file);
      }
      return {
        blob: await encodeCanvasPng(file),
        mime: "image/png",
        ext: "png",
        fileName: buildCompressedFileName(file.name, "png"),
      };
    }
    if (requestedFormat === "avif") {
      return compressAvifWithCanvasFallback(file, quality, requireSmaller);
    }

    throw error;
  }
}

export async function compressImageWithAlgorithms(
  file: File,
  quality = 80,
  targetFormat: OutputFormat,
  allowAlphaLoss = false,
): Promise<CompressResult> {
  const sourceFormat = sourceFormatFromFile(file);

  if (targetFormat === "webp") {
    const requireSmaller = requiresSmallerResult(targetFormat, sourceFormat);
    try {
      return await compressWithWebpCodec(file, quality, requireSmaller);
    } catch {
      return compressWebpWithCanvasFallback(file, quality, requireSmaller);
    }
  }

  return compressWithWasmCodec(file, quality, targetFormat, allowAlphaLoss);
}
