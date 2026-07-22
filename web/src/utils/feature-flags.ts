"use client";

function isEnabled(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true";
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const IMAGE_COMPARE_ENABLED = isEnabled(
  process.env.NEXT_PUBLIC_IMAGE_COMPARE_ENABLED,
);

export const IMAGE_COMPARE_SELECTION_ENABLED =
  IMAGE_COMPARE_ENABLED &&
  isEnabled(process.env.NEXT_PUBLIC_IMAGE_COMPARE_SELECTION_ENABLED);

export const COMPRESSION_QUALITY_METRICS_ENABLED = isEnabled(
  process.env.NEXT_PUBLIC_COMPRESSION_QUALITY_METRICS_ENABLED,
);

export const BUTTERAUGLI_ENABLED = isEnabled(
  process.env.NEXT_PUBLIC_BUTTERAUGLI_ENABLED,
);

export const BUTTERAUGLI_TARGET_SCORE = positiveNumber(
  process.env.NEXT_PUBLIC_BUTTERAUGLI_TARGET_SCORE,
  1.0,
);
