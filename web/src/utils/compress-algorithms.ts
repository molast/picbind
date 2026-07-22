"use client";

import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
import { createButteraugliEvaluator } from "@/utils/butteraugli";
import {
  analyzeCompressionFeatures,
  createCompressionPlan,
  executeCompressionPlan,
  extractCompressionFeatures,
  selectCompressionEncoder,
  sourceFormatFromFile,
  type CompressResult,
  type PerceptualEvaluator,
} from "@/utils/compression-engine";
import {
  BUTTERAUGLI_ENABLED,
  BUTTERAUGLI_TARGET_SCORE,
} from "@/utils/feature-flags";
import { encodeWithLibavif } from "@/utils/libavif-codec";
import { initWasm } from "@/utils/wasm-runtime";

export type { CompressResult } from "@/utils/compression-engine";

type WebpEncodeOptions = {
  quality?: number;
  alpha_quality?: number;
  lossless?: 0 | 1;
  method?: number;
  pass?: number;
  exact?: number;
  alpha_compression?: number;
  alpha_filtering?: number;
  autofilter?: number;
  use_sharp_yuv?: number;
};

type JsQuashWebpModule = {
  encode(data: ImageData, options?: WebpEncodeOptions): Promise<ArrayBuffer>;
};

type PerceptualMetrics = {
  ssim: number;
  msSsim: number;
  blurLossPercent: number;
  overallQualityScore: number;
  p99DeltaE: number;
  p99MaskedDeltaE: number;
  p95LuminanceError: number;
  p95ChromaError: number;
  perceptualDistance: number;
  p95AlphaError: number;
  p99AlphaError: number;
};

type WebpCandidate = {
  bytes: Uint8Array;
  metrics: PerceptualMetrics | null;
  passesGuardrail: boolean;
};

type AvifEncodingPlan = {
  qualityCandidates: number[];
  speed: number;
  bitDepth: 8;
  subsample: number;
  tune: number;
  chromaDeltaQ: boolean;
  sharpness: number;
  enableSharpYuv: boolean;
  tileColsLog2: number;
  tileRowsLog2: number;
  alphaQualityFloor: number;
  minMsSsim: number;
  maxBlurLossPercent: number;
  maxPerceptualDistance: number;
  maxP99DeltaE: number;
  maxP95LuminanceError: number;
  maxP95ChromaError: number;
  maxP95AlphaError: number;
  maxP99AlphaError: number;
};

let cachedWebpCodec: Promise<JsQuashWebpModule> | null = null;

