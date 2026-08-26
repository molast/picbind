"use client";

import React from "react";
import {
  formatSize,
  getBestDoneVariant,
  type CompareAsset,
  type HomeCompareCopy,
  type HomeItem,
  type MetricsRequestState,
  type OutputVariant,
} from "./home-compression-types";
import {
  getHomeCompressLandingCopy,
  getLang,
  setLang as persistLang,
  type Lang,
} from "@/locales";
import {
  flushCompressedCountNow,
  loadHomeDisplayConfig,
  loadTotalCompressedCount,
  reportCompressionResult,
  reportCompressedCount,
} from "@/utils/compression-metrics";
import { reportPageViewOnce } from "@/utils/page-view";
import { buildZipEntryFileName } from "@/utils/compress-shared";
import SystemManager from "@/utils/System";
import {
  COMPRESSION_QUALITY_METRICS_ENABLED,
  IMAGE_COMPARE_ENABLED,
  IMAGE_COMPARE_SELECTION_ENABLED,
} from "@/utils/feature-flags";
import { createUuid } from "@/utils/uuid";
import {
  COMPRESSION_HANDOFF_EVENT,
  consumeFilesForCompression,
  deleteQueuedImageFile,
  getQueuedImageFile,
  releaseStagedQueuedImageFile,
  stageQueuedImageFile,
  storeQueuedImageFile,
} from "@/utils/image-file-store";
import { storeCompressedImage } from "@/utils/compressed-image-store";
import { compressWithWasmWorker } from "@/utils/wasm-worker";
import { analyzeCompressionInWorker } from "@/utils/analysis-worker";
import {
  type ImageQualityComparison,
  type OutputFormat,
} from "@/utils/wasm";

const MAX_FILES = 20;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CONCURRENT_COMPRESSIONS = 2;
const MAX_CONCURRENT_AVIF_COMPRESSIONS = 1;
const MAX_CONCURRENT_WEBP_COMPRESSIONS = 2;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "avif"]);
const COMPARE_IMAGE_SOURCE_PATH = "/images/compare-original.png";
const COMPARE_IMAGE_SOURCE_NAME = "compare-original.png";
const IS_DEV = process.env.NODE_ENV !== "production";

function normalizeSourceFormat(file: File): OutputFormat {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  if (file.type === "image/avif" || extension === "avif") {
    return "avif";
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

function createVariant(
  format: OutputFormat,
  automatic = false,
): OutputVariant {
  return {
    id: `${format}-${createUuid()}`,
    format,
    progress: 0,
    status: "queued",
    automatic,
  };
}

function ensureVariants(item: HomeItem, selectedFormats: OutputFormat[]) {
  if (item.rejection) {
    return item;
  }
  if (!selectedFormats.length) {
    return item;
  }

  const wantedFormats = selectedFormats.length
    ? Array.from(new Set(selectedFormats))
    : [item.sourceFormat];
  const retainedVariants = item.variants.filter(
    (variant) => !variant.automatic || variant.status !== "queued",
  );
  const existingFormats = new Set(
    retainedVariants
      .filter((variant) => !variant.automatic)
      .map((variant) => variant.format),
  );
  const missingVariants = wantedFormats
    .filter((format) => !existingFormats.has(format))
    .map((format) => createVariant(format));

  if (
    !missingVariants.length &&
    retainedVariants.length === item.variants.length
  ) {
    return item;
  }

  return {
    ...item,
    variants: [...retainedVariants, ...missingVariants],
  };
}

function createRejectedItem(file: File): HomeItem {
  const now = Date.now();
  const id = `${file.name}-${file.size}-${file.lastModified}-${createUuid()}`;
  return {
    id,
    fileId: id,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    fileLastModified: file.lastModified,
    sourceFormat: normalizeSourceFormat(file),
    previewUrl: "",
    updatedAt: now,
    variants: [],
    rejection: "file-too-large",
  };
}

async function createPreviewUrl(file: File) {
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return URL.createObjectURL(file);
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const edge = 96;
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d");
    if (!context) {
      return URL.createObjectURL(file);
    }

    const sourceEdge = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - sourceEdge) / 2;
    const sourceY = (bitmap.height - sourceEdge) / 2;
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceEdge,
      sourceEdge,
      0,
      0,
      edge,
      edge,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.72),
    );
    return blob ? URL.createObjectURL(blob) : URL.createObjectURL(file);
  } catch (_error) {
    return URL.createObjectURL(file);
  } finally {
    bitmap?.close();
  }
}

