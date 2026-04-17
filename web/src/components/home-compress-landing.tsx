"use client";

import React from "react";
import Link from "next/link";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import {
  getHomeCompressLandingCopy,
  getLang,
  setLang as persistLang,
  type Lang,
} from "@/locales";
import {
  flushCompressedCountNow,
  loadTotalCompressedCount,
  reportCompressionResult,
  reportCompressedCount,
} from "@/utils/compression-metrics";
import { reportPageViewOnce } from "@/utils/page-view";
import { buildZipEntryFileName } from "@/utils/compress-shared";
import SystemManager from "@/utils/System";
import { createUuid } from "@/utils/uuid";
import {
  compressWithWasmWorker,
  terminateCompressionWorker,
} from "@/utils/wasm-worker";
import { analyzeCompressionInWorker } from "@/utils/analysis-worker";
import {
  type ImageQualityComparison,
  type OutputFormat,
} from "@/utils/wasm";

const MAX_FILES = 20;
const MAX_CONCURRENT_COMPRESSIONS = 2;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const COMPARE_IMAGE_SOURCE_PATH = "/images/compare-original.png";
const COMPARE_IMAGE_SOURCE_NAME = "compare-original.png";
const IS_DEV = process.env.NODE_ENV !== "production";
const HEAVY_JPEG_RECOMPRESS_SIZE_BYTES = 1.5 * 1024 * 1024;

type VariantStatus = "queued" | "processing" | "done" | "error";

type OutputVariant = {
  id: string;
  format: OutputFormat;
  allowAlphaLoss?: boolean;
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

type MetricsRequestState = {
  status: "loading" | "done";
  logged?: boolean;
};

type HomeItem = {
  id: string;
  file: File;
  previewUrl: string;
  variants: OutputVariant[];
  updatedAt: number;
};

const formatSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    const kiloBytes = size / 1024;
    const digits = kiloBytes < 100 ? 1 : 0;
    return `${kiloBytes.toFixed(digits)} KB`;
  }
  return `${size} B`;
};

const extToBadge = (ext?: string) => (ext || "img").toUpperCase();

function normalizeSourceFormat(file: File): OutputFormat {
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  return "jpeg";
}

function normalizeOutputFormat(ext?: string): OutputFormat {
  if (ext === "png") {
    return "png";
  }
  if (ext === "webp") {
    return "webp";
  }
  if (ext === "avif") {
    return "avif";
  }
  return "jpeg";
}

function createVariant(format: OutputFormat): OutputVariant {
  return {
    id: `${format}-${createUuid()}`,
    format,
    progress: 0,
    status: "queued",
  };
}

function getDesiredFormats(file: File, selectedFormats: OutputFormat[]) {
  if (selectedFormats.length > 0) {
    return Array.from(new Set(selectedFormats));
  }

  return [normalizeSourceFormat(file)];
}

function ensureVariants(item: HomeItem, selectedFormats: OutputFormat[]) {
  if (!selectedFormats.length) {
    return item;
  }

  const wantedFormats = getDesiredFormats(item.file, selectedFormats);
  const existingFormats = new Set(
    item.variants.map((variant) => variant.format),
  );
  const missingVariants = wantedFormats
    .filter((format) => !existingFormats.has(format))
    .map((format) => createVariant(format));

  if (!missingVariants.length) {
    return item;
  }

  return {
    ...item,
    variants: [...item.variants, ...missingVariants],
  };
}

function createItem(file: File, selectedFormats: OutputFormat[]): HomeItem {
  const now = Date.now();
  const variants = selectedFormats.length
    ? ensureVariants(
        {
          id: "",
          file,
          previewUrl: "",
          updatedAt: now,
          variants: [],
        },
        selectedFormats,
      ).variants
    : [createVariant(normalizeSourceFormat(file))];

  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${createUuid()}`,
    file,
    previewUrl: URL.createObjectURL(file),
    updatedAt: now,
    variants,
  };
}

function getActiveVariant(item: HomeItem) {
  return (
    item.variants.find((variant) => variant.status === "processing") ||
    item.variants.find((variant) => variant.status === "queued")
  );
}

function isHeavyJpegRecompress(item: HomeItem, variant: OutputVariant) {
  return (
    normalizeSourceFormat(item.file) === "jpeg" &&
    variant.format === "jpeg" &&
    item.file.size >= HEAVY_JPEG_RECOMPRESS_SIZE_BYTES
  );
}

function getBestDoneVariant(item: HomeItem) {
  return item.variants
    .filter(
      (variant) =>
        variant.status === "done" && typeof variant.outputSize === "number",
    )
    .sort((left, right) => (left.outputSize || 0) - (right.outputSize || 0))[0];
}

function getDoneVariants(item: HomeItem) {
  return item.variants.filter(
    (variant) =>
      variant.status === "done" && typeof variant.outputSize === "number",
  );
}

function isTransparencyBlocked(errorMessage?: string) {
  return Boolean(errorMessage && /transparen/i.test(errorMessage));
}

function formatDeltaPercent(percent?: number) {
  if (typeof percent !== "number") {
    return "0%";
  }
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
  if (rounded > 0) {
    return `+${text}%`;
  }
  return `${text}%`;
}

function formatMetricPercent(value?: number, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(digits)}%`;
}

function formatMetricRatio(value?: number, digits = 3) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function logCompressionFailure(
  sourceFile: File,
  format: OutputFormat,
  error: unknown,
) {
  if (!IS_DEV) {
    return;
  }

  console.groupCollapsed(
    `[NanoImg][${format.toUpperCase()}][FAILED] ${sourceFile.name}`,
  );
  console.log("Source file", {
    name: sourceFile.name,
    type: sourceFile.type,
    size: sourceFile.size,
    lastModified: sourceFile.lastModified,
  });
  console.error("Compression error", error);
  console.groupEnd();
}