function toBlobPart(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function clampQuality(quality: number) {
  return Math.max(0, Math.min(quality, 100));
}

function extForFormat(format: OutputFormat) {
  if (format === "jpeg") {
    return "jpg";
  }
  return format;
}

function mimeForFormat(format: OutputFormat) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function originalFileResult(file: File, format: OutputFormat): CompressResult {
  return {
    blob: file,
    mime: file.type || mimeForFormat(format),
    ext: extForFormat(format),
    fileName: file.name,
  };
}

function keepOriginalWhenNotSmaller(
  file: File,
  result: CompressResult,
  requestedFormat: OutputFormat,
  sourceFormat: OutputFormat,
) {
  return requestedFormat === sourceFormat && result.blob.size >= file.size
    ? originalFileResult(file, sourceFormat)
    : result;
}

function requiresSmallerResult(
  requestedFormat: OutputFormat,
  sourceFormat: OutputFormat,
) {
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

async function decodeFileToImageData(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

async function decodeImageToRgba(image: Blob) {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      bytes: new Uint8Array(
        imageData.data.buffer,
        imageData.data.byteOffset,
        imageData.data.byteLength,
      ),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

function passesPerceptualAvifGuardrail(
  metrics: PerceptualMetrics,
  plan: AvifEncodingPlan,
) {
  return (
    metrics.msSsim >= plan.minMsSsim &&
    metrics.blurLossPercent <= plan.maxBlurLossPercent &&
    metrics.perceptualDistance <= plan.maxPerceptualDistance &&
    metrics.p99MaskedDeltaE <= plan.maxP99DeltaE &&
    metrics.p95LuminanceError <= plan.maxP95LuminanceError &&
    metrics.p95ChromaError <= plan.maxP95ChromaError &&
    metrics.p95AlphaError <= plan.maxP95AlphaError &&
    metrics.p99AlphaError <= plan.maxP99AlphaError
  );
}

function hasNonOpaqueAlpha(rgba: Uint8Array) {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] !== 255) {
      return true;
    }
  }
  return false;
}

async function compressPerceptualAvif(
  file: File,
  quality: number,
): Promise<CompressResult> {
  const mod = await initWasm();
  if (
    typeof mod?.create_avif_encoding_plan_rgba !== "function" ||
    typeof mod?.compare_avif_candidate_rgba !== "function"
  ) {
    throw new Error("WASM module does not expose adaptive AVIF encoding");
  }

  const sourceFormat = sourceFormatFromFile(file);
  const source = await decodeImageToRgba(file);
  const plan = mod.create_avif_encoding_plan_rgba(
    source.bytes,
    source.width,
    source.height,
    clampQuality(quality),
    file.size,
  ) as AvifEncodingPlan;
  const pixelCount = source.width * source.height;
  const candidateQualities =
    pixelCount >= 12_000_000
      ? plan.qualityCandidates.filter((candidate) => candidate < 100).slice(0, 2)
      : plan.qualityCandidates;
  const sourceHasAlpha =
    sourceFormat !== "jpeg" &&
    hasNonOpaqueAlpha(source.bytes);
  let fallbackResult: CompressResult | null = null;

  for (const candidateQuality of candidateQualities) {
    const alphaQuality = sourceHasAlpha
      ? Math.max(candidateQuality, plan.alphaQualityFloor)
      : -1;
    const imageData = {
      data: new Uint8ClampedArray(
        source.bytes.buffer,
        source.bytes.byteOffset,
        source.bytes.byteLength,
      ),
      width: source.width,
      height: source.height,
    } as ImageData;
    const encoded = await encodeWithLibavif(imageData, {
      quality: candidateQuality,
      qualityAlpha: alphaQuality,
      denoiseLevel: 0,
      tileColsLog2: plan.tileColsLog2,
      tileRowsLog2: plan.tileRowsLog2,
      speed: plan.speed,
      subsample: plan.subsample,
      chromaDeltaQ: plan.chromaDeltaQ,
      sharpness: plan.sharpness,
      tune: plan.tune,
      enableSharpYUV: plan.enableSharpYuv,
      bitDepth: plan.bitDepth,
      lossless: candidateQuality === 100,
    });

    if (sourceFormat === "avif" && encoded.byteLength >= file.size) {
      continue;
    }

    const candidateBlob = new Blob([toBlobPart(encoded)], { type: "image/avif" });
    const candidate = await decodeImageToRgba(candidateBlob);
    if (candidate.width !== source.width || candidate.height !== source.height) {
      continue;
    }
    const metrics = mod.compare_avif_candidate_rgba(
      source.bytes,
      candidate.bytes,
      source.width,
      source.height,
    ) as PerceptualMetrics;

    fallbackResult = {
      blob: candidateBlob,
      mime: "image/avif",
      ext: "avif",
      fileName: buildCompressedFileName(file.name, "avif"),
    };

    if (passesPerceptualAvifGuardrail(metrics, plan)) {
      return fallbackResult;
    }
  }

  if (sourceFormat === "avif") {
    return originalFileResult(file, sourceFormat);
  }
  if (fallbackResult) {
    return fallbackResult;
  }
  throw new Error("AVIF compression could not satisfy perceptual quality guardrails");
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

  return /unreachable|memory|allocation|JPEG encode failed|not supported|avif/i.test(
    message,
  );
}

function shouldUsePngCanvasFallback(
  targetFormat?: OutputFormat,
  error?: unknown,
) {
  if (targetFormat !== "png") {
    return false;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");

  return /unreachable|memory|allocation|PNG|quantiz|not supported|avif/i.test(
    message,
  );
}

async function getWebpCodec() {
  if (!cachedWebpCodec) {
    cachedWebpCodec = import("@jsquash/webp") as unknown as Promise<JsQuashWebpModule>;
  }
  return cachedWebpCodec;
}

function perceptualWebpQualities(quality: number, sameFormat: boolean) {
  const normalized = clampQuality(quality);
  const candidates = sameFormat
    ? [Math.max(68, normalized - 12), Math.max(75, normalized - 5)]
    : [Math.max(72, normalized - 8), Math.max(80, normalized)];
  return Array.from(new Set(candidates.map(clampQuality))).sort((a, b) => a - b);
}

function passesPerceptualWebpGuardrail(metrics: PerceptualMetrics) {
  return (
    metrics.ssim >= 0.95 &&
    metrics.msSsim >= 0.974 &&
    metrics.blurLossPercent <= 3.5 &&
    metrics.overallQualityScore >= 96
  );
}

async function compressPerceptualWebp(
  file: File,
  quality: number,
): Promise<CompressResult> {
  const [codec, imageData, mod, sourceBuffer] = await Promise.all([
    getWebpCodec(),
    decodeFileToImageData(file),
    initWasm(),
    file.arrayBuffer(),
  ]);
  const source = new Uint8Array(sourceBuffer);
  const sourceFormat = sourceFormatFromFile(file);
  const sameFormat = sourceFormat === "webp";
  const candidates: WebpCandidate[] = [];

  for (const candidateQuality of perceptualWebpQualities(quality, sameFormat)) {
    try {
      const encoded = new Uint8Array(
        await codec.encode(imageData, {
          quality: candidateQuality,
          alpha_quality: 100,
          lossless: 0,
          method: 4,
          pass: 1,
          exact: 1,
          alpha_compression: 1,
          alpha_filtering: 2,
          autofilter: 1,
          use_sharp_yuv: 1,
        }),
      );

      let passes = imageData.width < 3 || imageData.height < 3;
      let metrics: PerceptualMetrics | null = null;
      if (
        !passes &&
        typeof mod?.compare_image_quality_for_guardrails === "function"
      ) {
        try {
          metrics = mod.compare_image_quality_for_guardrails(
            source,
            encoded,
          ) as PerceptualMetrics;
          passes = passesPerceptualWebpGuardrail(metrics);
        } catch {
          // Some source decoders (notably AVIF) may be unavailable in the
          // metrics module. The successfully encoded WebP is still valid.
        }
      }
      candidates.push({ bytes: encoded, metrics, passesGuardrail: passes });
    } catch {
      // A failed candidate must not discard other successful lossy encodes.
    }
  }

  const passingCandidates = candidates.filter(
    (candidate) => candidate.passesGuardrail,
  );
  const selected =
    passingCandidates.sort((left, right) =>
      left.bytes.byteLength - right.bytes.byteLength,
    )[0] ??
    candidates.sort(
      (left, right) => left.bytes.byteLength - right.bytes.byteLength,
    )[0];

  if (!selected) {
    if (sameFormat) return originalFileResult(file, sourceFormat);
    throw new Error("WebP compression produced no lossy candidate");
  }

  return keepOriginalWhenNotSmaller(file, {
    blob: new Blob([toBlobPart(selected.bytes)], { type: "image/webp" }),
    mime: "image/webp",
    ext: "webp",
    fileName: buildCompressedFileName(file.name, "webp"),
  }, "webp", sourceFormat);
}

async function compressWithWasmCodec(
  file: File,
  quality = 80,
  targetFormat: OutputFormat,
  allowAlphaLoss = false,
): Promise<CompressResult> {
  const mod = await initWasm();
  if (!mod || typeof mod.compress_image !== "function") {
    throw new Error("WASM module failed to load correctly");
  }

  const sourceFormat = sourceFormatFromFile(file);
  const requestedFormat = targetFormat ?? sourceFormat;
  const requireSmaller = requiresSmallerResult(requestedFormat, sourceFormat);

  if (
    sourceFormat === "avif" &&
    requestedFormat === "png" &&
    typeof mod.compress_rgba_to_png === "function"
  ) {
    try {
      const imageData = await decodeFileToImageData(file);
      const output = mod.compress_rgba_to_png(
        imageData.data,
        imageData.width,
        imageData.height,
        quality,
        file.size,
      );
      const bytes = output.bytes as Uint8Array;
      const mime = output.mime as string;
      const ext = output.ext as string;
      return {
        blob: new Blob([toBlobPart(bytes)], { type: mime }),
        mime,
        ext,
        fileName: buildCompressedFileName(file.name, ext),
      };
    } catch (error) {
      if (!shouldUsePngCanvasFallback(requestedFormat, error)) throw error;
      return {
        blob: await encodeCanvasPng(file),
        mime: "image/png",
        ext: "png",
        fileName: buildCompressedFileName(file.name, "png"),
      };
    }
  }

  const buffer = await file.arrayBuffer();
  const input = new Uint8Array(buffer);
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

    return keepOriginalWhenNotSmaller(file, {
      blob: new Blob([toBlobPart(bytes)], { type: mime }),
      mime,
      ext,
      fileName: buildCompressedFileName(file.name, ext),
    }, requestedFormat, sourceFormat);
  } catch (error) {
    try {
      if (requestedFormat === "jpeg" && isJpegCompressionFailure(error)) {
        const result = await compressJpegWithCanvasFallback(
          file,
          quality,
          requireSmaller,
        );
        return keepOriginalWhenNotSmaller(
          file,
          result,
          requestedFormat,
          sourceFormat,
        );
      }
      if (shouldUsePngCanvasFallback(targetFormat, error)) {
        const result = requireSmaller
          ? await compressPngWithCanvasFallback(file)
          : {
              blob: await encodeCanvasPng(file),
              mime: "image/png",
              ext: "png",
              fileName: buildCompressedFileName(file.name, "png"),
            };
        return keepOriginalWhenNotSmaller(
          file,
          result,
          requestedFormat,
          sourceFormat,
        );
      }
    } catch (fallbackError) {
      if (requestedFormat === sourceFormat) {
        return originalFileResult(file, sourceFormat);
      }
      throw fallbackError;
    }

    if (requestedFormat === sourceFormat) {
      return originalFileResult(file, sourceFormat);
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
  const features = extractCompressionFeatures(
    file,
    targetFormat,
    allowAlphaLoss,
  );
  const analysis = analyzeCompressionFeatures(features);
  const plan = createCompressionPlan(analysis, quality, BUTTERAUGLI_ENABLED);
  const encoder = selectCompressionEncoder(plan, {
    wasm: (candidateQuality) =>
      compressWithWasmCodec(
        file,
        candidateQuality,
        targetFormat,
        allowAlphaLoss,
      ),
    libwebp: (candidateQuality) =>
      compressPerceptualWebp(file, candidateQuality),
    libavif: async (candidateQuality) => {
      try {
        return await compressPerceptualAvif(file, candidateQuality);
      } catch (error) {
        if (plan.sameFormat) return originalFileResult(file, "avif");
        throw error;
      }
    },
  });

  let evaluator: PerceptualEvaluator | null = null;
  if (plan.evaluator === "butteraugli") {
    const source = await decodeImageToRgba(file);
    const butteraugli = await createButteraugliEvaluator(source);
    evaluator = {
      async score(candidateBlob) {
        const candidate = await decodeImageToRgba(candidateBlob);
        return (await butteraugli.compare(candidate)).score;
      },
      dispose() {
        butteraugli.free();
      },
    };
  }

  return executeCompressionPlan(
    file,
    plan,
    encoder,
    evaluator,
    BUTTERAUGLI_TARGET_SCORE,
  );
}
