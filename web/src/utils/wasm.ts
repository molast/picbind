"use client";

import { compressImageWithAlgorithms } from "@/utils/compress-algorithms";
import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
import { initWasm } from "@/utils/wasm-runtime";

export type { OutputFormat };
export { buildCompressedFileName, initWasm };

export type ImageQualityComparison = {
  width: number;
  height: number;
  mse: number;
  rmse: number;
  psnr: number;
  ssim: number;
  msSsim: number;
  edgeRetention: number;
  blurLossPercent: number;
  overallQualityScore: number;
  originalEdgeEnergy: number;
  compressedEdgeEnergy: number;
  originalLaplacianVariance: number;
  compressedLaplacianVariance: number;
  meanDeltaE: number;
  p95DeltaE: number;
  p99DeltaE: number;
  p95MaskedDeltaE: number;
  p99MaskedDeltaE: number;
  p95LuminanceError: number;
  p95ChromaError: number;
  perceptualDistance: number;
  meanAlphaError: number;
  p95AlphaError: number;
  p99AlphaError: number;
};

export type ImageAnalysisMetrics = {
  width: number;
  height: number;
  pixelCount: number;
  sourceSizeBytes: number;
  sourceSizeMb: number;
  sourceFormat: string;
  hasAlpha: boolean;
  hasAlphaChannel: boolean;
  hasRealAlpha: boolean;
  alphaMin: number;
  alphaMax: number;
  alphaRatio: number;
  transparentPixelRatio: number;
  semiTransparentRatio: number;
  sampleStride: number;
  sampleCount: number;
  edgeStrength: number;
  brightnessVariance: number;
  colorComplexity: number;
  detailCoverage: number;
  flatCoverage: number;
  complexityScore: number;
  compressibilityScore: number;
};

export async function compressWithWasm(
  file: File,
  quality = 80,
  targetFormat: OutputFormat,
  allowAlphaLoss = false,
) {
  return compressImageWithAlgorithms(file, quality, targetFormat, allowAlphaLoss);
}

export async function compareImageQuality(
  original: Blob | File,
  compressed: Blob | File,
): Promise<ImageQualityComparison> {
  const mod = await initWasm();
  if (!mod || typeof mod.compare_image_quality !== "function") {
    throw new Error("WASM module does not expose compare_image_quality");
  }

  const originalBytes = new Uint8Array(await original.arrayBuffer());
  const compressedBytes = new Uint8Array(await compressed.arrayBuffer());
  return mod.compare_image_quality(originalBytes, compressedBytes) as ImageQualityComparison;
}

export async function calculateImageQualityScore(
  original: Blob | File,
  assessed: Blob | File,
): Promise<ImageQualityComparison> {
  const mod = await initWasm();
  if (!mod || typeof mod.calculate_image_quality_score !== "function") {
    throw new Error("WASM module does not expose calculate_image_quality_score");
  }

  const originalBytes = new Uint8Array(await original.arrayBuffer());
  const assessedBytes = new Uint8Array(await assessed.arrayBuffer());
  return mod.calculate_image_quality_score(originalBytes, assessedBytes) as ImageQualityComparison;
}

export async function analyzeImageMetrics(
  input: Blob | File,
): Promise<ImageAnalysisMetrics> {
  const mod = await initWasm();
  if (!mod || typeof mod.analyze_image_metrics !== "function") {
    throw new Error("WASM module does not expose analyze_image_metrics");
  }

  const bytes = new Uint8Array(await input.arrayBuffer());
  return mod.analyze_image_metrics(bytes) as ImageAnalysisMetrics;
}
