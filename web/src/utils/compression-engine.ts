"use client";

import type { OutputFormat } from "@/utils/compress-shared";

export type CompressResult = {
  blob: Blob;
  mime: string;
  ext: string;
  fileName: string;
};

export type CompressionEncoderId = "wasm" | "libwebp" | "libavif";
export type PerceptualEvaluatorId = "native" | "butteraugli" | "none";

export type CompressionFeatures = {
  sourceFormat: OutputFormat;
  targetFormat: OutputFormat;
  sourceSizeBytes: number;
  allowAlphaLoss: boolean;
};

export type CompressionAnalysis = CompressionFeatures & {
  sameFormat: boolean;
  requiresSmallerResult: boolean;
  preserveTransparency: boolean;
};

export type CompressionPlan = CompressionAnalysis & {
  encoder: CompressionEncoderId;
  evaluator: PerceptualEvaluatorId;
  qualityCandidates: number[];
};

export type CompressionEncoder = (
  quality: number,
) => Promise<CompressResult>;

export type CompressionEncoderRegistry = Record<
  CompressionEncoderId,
  CompressionEncoder
>;

export type PerceptualEvaluator = {
  score(candidate: Blob): Promise<number>;
  dispose(): void;
};

function clampQuality(quality: number) {
  return Math.max(0, Math.min(quality, 100));
}

export function sourceFormatFromFile(file: File): OutputFormat {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/avif" || extension === "avif") return "avif";
  return "jpeg";
}

// Pixel-level features are extracted by the WASM feature module while it owns
// the decoded image. This source pass provides the format and policy context
// needed by the cross-codec planner without creating another RGBA allocation.
export function extractCompressionFeatures(
  file: File,
  targetFormat: OutputFormat,
  allowAlphaLoss: boolean,
): CompressionFeatures {
  return {
    sourceFormat: sourceFormatFromFile(file),
    targetFormat,
    sourceSizeBytes: file.size,
    allowAlphaLoss,
  };
}

export function analyzeCompressionFeatures(
  features: CompressionFeatures,
): CompressionAnalysis {
  const sameFormat = features.sourceFormat === features.targetFormat;
  return {
    ...features,
    sameFormat,
    requiresSmallerResult: sameFormat,
    preserveTransparency: features.targetFormat !== "jpeg",
  };
}

function evaluatorForFormat(
  targetFormat: OutputFormat,
  butteraugliEnabled: boolean,
): PerceptualEvaluatorId {
  if (butteraugliEnabled && (targetFormat === "jpeg" || targetFormat === "png")) {
    return "butteraugli";
  }
  if (targetFormat === "webp" || targetFormat === "avif") {
    return "native";
  }
  return "none";
}

function qualityCandidates(quality: number, evaluator: PerceptualEvaluatorId) {
  const initial = clampQuality(quality);
  if (evaluator !== "butteraugli") return [initial];
  return Array.from(
    new Set([initial, Math.min(100, initial + 10), Math.min(100, initial + 20)]),
  );
}

export function createCompressionPlan(
  analysis: CompressionAnalysis,
  quality: number,
  butteraugliEnabled: boolean,
): CompressionPlan {
  const encoder: CompressionEncoderId =
    analysis.targetFormat === "avif"
      ? "libavif"
      : analysis.targetFormat === "webp"
        ? "libwebp"
        : "wasm";
  const evaluator = evaluatorForFormat(
    analysis.targetFormat,
    butteraugliEnabled,
  );
  return {
    ...analysis,
    encoder,
    evaluator,
    qualityCandidates: qualityCandidates(quality, evaluator),
  };
}

export function selectCompressionEncoder(
  plan: CompressionPlan,
  registry: CompressionEncoderRegistry,
) {
  return registry[plan.encoder];
}

export async function executeCompressionPlan(
  file: File,
  plan: CompressionPlan,
  encoder: CompressionEncoder,
  perceptualEvaluator: PerceptualEvaluator | null,
  targetScore: number,
): Promise<CompressResult> {
  if (!perceptualEvaluator) {
    return encoder(plan.qualityCandidates[0]);
  }

  let closestResult: CompressResult | null = null;
  let closestScore = Number.POSITIVE_INFINITY;
  let originalResult: CompressResult | null = null;
  try {
    for (const candidateQuality of plan.qualityCandidates) {
      const result = await encoder(candidateQuality);
      if (result.blob === file) {
        originalResult = result;
        continue;
      }
      const score = await perceptualEvaluator.score(result.blob);
      if (score < closestScore) {
        closestResult = result;
        closestScore = score;
      }
      if (score <= targetScore) return result;
    }
  } finally {
    perceptualEvaluator.dispose();
  }

  if (closestResult) return closestResult;
  if (originalResult || plan.sameFormat) {
    if (originalResult) return originalResult;
    throw new Error(`${plan.targetFormat.toUpperCase()} returned no smaller candidate`);
  }
  throw new Error(
    `${plan.targetFormat.toUpperCase()} compression produced no candidate`,
  );
}