function createItem(
  file: File,
  selectedFormats: OutputFormat[],
): HomeItem {
  const now = Date.now();
  const fileId = `${file.name}-${file.size}-${file.lastModified}-${createUuid()}`;
  const sourceFormat = normalizeSourceFormat(file);
  stageQueuedImageFile(fileId, file);
  const previewUrl = URL.createObjectURL(file);
  const variants = selectedFormats.length
    ? ensureVariants(
        {
          id: fileId,
          fileId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileLastModified: file.lastModified,
          sourceFormat,
          previewUrl: "",
          updatedAt: now,
          variants: [],
        },
        selectedFormats,
      ).variants
    : [createVariant(normalizeSourceFormat(file), true)];

  return {
    id: fileId,
    fileId,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    fileLastModified: file.lastModified,
    sourceFormat,
    previewUrl,
    updatedAt: now,
    variants,
  };
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
    `[PicBind][${format.toUpperCase()}][FAILED] ${sourceFile.name}`,
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
    const label = `[PicBind][${format.toUpperCase()}] ${sourceFile.name}`;
    console.groupCollapsed(label);
    console.log("Source metrics", sourceMetrics);
    console.log("Compressed metrics", compressedMetrics);
    console.log("Quality comparison", compareMetrics);
    console.groupEnd();
  } catch (error) {
    console.warn(
      `[PicBind][${format.toUpperCase()}] Failed to analyze compression metrics for ${sourceFile.name}`,
      error,
    );
  }
}

export type UseHomeCompressionOptions = {
  initialLang?: Lang;
  showCompressedCount?: boolean;
};

