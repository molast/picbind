import type { OutputFormat } from "@/utils/compress-shared";

export const MIN_COMPRESSION_GAIN = 0.5;
export const MAX_COMPRESSION_GAIN = 2.0;
export const DEFAULT_COMPRESSION_GAIN = 1.0;

function parseCompressionGain(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(MIN_COMPRESSION_GAIN, Math.min(MAX_COMPRESSION_GAIN, parsed))
    : DEFAULT_COMPRESSION_GAIN;
}

const COMPRESSION_GAINS: Record<OutputFormat, number> = {
  jpeg: parseCompressionGain(process.env.NEXT_PUBLIC_PCE_JPEG_K),
  png: parseCompressionGain(process.env.NEXT_PUBLIC_PCE_PNG_K),
  webp: parseCompressionGain(process.env.NEXT_PUBLIC_PCE_WEBP_K),
  avif: parseCompressionGain(process.env.NEXT_PUBLIC_PCE_AVIF_K),
};

export function compressionGainForFormat(format: OutputFormat) {
  return COMPRESSION_GAINS[format];
}

export function amplifyQualityLoss(
  quality: number,
  gain: number,
  floor = 0,
) {
  const loss = (100 - quality) * gain;
  return Math.max(floor, Math.min(100, Math.round(100 - loss)));
}

export function amplifyMaxError(value: number, gain: number) {
  return value * gain;
}

export function amplifyMinSimilarity(value: number, gain: number) {
  return Math.max(0, Math.min(1, 1 - (1 - value) * gain));
}
