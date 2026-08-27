import type { ImageOutputFormat, ImageQualityComparison } from "@picbind/shared";
import type { OutputFormat } from "@/utils/compress-shared";

export type HomeOutputFormat = ImageOutputFormat;

export type VariantStatus = "queued" | "processing" | "done" | "error";

export type OutputVariant = {
  id: string;
  format: HomeOutputFormat;
  allowAlphaLoss?: boolean;
  automatic?: boolean;
  outputUrl?: string;
  outputName?: string;
  outputExt?: string;
  outputSize?: number;
  percent?: number;
  progress: number;
  status: VariantStatus;
  errorMessage?: string;
  qualityMetrics?: ImageQualityComparison;
};

export type MetricsRequestState = {
  status: "loading" | "done";
  logged?: boolean;
};

export type HomeItem = {
  id: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;
  sourceFormat: OutputFormat;
  previewUrl: string;
  variants: OutputVariant[];
  updatedAt: number;
  rejection?: "file-too-large";
};

export type CompareAsset = {
  id: string;
  itemId: string;
  variantId?: string;
  label: string;
  src: string;
  size: number;
  format: string;
  kind: "original" | "output";
};

export type HomeCompareCopy = {
  kicker: string;
  title: string;
  desc: string;
  original: string;
  compressed: string;
  hintLeft: string;
  hintRight: string;
};

export function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) {
    const kiloBytes = size / 1024;
    return `${kiloBytes.toFixed(kiloBytes < 100 ? 1 : 0)} KB`;
  }
  return `${size} B`;
}

export const extToBadge = (ext?: string) => (ext || "img").toUpperCase();

export function getActiveVariant(item: HomeItem) {
  return (
    item.variants.find((variant) => variant.status === "processing") ||
    item.variants.find((variant) => variant.status === "queued")
  );
}

export function getBestDoneVariant(item: HomeItem) {
  return item.variants
    .filter(
      (variant) =>
        variant.status === "done" && typeof variant.outputSize === "number",
    )
    .sort((left, right) => (left.outputSize || 0) - (right.outputSize || 0))[0];
}

export function getDoneVariants(item: HomeItem) {
  return item.variants.filter(
    (variant) =>
      variant.status === "done" && typeof variant.outputSize === "number",
  );
}

export function isTransparencyBlocked(errorMessage?: string) {
  return Boolean(errorMessage && /transparen/i.test(errorMessage));
}

export function formatDeltaPercent(percent?: number) {
  if (typeof percent !== "number") return "0%";
  const rounded =
    Math.abs(percent) >= 10
      ? Math.round(percent)
      : Math.abs(percent) >= 1
        ? Math.round(percent * 10) / 10
        : Math.round(percent * 100) / 100;
  const text = Number.isInteger(rounded)
    ? `${rounded}`
    : Math.abs(rounded) >= 1
      ? rounded.toFixed(1)
      : rounded.toFixed(2);
  return `${rounded > 0 ? "+" : ""}${text}%`;
}

export function formatMetricPercent(value?: number, digits = 1) {
  return typeof value === "number" && !Number.isNaN(value)
    ? `${value.toFixed(digits)}%`
    : "--";
}

export function formatMetricRatio(value?: number, digits = 3) {
  return typeof value === "number" && !Number.isNaN(value)
    ? value.toFixed(digits)
    : "--";
}
