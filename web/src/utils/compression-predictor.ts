"use client";

import type { OutputFormat } from "@/utils/compress-shared";
import { sourceFormatFromFile } from "@/utils/compression-engine";
import { initWasm } from "@/utils/wasm-runtime";

export type FormatCompressionPrediction = {
  format: OutputFormat;
  estimatedSizeBytes: number;
  estimatedVisualQuality: number;
  available: boolean;
};

export type CompressionPrediction = {
  sourceFormat: OutputFormat;
  recommendedFormat: OutputFormat;
  shouldSwitchEncoder: boolean;
  predictions: FormatCompressionPrediction[];
};

const OUTPUT_FORMATS = new Set<OutputFormat>([
  "jpeg",
  "png",
  "webp",
  "avif",
]);

function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === "string" && OUTPUT_FORMATS.has(value as OutputFormat);
}

async function decodeFileToRgba(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    return {
      bytes: new Uint8Array(
        context.getImageData(0, 0, bitmap.width, bitmap.height).data.buffer,
      ),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

function normalizePrediction(
  value: unknown,
  fallbackFormat: OutputFormat,
): CompressionPrediction {
  const prediction = value as Partial<CompressionPrediction> | null;
  const recommendedFormat = isOutputFormat(prediction?.recommendedFormat)
    ? prediction.recommendedFormat
    : fallbackFormat;
  const predictions = Array.isArray(prediction?.predictions)
    ? prediction.predictions.filter(
        (item): item is FormatCompressionPrediction =>
          isOutputFormat(item?.format) &&
          typeof item.estimatedSizeBytes === "number" &&
          typeof item.estimatedVisualQuality === "number" &&
          typeof item.available === "boolean",
      )
    : [];

  return {
    sourceFormat: isOutputFormat(prediction?.sourceFormat)
      ? prediction.sourceFormat
      : fallbackFormat,
    recommendedFormat,
    shouldSwitchEncoder: Boolean(prediction?.shouldSwitchEncoder),
    predictions,
  };
}

export async function predictCompression(
  file: File,
): Promise<CompressionPrediction> {
  const sourceFormat = sourceFormatFromFile(file);
  const mod = await initWasm();

  if (sourceFormat === "avif") {
    if (typeof mod?.predict_compression_rgba !== "function") {
      throw new Error("WASM module does not expose RGBA compression prediction");
    }
    const rgba = await decodeFileToRgba(file);
    return normalizePrediction(
      mod.predict_compression_rgba(
        rgba.bytes,
        rgba.width,
        rgba.height,
        file.size,
        sourceFormat,
      ),
      sourceFormat,
    );
  }

  if (typeof mod?.predict_compression !== "function") {
    throw new Error("WASM module does not expose compression prediction");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return normalizePrediction(mod.predict_compression(bytes), sourceFormat);
}

export async function predictRecommendedFormat(file: File) {
  const sourceFormat = sourceFormatFromFile(file);
  try {
    return (await predictCompression(file)).recommendedFormat;
  } catch {
    return sourceFormat;
  }
}