async function logCompressionAnalysis(
  sourceFile: File,
  format: OutputFormat,
  sourceMetrics: unknown,
  compressedMetrics: unknown,
  compareMetrics: ImageQualityComparison,
) {
  if (!IS_DEV) {
    return;
  }

  try {
    const label = `[NanoImg][${format.toUpperCase()}] ${sourceFile.name}`;
    console.groupCollapsed(label);
    console.log("Source metrics", sourceMetrics);
    console.log("Compressed metrics", compressedMetrics);
    console.log("Quality comparison", compareMetrics);
    console.groupEnd();
  } catch (error) {
    console.warn(
      `[NanoImg][${format.toUpperCase()}] Failed to analyze compression metrics for ${sourceFile.name}`,
      error,
    );
  }
}

type HomeCompressLandingProps = {
  initialLang?: Lang;
  showCompressedCount?: boolean;
  showCompareSection?: boolean;
};

export default function HomeCompressLanding({
  initialLang = "zh",
  showCompressedCount = true,
  showCompareSection = true,
}: HomeCompressLandingProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const itemsRef = React.useRef<HomeItem[]>([]);
  const displayedCountRef = React.useRef(0);
  const timersRef = React.useRef<Record<string, number>>({});
  const compareCompressedUrlRef = React.useRef<string | null>(null);
  const metricsRequestsRef = React.useRef<Record<string, MetricsRequestState>>(
    {},
  );
  const isUnmountedRef = React.useRef(false);
  const [items, setItems] = React.useState<HomeItem[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isCompressing, setIsCompressing] = React.useState(false);
  const [totalCompressedCount, setTotalCompressedCount] = React.useState(0);
  const [displayedCompressedCount, setDisplayedCompressedCount] =
    React.useState(0);
  const [isCountBouncing, setIsCountBouncing] = React.useState(false);
  const [lang, setLang] = React.useState<Lang>(initialLang);
  const [showFormatOptions, setShowFormatOptions] = React.useState(false);
  const [selectedFormats, setSelectedFormats] = React.useState<OutputFormat[]>(
    [],
  );
  const [whyVariantId, setWhyVariantId] = React.useState<string | null>(null);
  const [metricsVariantId, setMetricsVariantId] = React.useState<string | null>(
    null,
  );
  const [compareSizes, setCompareSizes] = React.useState<{
    original: string;
    compressed: string;
  }>({
    original: "--",
    compressed: "--",
  });
  const [compareCompressedSrc, setCompareCompressedSrc] = React.useState(
    COMPARE_IMAGE_SOURCE_PATH,
  );
  const copy = React.useMemo(() => getHomeCompressLandingCopy(lang), [lang]);
  const blockedCopy = copy.errorOverlay;
  const metricsCopy = copy.metricsOverlay;
  const compareCopy = React.useMemo(
    () =>
      lang === "zh"
        ? {
            kicker: "无明显画质损失的压缩对比",
            title: "你能看出区别吗？",
            desc: "拖动中间滑块，查看原图与压缩图的细节差异。",
            original: "原图",
            compressed: "压缩后",
            hintLeft: "暗部细节依然保留",
            hintRight: "细小纹理仍然清晰",
          }
        : {
            kicker: "Image Comparison",
            title: "Can you tell the difference?",
            desc: "Drag the slider to compare original and compressed image quality.",
            original: "ORIGINAL",
            compressed: "COMPRESSED",
            hintLeft: "Darker places stay intact",
            hintRight: "Nano details are still there",
        },
    [lang],
  );

  const loadVariantMetrics = React.useCallback(
    async (item: HomeItem, variant: OutputVariant) => {
      if (!IS_DEV || variant.status !== "done" || !variant.outputUrl) {
        return;
      }

      const requestKey = `${item.id}:${variant.id}`;
      const requestState = metricsRequestsRef.current[requestKey];
      if (requestState?.status === "loading" || requestState?.status === "done") {
        return;
      }

      metricsRequestsRef.current[requestKey] = { status: "loading" };

      try {
        const compressedResponse = await fetch(variant.outputUrl);
        const compressedBlob = await compressedResponse.blob();
        const analysis = await analyzeCompressionInWorker(
          item.file,
          compressedBlob,
        );

        if (isUnmountedRef.current) {
          return;
        }

        setItems((prev) =>
          prev.map((currentItem) =>
            currentItem.id !== item.id
              ? currentItem
              : {
                  ...currentItem,
                  variants: currentItem.variants.map((currentVariant) =>
                    currentVariant.id !== variant.id
                      ? currentVariant
                      : {
                          ...currentVariant,
                          qualityMetrics: analysis.comparison,
                        },
                  ),
                },
          ),
        );

        if (!metricsRequestsRef.current[requestKey]?.logged) {
          await logCompressionAnalysis(
            item.file,
            variant.format,
            analysis.sourceMetrics,
            analysis.compressedMetrics,
            analysis.comparison,
          );
        }

        metricsRequestsRef.current[requestKey] = {
          status: "done",
          logged: true,
        };
      } catch (error) {
        delete metricsRequestsRef.current[requestKey];
        if (IS_DEV) {
          console.warn(
            `[NanoImg][${variant.format.toUpperCase()}] Failed to analyze hover metrics for ${item.file.name}`,
            error,
          );
        }
      }
    },
    [],
  );

  React.useEffect(() => {
    void reportPageViewOnce();
  }, []);

  React.useEffect(() => {
    setLang(getLang());
  }, []);

  React.useEffect(() => {
    if (!showCompressedCount) {
      setTotalCompressedCount(0);
      setDisplayedCompressedCount(0);
      return;
    }

    void loadTotalCompressedCount().then((total) => {
      setTotalCompressedCount(total);
    });
  }, [showCompressedCount]);

  React.useEffect(() => {
    displayedCountRef.current = displayedCompressedCount;
  }, [displayedCompressedCount]);

  React.useEffect(() => {
    const from = displayedCountRef.current;
    const to = totalCompressedCount;
    if (from === to) {
      return;
    }

    if (to > from) {
      setIsCountBouncing(true);
      const timer = window.setTimeout(() => setIsCountBouncing(false), 320);
      const startTime = performance.now();
      const duration = 560;
      let rafId = 0;
      const step = (now: number) => {
        const elapsed = Math.min((now - startTime) / duration, 1);
        const eased = 1 - (1 - elapsed) * (1 - elapsed);
        const value = Math.round(from + (to - from) * eased);
        setDisplayedCompressedCount(value);
        if (elapsed < 1) {
          rafId = window.requestAnimationFrame(step);
        }
      };
      rafId = window.requestAnimationFrame(step);
      return () => {
        window.clearTimeout(timer);
        window.cancelAnimationFrame(rafId);
      };
    }

    setDisplayedCompressedCount(to);
  }, [totalCompressedCount]);

  React.useEffect(() => {
    document.title = copy.pageTitle;
  }, [copy.pageTitle]);

  React.useEffect(() => {
    if (!showCompareSection) {
      if (compareCompressedUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(compareCompressedUrlRef.current);
        compareCompressedUrlRef.current = null;
      }
      setCompareCompressedSrc(COMPARE_IMAGE_SOURCE_PATH);
      setCompareSizes({ original: "--", compressed: "--" });
      return;
    }

    let cancelled = false;
    const buildCompareImage = async () => {
      try {
        const originBlob = await fetch(COMPARE_IMAGE_SOURCE_PATH).then((res) =>
          res.blob(),
        );
        const sourceFile = new File([originBlob], COMPARE_IMAGE_SOURCE_NAME, {
          type: "image/png",
        });
        const compressed = await compressWithWasmWorker(
          sourceFile,
          80,
          "jpeg",
          false,
        );

        if (cancelled) {
          return;
        }

        if (compareCompressedUrlRef.current?.startsWith("blob:")) {
          URL.revokeObjectURL(compareCompressedUrlRef.current);
        }
        const compressedUrl = URL.createObjectURL(compressed.blob);
        compareCompressedUrlRef.current = compressedUrl;
        setCompareCompressedSrc(compressedUrl);
        setCompareSizes({
          original: formatSize(sourceFile.size),
          compressed: formatSize(compressed.blob.size),
        });
      } catch (error) {
        console.error("Compare image compression failed:", error);
        if (!cancelled) {
          setCompareSizes({ original: "--", compressed: "--" });
          setCompareCompressedSrc(COMPARE_IMAGE_SOURCE_PATH);
        }
      }
    };
    void buildCompareImage();
    return () => {
      cancelled = true;
      if (compareCompressedUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(compareCompressedUrlRef.current);
        compareCompressedUrlRef.current = null;
      }
    };
  }, [showCompareSection]);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      const timerMap = timersRef.current;
      isUnmountedRef.current = true;
      metricsRequestsRef.current = {};
      void flushCompressedCountNow();
      Object.values(timerMap).forEach((timer) => window.clearInterval(timer));
      terminateCompressionWorker();
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        item.variants.forEach((variant) => {
          if (variant.outputUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(variant.outputUrl);
          }
        });
      });
    };
  }, []);

  const enqueueFiles = React.useCallback(
    (fileList: FileList | File[]) => {
      const nextFiles = Array.from(fileList).filter((file) =>
        ALLOWED_TYPES.has(file.type),
      );
      if (!nextFiles.length) {
        return;
      }

      setItems((prev) => {
        const remain = MAX_FILES - prev.length;
        if (remain <= 0) {
          return prev;
        }
        return [
          ...prev,
          ...nextFiles
            .slice(0, remain)
            .map((file) => createItem(file, selectedFormats)),
        ];
      });
    },
    [selectedFormats],
  );

  React.useEffect(() => {
    if (!items.length) {
      return;
    }

    setItems((prev) =>
      prev.map((item) => ensureVariants(item, selectedFormats)),
    );
  }, [items.length, selectedFormats]);

  const startFakeProgress = React.useCallback(
    (itemId: string, variantId: string) => {
      const timerKey = `${itemId}:${variantId}`;
      window.clearInterval(timersRef.current[timerKey]);
      timersRef.current[timerKey] = window.setInterval(() => {
        setItems((prev) =>
          prev.map((item) =>
            item.id !== itemId
              ? item
              : {
                  ...item,
                  variants: item.variants.map((variant) => {
                    if (
                      variant.id !== variantId ||
                      variant.status !== "processing"
                    ) {
                      return variant;
                    }
                    const target = 98;
                    const remaining = Math.max(0, target - variant.progress);
                    const step = Math.max(
                      0.4,
                      remaining * (0.08 + Math.random() * 0.07),
                    );
                    const nextProgress = Math.min(
                      variant.progress + step,
                      target,
                    );
                    return { ...variant, progress: nextProgress };
                  }),
                },
          ),
        );
      }, 180);
    },
    [],
  );

  const stopFakeProgress = React.useCallback(
    (itemId: string, variantId: string) => {
      const timerKey = `${itemId}:${variantId}`;
      if (timersRef.current[timerKey]) {
        window.clearInterval(timersRef.current[timerKey]);
        delete timersRef.current[timerKey];
      }
    },
    [],
  );

  const processQueue = React.useCallback(async () => {
    if (isCompressing) {
      return;
    }

    const claimed = new Set<string>();
    const running = new Map<string, Promise<void>>();
    const heavyRunning = new Set<string>();

    const runOne = (currentItem: HomeItem, currentVariant: OutputVariant) =>
      (async () => {
        const startedAt = Date.now();
        setItems((prev) =>
          prev.map((item) =>
            item.id === currentItem.id
              ? {
                  ...item,
                  updatedAt: startedAt,
                  variants: item.variants.map((variant) =>
                    variant.id === currentVariant.id
                      ? {
                          ...variant,
                          status: "processing",
                          progress: 0,
                          errorMessage: undefined,
                        }
                      : variant,
                  ),
                }
              : item,
          ),
        );
        startFakeProgress(currentItem.id, currentVariant.id);

        try {
          const compressed = await compressWithWasmWorker(
            currentItem.file,
            80,
            currentVariant.format,
            Boolean(currentVariant.allowAlphaLoss),
          );
          if (isUnmountedRef.current) {
            return;
          }

          stopFakeProgress(currentItem.id, currentVariant.id);
          const outputUrl = URL.createObjectURL(compressed.blob);
          const outputSize = compressed.blob.size;
          const percent =
            Math.round(
              (((outputSize - currentItem.file.size) / currentItem.file.size) *
                100 *
                10),
            ) / 10;
          reportCompressionResult(
            normalizeOutputFormat(compressed.ext),
            currentItem.file.size,
            outputSize,
          );
          setTotalCompressedCount((prev) => prev + 1);

          const doneAt = Date.now();
          setItems((prev) =>
            prev.map((item) =>
              item.id === currentItem.id
                ? {
                    ...item,
                    updatedAt: doneAt,
                    variants: item.variants.map((variant) =>
                      variant.id === currentVariant.id
                        ? {
                            ...variant,
                            format: normalizeOutputFormat(compressed.ext),
                            status: "done",
                            outputUrl,
                            outputName: compressed.fileName,
                            outputExt: compressed.ext,
                            outputSize,
                            percent,
                            progress: 100,
                            errorMessage: undefined,
                          }
                        : variant,
                    ),
                  }
                : item,
            ),
          );
        } catch (error) {
          logCompressionFailure(currentItem.file, currentVariant.format, error);
          stopFakeProgress(currentItem.id, currentVariant.id);
          const failedAt = Date.now();
          setItems((prev) =>
            prev.map((item) =>
              item.id === currentItem.id
                ? {
                    ...item,
                    updatedAt: failedAt,
                    variants: item.variants.map((variant) =>
                      variant.id === currentVariant.id
                        ? {
                            ...variant,
                            status: "error",
                            progress: 100,
                            errorMessage:
                              error instanceof Error
                                ? error.message
                                : "Unknown compression error",
                          }
                        : variant,
                    ),
                  }
                : item,
            ),
          );
        }
      })();

    setIsCompressing(true);
    try {
      while (!isUnmountedRef.current) {
        while (
          running.size < MAX_CONCURRENT_COMPRESSIONS &&
          !isUnmountedRef.current
        ) {
          const nextTask = itemsRef.current
            .flatMap((item) =>
              item.variants.map((variant) => ({ item, variant })),
            )
            .sort((left, right) => left.item.file.size - right.item.file.size)
            .find(({ item, variant }) => {
              if (variant.status !== "queued") {
                return false;
              }
              const key = `${item.id}:${variant.id}`;
              if (claimed.has(key) || running.has(key)) {
                return false;
              }
              if (isHeavyJpegRecompress(item, variant) && heavyRunning.size > 0) {
                return false;
              }
              return true;
            });

          if (!nextTask) {
            break;
          }

          const key = `${nextTask.item.id}:${nextTask.variant.id}`;
          const isHeavyTask = isHeavyJpegRecompress(
            nextTask.item,
            nextTask.variant,
          );
          claimed.add(key);
          if (isHeavyTask) {
            heavyRunning.add(key);
          }
          const job = runOne(nextTask.item, nextTask.variant).finally(() => {
            running.delete(key);
            claimed.delete(key);
            if (isHeavyTask) {
              heavyRunning.delete(key);
            }
          });
          running.set(key, job);
        }

        if (running.size === 0) {
          break;
        }
        await Promise.race(running.values());
      }

      if (running.size > 0) {
        await Promise.allSettled(Array.from(running.values()));
      }
    } finally {
      if (!isUnmountedRef.current) {
        setIsCompressing(false);
      }
    }
  }, [isCompressing, startFakeProgress, stopFakeProgress]);

  React.useEffect(() => {
    if (
      !isCompressing &&
      items.some((item) =>
        item.variants.some((variant) => variant.status === "queued"),
      )
    ) {
      processQueue();
    }
  }, [isCompressing, items, processQueue]);

  const completedItems = items.filter((item) =>
    item.variants.some((variant) => variant.status === "done"),
  );
  const sortedItems = React.useMemo(
    () => [...items].sort((a, b) => b.updatedAt - a.updatedAt),
    [items],
  );
  const completedCount = completedItems.length;
  const totalOriginalSize = completedItems.reduce(
    (sum, item) => sum + item.file.size,
    0,
  );
  const totalCompressedSize = completedItems.reduce(
    (sum, item) =>
      sum + (getBestDoneVariant(item)?.outputSize || item.file.size),
    0,
  );
  const totalSavedBytes = Math.max(0, totalOriginalSize - totalCompressedSize);
  const totalSavedPercent =
    totalOriginalSize > 0
      ? Math.max(0, Math.round((totalSavedBytes / totalOriginalSize) * 100))
      : 0;
  const hasPendingItems = items.some((item) =>
    item.variants.some(
      (variant) =>
        variant.status === "queued" || variant.status === "processing",
    ),
  );
  const zipItems = completedItems.flatMap((item) =>
    item.variants
      .filter(
        (variant) =>
          variant.status === "done" && variant.outputUrl && variant.outputName,
      )
      .map((variant) => ({
        name: buildZipEntryFileName(variant.outputName!),
        url: variant.outputUrl!,
      })),
  );

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    enqueueFiles(event.dataTransfer.files);
  };

  const handleSwitchLang = (nextLang: Lang) => {
    if (nextLang === lang) {
      return;
    }
    setLang(nextLang);
    persistLang(nextLang);
  };

  const formatOptions = React.useMemo(
    (): Array<{ key: OutputFormat; label: string }> => [
      { key: "avif", label: "AVIF" },
      { key: "jpeg", label: "JPEG" },
      { key: "png", label: "PNG" },
      { key: "webp", label: "WEBP" },
    ],
    [],
  );

  const handleToggleFormat = (formatKey: OutputFormat) => {
    setSelectedFormats((prev) =>
      prev.includes(formatKey)
        ? prev.filter((item) => item !== formatKey)
        : [...prev, formatKey],
    );
  };

  const handleSelectAllFormats = () => {
    setSelectedFormats((prev) =>
      prev.length === formatOptions.length
        ? []
        : formatOptions.map((item) => item.key),
    );
  };

  const handleConvertAnyway = React.useCallback(
    (itemId: string, variantId: string) => {
      const now = Date.now();
      setItems((prev) =>
        prev.map((item) =>
          item.id !== itemId
            ? item
            : {
                ...item,
                updatedAt: now,
                variants: item.variants.map((variant) =>
                  variant.id === variantId
                    ? {
                        ...variant,
                        allowAlphaLoss: true,
                        status: "queued",
                        progress: 0,
                        errorMessage: undefined,
                      }
                    : variant,
                ),
              },
        ),
      );
      setWhyVariantId(null);
    },
    [],
  );

  return (
    <main className="w-full bg-[#ececec] text-slate-800">
      <section className="relative min-h-[470px] overflow-hidden bg-[#78956b] sm:min-h-[520px] lg:min-h-[560px]">
        <div className="absolute inset-0 bg-[url('/images/bamboo.avif')] bg-cover bg-left-center bg-no-repeat" />
        <div className="absolute inset-y-0 right-0 hidden w-[38%] bg-[url('/images/bamboo-panda.avif')] bg-contain bg-right-bottom bg-no-repeat lg:block" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(22,40,20,0.36),rgba(76,102,59,0.12)_40%,rgba(236,244,216,0.16)_100%)]" />

        <div className="relative mx-auto flex min-h-[470px] max-w-[1440px] flex-col px-4 pb-5 pt-3 sm:min-h-[520px] sm:px-6 sm:pb-6 sm:pt-4 lg:min-h-[560px] lg:px-10">
          <header className="flex items-center justify-between gap-3 bg-white/92 px-3 py-2 shadow-[0_16px_50px_rgba(26,34,24,0.12)] backdrop-blur sm:px-4 sm:py-2.5 md:px-6">
            <Link
              href="/favicon-generator"
              className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 sm:text-xs"
            >
              {copy.faviconEntry}
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSwitchLang("zh")}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition sm:text-xs ${lang === "zh" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => handleSwitchLang("en")}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition sm:text-xs ${lang === "en" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                EN
              </button>
            </div>
          </header>

          <div className="relative z-10 flex flex-1 items-start justify-center pt-4 sm:pt-6 lg:pt-8">
            <div className="w-full max-w-[780px]">
              <div
                onDragEnter={() => setIsDragging(true)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`mx-auto w-full rounded-[24px] bg-[rgba(108,119,95,0.78)] p-3 shadow-[0_22px_60px_rgba(24,32,24,0.24)] backdrop-blur-sm transition sm:rounded-[26px] sm:p-3.5 md:p-4 ${isDragging ? "scale-[1.01] ring-2 ring-white/60" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex h-[172px] w-full flex-col items-center justify-center rounded-[20px] border-[3px] border-dashed border-white/75 px-4 py-4 text-center text-white transition hover:bg-white/5 sm:h-[205px] sm:px-6 sm:py-5 md:h-[245px] md:py-6"
                >
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#4482d6,#143c88)] text-[28px] shadow-[0_16px_24px_rgba(7,33,79,0.4)] sm:mb-4 sm:h-14 sm:w-14 sm:rounded-[18px] sm:text-3xl">
                    ⬇
                  </div>
                  <h2 className="text-[16px] font-semibold leading-tight sm:text-[19px] md:text-[22px]">
                    {copy.dropTitle}
                  </h2>
                  <p className="mt-2 text-[11px] font-medium text-white/85 sm:mt-3 sm:text-[13px] md:text-[14px]">
                    {copy.dropDesc}
                  </p>
                </button>
                <div className="mt-3 overflow-hidden rounded-[18px] bg-[rgba(246,246,243,0.96)] sm:rounded-[20px]">
                  <div className="flex items-center gap-3 px-4 py-3 text-[11px] text-slate-600 sm:px-5 sm:text-[13px] md:text-[14px]">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setShowFormatOptions((prev) => !prev);
                      }}
                      aria-pressed={showFormatOptions}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                        showFormatOptions ? "bg-lime-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                          showFormatOptions ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <span className="font-medium">{copy.autoLabel}</span>
                  </div>
                  <div
                    className={`overflow-hidden bg-[#edf0e4] transition-all duration-200 ${
                      showFormatOptions
                        ? "max-h-40 border-t border-[#e2e6d8] sm:max-h-24"
                        : "max-h-0 border-t-0"
                    }`}
                  >
                    <div
                      className={`flex min-h-[60px] flex-wrap items-center gap-2 px-3 py-3 transition-opacity duration-150 sm:px-4 md:flex-nowrap ${
                        showFormatOptions
                          ? "opacity-100"
                          : "pointer-events-none opacity-0"
                      }`}
                    >
                      {formatOptions.map((format) => {
                        const active = selectedFormats.includes(format.key);
                        return (
                          <button
                            key={format.key}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleFormat(format.key);
                            }}
                            className={`inline-flex h-8 min-w-[82px] items-center justify-center rounded-full border px-2.5 text-[10px] font-semibold tracking-[0.02em] transition md:min-w-[88px] md:text-[11px] ${
                              active
                                ? "border-lime-500 bg-white text-lime-600 shadow-sm"
                                : "border-slate-300 bg-[#f7f7f2] text-slate-700"
                            }`}
                          >
                            {active && (
                              <span className="mr-2 text-lime-500">✓</span>
                            )}
                            <span>{format.label}</span>
                          </button>
                        );
                      })}
                      <span className="hidden h-8 w-px bg-slate-300 md:block" />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectAllFormats();
                        }}
                        className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-full border border-slate-300 bg-[#f7f7f2] px-2.5 text-[10px] font-semibold tracking-[0.02em] text-slate-700 transition hover:bg-white md:min-w-[104px] md:text-[11px]"
                      >
                        {copy.selectAll}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          enqueueFiles(event.target.files ?? []);
          event.target.value = "";
        }}
      />

      {items.length > 0 && (
        <section className="relative z-10 mx-auto -mt-8 w-full max-w-[1100px] px-4 pb-20 md:-mt-12">
          <div className="overflow-visible rounded-[14px] bg-[#4a4f5d] text-white shadow-[0_22px_50px_rgba(40,42,52,0.25)]">
            <div className="flex flex-col gap-5 px-6 py-5 md:flex-row md:items-start md:justify-between">
              <div className="max-w-3xl">
                <h3 className="text-2xl font-semibold text-lime-300">
                  {hasPendingItems
                    ? copy.processingTitle
                    : copy.completedTitle(
                        totalSavedPercent,
                        completedCount,
                        formatSize(totalSavedBytes),
                      )}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!zipItems.length}
                  onClick={() =>
                    SystemManager.downloadZip(
                      zipItems,
                      `nanoimg-images-${SystemManager.getNowformatTime()}.zip`,
                    )
                  }
                  className="rounded-xl bg-lime-300 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
                >
                  {copy.downloadZip}
                </button>
              </div>
            </div>

            <div className="bg-[#f3f3f3] text-slate-700">
              {sortedItems.map((item) => {
                const bestVariant = getBestDoneVariant(item);
                const doneVariants = getDoneVariants(item);
                const activeVariant = getActiveVariant(item);
                const hasInFlightVariant = item.variants.some(
                  (variant) =>
                    variant.status !== "done" && variant.status !== "error",
                );
                const activeProgress = hasInFlightVariant
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        activeVariant?.status === "processing"
                          ? activeVariant.progress
                          : 0,
                      ),
                    )
                  : 100;
                const rankedVariants = [...item.variants].sort(
                  (left, right) => {
                    const leftPercent =
                      left.status === "done"
                        ? (left.percent ?? Number.POSITIVE_INFINITY)
                        : Number.POSITIVE_INFINITY;
                    const rightPercent =
                      right.status === "done"
                        ? (right.percent ?? Number.POSITIVE_INFINITY)
                        : Number.POSITIVE_INFINITY;
                    return leftPercent - rightPercent;
                  },
                );

                return (
                  <div
                    key={item.id}
                    className="flex min-h-[84px] items-center gap-2.5 border-t border-[#d9d9d9] px-5 py-2.5 first:border-t-0"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-200">
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold leading-none text-[#4a4f5d]">
                            {item.file.name}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                            <span className="inline-flex rounded-md bg-[#e9f4ef] px-2 py-0.5 text-[12px] font-semibold uppercase leading-none text-[#0d9b90]">
                              {normalizeSourceFormat(item.file).toUpperCase()}
                            </span>
                            <span>{formatSize(item.file.size)}</span>
                          </div>
                        </div>
                        <div className="flex flex-row-reverse flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                          {rankedVariants.map((variant) => {
                            const toneClass =
                              variant.status === "done"
                                ? "border-transparent bg-[#e8ecf1] text-[#4b5160]"
                                : variant.status === "error"
                                  ? "border-[#ffd9d4] bg-[#fff1ef] text-[#d14332]"
                                  : variant.status === "processing"
                                    ? "border-transparent bg-[#eef1f4] text-sky-600"
                                    : "border-transparent bg-[#f0f2f4] text-slate-600";

                            const accentClass =
                              variant.format === "jpeg"
                                ? "text-[#0d9b90]"
                                : variant.format === "png"
                                  ? "text-[#2a7de1]"
                                  : variant.format === "webp"
                                    ? "text-[#6d4fe0]"
                                    : "text-slate-600";

                            const detail =
                              variant.status === "done"
                                ? `${formatSize(variant.outputSize || 0)}`
                                : variant.status === "processing"
                                  ? `${copy.optimizing} ${Math.round(variant.progress)}%`
                                  : variant.status === "queued"
                                    ? copy.queued
                                    : isTransparencyBlocked(
                                          variant.errorMessage,
                                        )
                                      ? copy.transparencyBlocked
                                      : variant.errorMessage ||
                                        copy.unsupportedFormat;

                            return (
                              <div
                                key={variant.id}
                                className="relative flex items-center gap-2"
                              >
                                {variant.status === "done" &&
                                  bestVariant?.id === variant.id &&
                                  doneVariants.length > 1 && (
                                    <span className="absolute -right-2 -top-2 z-30 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#82c341] text-[12px] font-bold text-white shadow-sm">
                                      ✓
                                    </span>
                                  )}
                                {variant.status === "done" ? (
                                  <>
                                    <div className="min-w-[52px] text-right">
                                      <div className="text-[14px] font-semibold leading-none text-[#4a4f5d]">
                                        {formatDeltaPercent(variant.percent)}
                                      </div>
                                      <div className="mt-0.5 text-[10px] leading-none text-[#6c7380]">
                                        {detail}
                                      </div>
                                    </div>
                                    {variant.outputUrl && (
                                      <div
                                        className="relative"
                                        onMouseEnter={
                                          IS_DEV
                                            ? () => {
                                                setMetricsVariantId(variant.id);
                                                void loadVariantMetrics(
                                                  item,
                                                  variant,
                                                );
                                              }
                                            : undefined
                                        }
                                        onMouseLeave={
                                          IS_DEV
                                            ? () =>
                                                setMetricsVariantId((prev) =>
                                                  prev === variant.id ? null : prev,
                                                )
                                            : undefined
                                        }
                                      >
                                        <a
                                          href={variant.outputUrl}
                                          download={
                                            variant.outputName || item.file.name
                                          }
                                          className={`inline-flex items-center gap-1.5 rounded-[14px] bg-[#dfe5ea] px-2.5 py-1 text-[11px] font-semibold ${accentClass}`}
                                        >
                                          <span className="text-[11px]">⬇</span>
                                          <span>
                                            {extToBadge(variant.outputExt)}
                                          </span>
                                        </a>
                                        {IS_DEV &&
                                          metricsVariantId === variant.id && (
                                          <div className="absolute right-0 top-[calc(100%+10px)] z-20 w-[220px] rounded-xl bg-white p-4 text-left shadow-[0_12px_32px_rgba(0,0,0,0.18)] ring-1 ring-black/5">
                                            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                              {metricsCopy.title}
                                            </div>
                                            {variant.qualityMetrics ? (
                                              <div className="mt-3 space-y-2 text-[12px] text-slate-700">
                                                <div className="flex items-center justify-between gap-3">
                                                  <span>{metricsCopy.qualityScore}</span>
                                                  <span className="font-semibold text-slate-900">
                                                    {Math.round(
                                                      variant.qualityMetrics
                                                        .overallQualityScore,
                                                    )}
                                                  </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                  <span>{metricsCopy.ssim}</span>
                                                  <span className="font-semibold text-slate-900">
                                                    {formatMetricRatio(
                                                      variant.qualityMetrics
                                                        .ssim,
                                                    )}
                                                  </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                  <span>{metricsCopy.msSsim}</span>
                                                  <span className="font-semibold text-slate-900">
                                                    {formatMetricRatio(
                                                      variant.qualityMetrics
                                                        .msSsim,
                                                    )}
                                                  </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                  <span>{metricsCopy.edgeRetention}</span>
                                                  <span className="font-semibold text-slate-900">
                                                    {formatMetricPercent(
                                                      variant.qualityMetrics
                                                        .edgeRetention * 100,
                                                    )}
                                                  </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                  <span>{metricsCopy.blurLoss}</span>
                                                  <span className="font-semibold text-slate-900">
                                                    {formatMetricPercent(
                                                      variant.qualityMetrics
                                                        .blurLossPercent,
                                                    )}
                                                  </span>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="mt-3 text-[12px] text-slate-500">
                                                {metricsCopy.loading}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                ) : variant.status === "error" &&
                                  variant.format === "jpeg" ? (
                                  <>
                                    <div
                                      className="min-w-[68px] text-right"
                                      onMouseEnter={() =>
                                        setWhyVariantId(variant.id)
                                      }
                                      onMouseLeave={() =>
                                        setWhyVariantId((prev) =>
                                          prev === variant.id ? null : prev,
                                        )
                                      }
                                    >
                                      <div className="text-[15px] font-semibold leading-none text-[#4a4f5d]">
                                        {blockedCopy.failed}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setWhyVariantId((prev) =>
                                            prev === variant.id
                                              ? null
                                              : variant.id,
                                          )
                                        }
                                        className="mt-1 cursor-help border-b border-dotted border-[#6c7380] text-[10px] leading-none text-[#6c7380]"
                                      >
                                        {blockedCopy.seeWhy}
                                      </button>
                                      {whyVariantId === variant.id && (
                                        <div className="absolute right-[84px] top-[28px] z-20 w-[320px] rounded-xl bg-white p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.2)] ring-1 ring-black/5">
                                          <p className="text-[13px] leading-6 text-slate-700">
                                            {isTransparencyBlocked(
                                              variant.errorMessage,
                                            )
                                              ? blockedCopy.lineTransparency
                                              : blockedCopy.lineGeneric}
                                          </p>
                                          {isTransparencyBlocked(
                                            variant.errorMessage,
                                          ) && (
                                            <>
                                              <p className="mt-3 text-[13px] leading-6 text-slate-700">
                                                {
                                                  blockedCopy.lineTransparencyDetail
                                                }
                                              </p>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleConvertAnyway(
                                                    item.id,
                                                    variant.id,
                                                  )
                                                }
                                                className="mt-3 border-b border-dotted border-lime-500 text-[16px] leading-none text-lime-600"
                                              >
                                                {blockedCopy.convertAnyway}
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    <div className="inline-flex items-center gap-2 rounded-[14px] bg-[#f7eae8] px-3 py-2 text-[11px] font-semibold text-[#ef2f1a]">
                                      <span>⚠</span>
                                      <span>JPEG</span>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div
                                      className={`rounded-[14px] px-2.5 py-1 text-[11px] font-semibold uppercase ${toneClass} ${accentClass}`}
                                    >
                                      {variant.format}
                                    </div>
                                    <div className="max-w-[96px] text-[10px] leading-3.5">
                                      {detail}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div
                        className={`mt-1.5 overflow-hidden rounded-full ${
                          hasInFlightVariant
                            ? "h-[4px] bg-[#d7e6c7]"
                            : "h-px bg-[#d4d5d8]"
                        }`}
                      >
                        <div
                          className={`transition-all duration-300 ${
                            hasInFlightVariant
                              ? activeProgress <= 0
                                ? "h-[4px] bg-[#8cc63f] transition-none"
                                : "h-[4px] bg-[#8cc63f]"
                              : "h-px bg-[#8b909b]"
                          }`}
                          style={{
                            width: `${activeProgress}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="relative overflow-hidden bg-[#f1f1f1] py-16 sm:py-20 md:py-24">
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(241,241,241,0))]" />
        <div className="mx-auto flex max-w-[1180px] flex-col gap-10 px-4 sm:gap-12 sm:px-6 lg:gap-14 lg:px-10">
          <div className="mx-auto max-w-[980px] text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-600 sm:text-sm sm:tracking-[0.28em]">
              {copy.heroKicker}
            </p>
            <h2 className="mt-4 font-sans text-[32px] font-semibold leading-[1.08] text-slate-700 sm:mt-5 sm:text-[42px] md:text-5xl">
              {copy.heroTitle}
            </h2>
            <p className="mx-auto mt-4 max-w-[920px] text-[15px] leading-7 text-slate-500 sm:mt-5 sm:text-[17px] sm:leading-8 md:mt-6 md:text-[22px] md:leading-10">
              {copy.heroDesc}
            </p>
          </div>

          {showCompareSection ? (
          <div className="mx-auto w-full max-w-[1180px] rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_16px_45px_rgba(148,163,184,0.12)] sm:rounded-[28px] sm:p-5 md:p-8">
            <div className="mx-auto max-w-[820px] text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600 sm:text-xs sm:tracking-[0.24em]">
                {compareCopy.kicker}
              </p>
              <h3 className="mt-3 text-[26px] font-semibold leading-tight text-slate-700 sm:text-3xl md:text-4xl">
                {compareCopy.title}
              </h3>
              <p className="mt-3 text-[13px] leading-6 text-slate-500 sm:text-sm md:text-base">
                {compareCopy.desc}
              </p>
            </div>

            <div className="relative mt-5 sm:mt-6">
              <div className="relative overflow-hidden rounded-[24px] border border-slate-200">
                <ReactCompareSlider
                  className="h-[265px] w-full sm:h-[360px] md:h-[520px]"
                  itemOne={
                    <ReactCompareSliderImage
                      src={COMPARE_IMAGE_SOURCE_PATH}
                      alt="Original mountain image"
                      style={{ objectFit: "cover" }}
                    />
                  }
                  itemTwo={
                    <ReactCompareSliderImage
                      src={compareCompressedSrc}
                      alt="Compressed mountain image"
                      style={{ objectFit: "cover" }}
                    />
                  }
                  handle={
                    <div className="flex h-full items-center">
                      <div className="h-full w-[2px] bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
                      <div className="-ml-[14px] flex h-7 w-7 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-600 shadow-md">
                        <>↔</>
                      </div>
                    </div>
                  }
                />
                <div className="pointer-events-none absolute bottom-4 left-[9%] text-xs text-white [text-shadow:0_3px_12px_rgba(0,0,0,0.72)] sm:bottom-5 sm:left-[13%]">
                  <div className="text-[10px] font-semibold tracking-[0.12em] sm:text-sm md:text-base">
                    {compareCopy.original}
                  </div>
                  <div className="mt-0.5 text-[10px] text-white/90 sm:text-[11px]">
                    {compareSizes.original}
                  </div>
                </div>
                <div className="pointer-events-none absolute right-[9%] top-6 text-xs text-white [text-shadow:0_3px_12px_rgba(0,0,0,0.72)] sm:right-[13%] sm:top-10">
                  <div className="text-[10px] font-semibold tracking-[0.12em] sm:text-sm md:text-base">
                    {compareCopy.compressed}
                  </div>
                  <div className="mt-0.5 text-[10px] text-white/90 sm:text-[11px]">
                    {compareSizes.compressed}
                  </div>
                </div>
              </div>

              <svg
                viewBox="0 0 1000 90"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-x-0 top-[77%] z-20 h-[44px] w-full sm:top-[79%] sm:h-[72px]"
              >
                <path
                  d="M300 86 C 306 68, 301 44, 297 20"
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.95"
                />
                <path
                  d="M700 86 C 694 68, 699 44, 703 20"
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.95"
                />
                <path
                  d="M290 24 L 297 14 L 304 24"
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M696 24 L 703 14 L 710 24"
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>

              <div className="relative z-30 mt-16 grid grid-cols-2 gap-4 text-center text-sky-600 sm:mt-12 md:grid-cols-2">
                <p className="mx-auto max-w-[150px] text-[11px] font-medium leading-tight sm:max-w-[260px] sm:text-base md:text-2xl [font-family:'Comic_Sans_MS','Marker_Felt','Bradley_Hand',cursive]">
                  {compareCopy.hintLeft}
                </p>
                <p className="mx-auto max-w-[150px] text-[11px] font-medium leading-tight sm:max-w-[260px] sm:text-base md:text-2xl [font-family:'Comic_Sans_MS','Marker_Felt','Bradley_Hand',cursive]">
                  {compareCopy.hintRight}
                </p>
              </div>
            </div>
          </div>
          ) : null}

          <div className="grid gap-6 md:grid-cols-3">
            {copy.cards.map((card) => (
              <article
                key={card.title}
                className="rounded-[28px] border border-slate-200 bg-white px-7 py-8 shadow-[0_16px_45px_rgba(148,163,184,0.12)]"
              >
                <div className="h-2 w-14 rounded-full bg-[linear-gradient(90deg,#0ea5e9,#22c55e)]" />
                <h3 className="mt-6 text-2xl font-semibold text-slate-700">
                  {card.title}
                </h3>
                <p className="mt-4 text-base leading-8 text-slate-500">
                  {card.desc}
                </p>
              </article>
            ))}
          </div>

          {showCompressedCount ? (
          <div className="mx-auto flex w-full justify-center pt-2">
            <div
              className={`inline-flex items-end gap-3 rounded-2xl border border-sky-200/70 bg-white px-8 py-5 shadow-[0_16px_40px_rgba(56,118,185,0.14)] transition-all duration-300 ${
                isCountBouncing
                  ? "scale-[1.04] shadow-[0_18px_55px_rgba(14,165,233,0.28)]"
                  : ""
              }`}
            >
              <span className="pb-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
                {lang === "zh" ? "累计压缩" : "Total Compressed"}
              </span>
              <span className="text-5xl font-extrabold leading-none text-slate-700 md:text-6xl">
                {displayedCompressedCount.toLocaleString()}
              </span>
            </div>
          </div>
          ) : null}
        </div>
      </section>
      <footer className="border-t border-slate-200 bg-[#ececec] px-4 py-6 text-center text-sm text-slate-500">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-700"
        >
          沪ICP备2020025300号-5
        </a>
      </footer>
    </main>
  );
}