export function useHomeCompression({
  initialLang = "en",
  showCompressedCount = false,
}: UseHomeCompressionOptions) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const itemsRef = React.useRef<HomeItem[]>([]);
  const displayedCountRef = React.useRef(0);
  const timersRef = React.useRef<Record<string, number>>({});
  const compareCompressedUrlRef = React.useRef<string | null>(null);
  const compareSourceUrlsRef = React.useRef<Record<string, string>>({});
  const metricsRequestsRef = React.useRef<Record<string, MetricsRequestState>>(
    {},
  );
  const releasedSourceFilesRef = React.useRef(new Set<string>());
  const isUnmountedRef = React.useRef(false);
  const [items, setItems] = React.useState<HomeItem[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isCompressing, setIsCompressing] = React.useState(false);
  const [homeShowCompressedCount, setHomeShowCompressedCount] = React.useState(
    showCompressedCount,
  );
  const homeShowCompareSection = IMAGE_COMPARE_ENABLED;
  const homeAllowCompareSelection = IMAGE_COMPARE_SELECTION_ENABLED;
  const homeShowQualityMetrics = COMPRESSION_QUALITY_METRICS_ENABLED;
  const [compareSectionReady, setCompareSectionReady] = React.useState(false);
  const [compareAssets, setCompareAssets] = React.useState<CompareAsset[]>([]);
  const [compareLeftAssetId, setCompareLeftAssetId] = React.useState<
    string | null
  >(null);
  const [compareRightAssetId, setCompareRightAssetId] = React.useState<
    string | null
  >(null);
  const [totalCompressedCount, setTotalCompressedCount] = React.useState(0);
  const [displayedCompressedCount, setDisplayedCompressedCount] =
    React.useState(0);
  const [isCountBouncing, setIsCountBouncing] = React.useState(false);
  const [lang, setLang] = React.useState<Lang>(initialLang);
  const [langReady, setLangReady] = React.useState(false);
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
  const compareCopy = React.useMemo<HomeCompareCopy>(
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
      if (!homeShowQualityMetrics || variant.status !== "done" || !variant.outputUrl) {
        return;
      }

      const requestKey = `${item.id}:${variant.id}`;
      const requestState = metricsRequestsRef.current[requestKey];
      if (requestState?.status === "loading" || requestState?.status === "done") {
        return;
      }

      metricsRequestsRef.current[requestKey] = { status: "loading" };

      try {
        const sourceFile = await getQueuedImageFile(item.fileId);
        if (!sourceFile) {
          throw new Error("Source image is no longer available");
        }
        const compressedResponse = await fetch(variant.outputUrl);
        const compressedBlob = await compressedResponse.blob();
        const analysis = await analyzeCompressionInWorker(
          sourceFile,
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
            sourceFile,
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
            `[PicBind][${variant.format.toUpperCase()}] Failed to analyze hover metrics for ${item.fileName}`,
            error,
          );
        }
      }
    },
    [homeShowQualityMetrics],
  );

  React.useEffect(() => {
    void reportPageViewOnce();
  }, []);

  React.useEffect(() => {
    setLang(getLang());
    setLangReady(true);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    void loadHomeDisplayConfig({ showCompressedCount }).then((config) => {
      if (cancelled) {
        return;
      }
      setHomeShowCompressedCount(config.showCompressedCount);
    });

    return () => {
      cancelled = true;
    };
  }, [showCompressedCount]);

  React.useEffect(() => {
    if (!homeShowCompressedCount) {
      setTotalCompressedCount(0);
      setDisplayedCompressedCount(0);
      return;
    }

    void loadTotalCompressedCount().then((total) => {
      setTotalCompressedCount(total);
    });
  }, [homeShowCompressedCount]);

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
    if (!homeShowCompareSection) {
      setCompareSectionReady(false);
      return;
    }

    if (typeof window === "undefined") {
      setCompareSectionReady(true);
      return;
    }

    let cancelled = false;
    const activate = () => {
      if (!cancelled) {
        setCompareSectionReady(true);
      }
    };

    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleApi.requestIdleCallback === "function") {
      const handle = idleApi.requestIdleCallback(activate, { timeout: 1400 });
      return () => {
        cancelled = true;
        idleApi.cancelIdleCallback?.(handle);
      };
    }

    const timer = window.setTimeout(activate, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [homeShowCompareSection]);

  React.useEffect(() => {
    if (!homeShowCompareSection) {
      if (compareCompressedUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(compareCompressedUrlRef.current);
        compareCompressedUrlRef.current = null;
      }
      setCompareCompressedSrc(COMPARE_IMAGE_SOURCE_PATH);
      setCompareSizes({ original: "--", compressed: "--" });
      return;
    }
    if (!compareSectionReady) {
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
  }, [compareSectionReady, homeShowCompareSection]);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    items.forEach((item) => {
      if (
        item.rejection ||
        !item.variants.length ||
        item.variants.some(
          (variant) =>
            variant.status === "queued" || variant.status === "processing",
        ) ||
        releasedSourceFilesRef.current.has(item.fileId)
      ) {
        return;
      }

      releasedSourceFilesRef.current.add(item.fileId);
      void releaseStagedQueuedImageFile(item.fileId).then((released) => {
        if (!released) {
          releasedSourceFilesRef.current.delete(item.fileId);
        }
      });
    });
  }, [items]);

  React.useEffect(() => {
    setCompareLeftAssetId((current) =>
      current && compareAssets.some((asset) => asset.id === current)
        ? current
        : compareAssets[0]?.id || null,
    );
    setCompareRightAssetId((current) =>
      current && compareAssets.some((asset) => asset.id === current)
        ? current
        : compareAssets[1]?.id || compareAssets[0]?.id || null,
    );
  }, [compareAssets]);

  React.useEffect(() => {
    isUnmountedRef.current = false;
    const timerMap = timersRef.current;
    return () => {
      isUnmountedRef.current = true;
      metricsRequestsRef.current = {};
      releasedSourceFilesRef.current.clear();
      void flushCompressedCountNow();
      Object.values(timerMap).forEach((timer) => window.clearInterval(timer));
      Object.values(compareSourceUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
      compareSourceUrlsRef.current = {};
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        void deleteQueuedImageFile(item.fileId);
        item.variants.forEach((variant) => {
          if (variant.outputUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(variant.outputUrl);
          }
        });
      });
    };
  }, []);

  const enqueueFiles = React.useCallback(
    async (fileList: FileList | File[]) => {
      const inputFiles = Array.from(fileList);
      const tooLargeFiles: File[] = [];

      const nextFiles = inputFiles.filter((file) => {
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (
          !ALLOWED_TYPES.has(file.type) &&
          (!extension || !ALLOWED_EXTENSIONS.has(extension))
        ) {
          return false;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          tooLargeFiles.push(file);
          return false;
        }
        return true;
      });

      if (!nextFiles.length && !tooLargeFiles.length) {
        return;
      }

      const processableItemCount = itemsRef.current.filter(
        (item) => !item.rejection,
      ).length;
      const remain = MAX_FILES - processableItemCount;

      try {
        const acceptedFiles = nextFiles.slice(0, Math.max(0, remain));
        const nextItems = acceptedFiles.map((file) =>
          createItem(file, selectedFormats),
        );
        const rejectedItems = tooLargeFiles.map(createRejectedItem);
        const optimisticItems = [
          ...itemsRef.current,
          ...nextItems,
          ...rejectedItems,
        ];
        itemsRef.current = optimisticItems;
        setItems(optimisticItems);

        nextItems.forEach((item, index) => {
          const file = acceptedFiles[index];
          void storeQueuedImageFile(item.fileId, file).catch((error) => {
            if (IS_DEV) {
              console.warn("Failed to persist queued image", error);
            }
          });

          void createPreviewUrl(file).then((previewUrl) => {
            if (
              isUnmountedRef.current ||
              !itemsRef.current.some((current) => current.id === item.id)
            ) {
              URL.revokeObjectURL(previewUrl);
              return;
            }
            setItems((prev) =>
              prev.map((current) =>
                current.id === item.id
                  ? { ...current, previewUrl }
                  : current,
              ),
            );
            window.requestAnimationFrame(() => {
              URL.revokeObjectURL(item.previewUrl);
            });
          });
        });
      } catch (error) {
        if (IS_DEV) console.error("Failed to enqueue images:", error);
      }
    },
    [selectedFormats],
  );

  const loadCompressionHandoff = React.useCallback(() => {
    void consumeFilesForCompression()
      .then((files) => {
        if (files.length) return enqueueFiles(files);
      })
      .catch((error) => {
        if (IS_DEV) console.warn("Failed to load compression handoff", error);
      });
  }, [enqueueFiles]);

  React.useEffect(() => {
    loadCompressionHandoff();
    window.addEventListener(COMPRESSION_HANDOFF_EVENT, loadCompressionHandoff);
    return () =>
      window.removeEventListener(
        COMPRESSION_HANDOFF_EVENT,
        loadCompressionHandoff,
      );
  }, [loadCompressionHandoff]);

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
    const runningFileIds = new Set<string>();
    const runningAvif = new Set<string>();
    const runningWebp = new Set<string>();

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

        let sourceFile: File | null = null;
        try {
          sourceFile = await getQueuedImageFile(currentItem.fileId);
          if (!sourceFile) {
            throw new Error("Source image is no longer available");
          }

          const compressed = await compressWithWasmWorker(
            sourceFile,
            80,
            currentVariant.format,
            Boolean(currentVariant.allowAlphaLoss),
            Boolean(currentVariant.automatic),
          );
          if (isUnmountedRef.current) {
            return;
          }

          stopFakeProgress(currentItem.id, currentVariant.id);
          const outputUrl = URL.createObjectURL(compressed.blob);
          const outputSize = compressed.blob.size;
          const percent =
            Math.round(
              (((outputSize - currentItem.fileSize) / currentItem.fileSize) *
                100 *
                10),
            ) / 10;
          reportCompressionResult(
            normalizeOutputFormat(compressed.ext),
            currentItem.fileSize,
            outputSize,
          );
          setTotalCompressedCount((prev) => prev + 1);

          try {
            await storeCompressedImage({
              id: `${currentItem.id}:${currentVariant.id}`,
              sourceId: currentItem.id,
              sourceName: currentItem.fileName,
              sourceSize: currentItem.fileSize,
              name: compressed.fileName,
              type: compressed.blob.type,
              format: normalizeOutputFormat(compressed.ext),
              size: outputSize,
              blob: compressed.blob,
              createdAt: Date.now(),
            });
          } catch (error) {
            if (IS_DEV) console.warn("Failed to cache compressed image", error);
          }

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
          if (sourceFile) {
            logCompressionFailure(sourceFile, currentVariant.format, error);
          } else if (IS_DEV) {
            console.error(
              `[PicBind][${currentVariant.format.toUpperCase()}][FAILED] ${currentItem.fileName}`,
              error,
            );
          }
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
            .sort((left, right) => left.item.fileSize - right.item.fileSize)
            .find(({ item, variant }) => {
              if (variant.status !== "queued") {
                return false;
              }
              const key = `${item.id}:${variant.id}`;
              if (claimed.has(key) || running.has(key)) {
                return false;
              }
              if (runningFileIds.has(item.fileId)) {
                return false;
              }
              if (
                (variant.format === "avif" || variant.automatic) &&
                runningAvif.size >= MAX_CONCURRENT_AVIF_COMPRESSIONS
              ) {
                return false;
              }
              if (
                variant.format === "webp" &&
                runningWebp.size >= MAX_CONCURRENT_WEBP_COMPRESSIONS
              ) {
                return false;
              }
              return true;
            });

          if (!nextTask) {
            break;
          }

          const key = `${nextTask.item.id}:${nextTask.variant.id}`;
          claimed.add(key);
          runningFileIds.add(nextTask.item.fileId);
          if (
            nextTask.variant.format === "avif" ||
            nextTask.variant.automatic
          ) {
            runningAvif.add(key);
          }
          if (nextTask.variant.format === "webp") {
            runningWebp.add(key);
          }
          const job = runOne(nextTask.item, nextTask.variant).finally(() => {
            running.delete(key);
            claimed.delete(key);
            runningFileIds.delete(nextTask.item.fileId);
            runningAvif.delete(key);
            runningWebp.delete(key);
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
    () =>
      [...items].sort((a, b) => {
        if (Boolean(a.rejection) !== Boolean(b.rejection)) {
          return a.rejection ? 1 : -1;
        }
        return b.updatedAt - a.updatedAt;
      }),
    [items],
  );
  const completedCount = completedItems.length;
  const totalOriginalSize = completedItems.reduce(
    (sum, item) => sum + item.fileSize,
    0,
  );
  const totalCompressedSize = completedItems.reduce(
    (sum, item) =>
      sum + (getBestDoneVariant(item)?.outputSize || item.fileSize),
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

  const handleUseAutomaticFormat = () => {
    setShowFormatOptions(false);
    setSelectedFormats([]);
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

  const handleDownloadZip = () => {
    SystemManager.downloadZip(
      zipItems,
      `picbind-images-${SystemManager.getNowformatTime()}.zip`,
    );
  };

  const addVariantToCompare = React.useCallback(
    async (item: HomeItem, variant: OutputVariant) => {
      if (
        !homeAllowCompareSelection ||
        variant.status !== "done" ||
        !variant.outputUrl
      ) {
        return;
      }

      const sourceAssetId = `${item.id}:original`;
      let sourceUrl = compareSourceUrlsRef.current[item.id];
      if (!sourceUrl) {
        const sourceFile = await getQueuedImageFile(item.fileId);
        if (!sourceFile || isUnmountedRef.current) {
          return;
        }
        sourceUrl = URL.createObjectURL(sourceFile);
        compareSourceUrlsRef.current[item.id] = sourceUrl;
      }

      const originalAsset: CompareAsset = {
        id: sourceAssetId,
        itemId: item.id,
        label: `${item.fileName} · ORIGINAL`,
        src: sourceUrl,
        size: item.fileSize,
        format: item.sourceFormat,
        kind: "original",
      };
      const outputAsset: CompareAsset = {
        id: `${item.id}:${variant.id}`,
        itemId: item.id,
        variantId: variant.id,
        label: `${item.fileName} · ${variant.format.toUpperCase()}`,
        src: variant.outputUrl,
        size: variant.outputSize || 0,
        format: variant.format,
        kind: "output",
      };

      setCompareAssets([originalAsset, outputAsset]);
      setCompareLeftAssetId(originalAsset.id);
      setCompareRightAssetId(outputAsset.id);
    },
    [homeAllowCompareSelection],
  );

  return {
    langReady,
    copy,
    lang,
    inputRef,
    isDragging,
    setIsDragging,
    showFormatOptions,
    setShowFormatOptions,
    selectedFormats,
    formatOptions,
    handleSwitchLang,
    handleDrop,
    handleToggleFormat,
    handleUseAutomaticFormat,
    handleSelectAllFormats,
    enqueueFiles,
    sortedItems,
    hasPendingItems,
    totalSavedPercent,
    completedCount,
    totalSavedBytes,
    zipItems,
    whyVariantId,
    setWhyVariantId,
    metricsVariantId,
    setMetricsVariantId,
    loadVariantMetrics,
    handleConvertAnyway,
    handleDownloadZip,
    compareCopy,
    homeShowCompareSection,
    homeAllowCompareSelection,
    homeShowQualityMetrics,
    compareSectionReady,
    compareCompressedSrc,
    compareSizes,
    compareAssets,
    compareLeftAssetId,
    compareRightAssetId,
    addVariantToCompare,
    homeShowCompressedCount,
    displayedCompressedCount,
    isCountBouncing,
  };
}
