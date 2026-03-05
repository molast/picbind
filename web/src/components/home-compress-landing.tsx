"use client";

import React from "react";
import { getLang, setLang as persistLang, type Lang } from "@/locales";
import { useStore } from "@/stores";
import SystemManager from "@/utils/System";
import { compressWithWasmWorker, terminateCompressionWorker } from "@/utils/wasm-worker";
import type { OutputFormat } from "@/utils/wasm";

const MAX_FILES = 20;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type VariantStatus = "queued" | "processing" | "done" | "error";

type OutputVariant = {
  id: string;
  format: OutputFormat;
  outputUrl?: string;
  outputName?: string;
  outputExt?: string;
  outputSize?: number;
  percent?: number;
  progress: number;
  status: VariantStatus;
  errorMessage?: string;
};

type HomeItem = {
  id: string;
  file: File;
  previewUrl: string;
  variants: OutputVariant[];
};

const formatSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
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

function createVariant(format: OutputFormat): OutputVariant {
  return {
    id: `${format}-${crypto.randomUUID()}`,
    format,
    progress: 0,
    status: "queued",
  };
}

function ensureVariants(item: HomeItem, selectedFormats: OutputFormat[]) {
  const wantedFormats = Array.from(
    new Set<OutputFormat>([normalizeSourceFormat(item.file), ...selectedFormats]),
  );
  const existingFormats = new Set(item.variants.map((variant) => variant.format));
  const missingVariants = wantedFormats
    .filter((format) => !existingFormats.has(format))
    .map(createVariant);

  if (!missingVariants.length) {
    return item;
  }

  return {
    ...item,
    variants: [...item.variants, ...missingVariants],
  };
}

function createItem(file: File, selectedFormats: OutputFormat[]): HomeItem {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    file,
    previewUrl: URL.createObjectURL(file),
    variants: ensureVariants(
      {
        id: "",
        file,
        previewUrl: "",
        variants: [],
      },
      selectedFormats,
    ).variants,
  };
}

function getActiveVariant(item: HomeItem) {
  return (
    item.variants.find((variant) => variant.status === "processing") ||
    item.variants.find((variant) => variant.status === "queued")
  );
}

function getBestDoneVariant(item: HomeItem) {
  return item.variants
    .filter((variant) => variant.status === "done" && typeof variant.outputSize === "number")
    .sort((left, right) => (left.outputSize || 0) - (right.outputSize || 0))[0];
}

function getDoneVariants(item: HomeItem) {
  return item.variants.filter(
    (variant) => variant.status === "done" && typeof variant.outputSize === "number",
  );
}

function isTransparencyBlocked(errorMessage?: string) {
  return Boolean(errorMessage && /transparen/i.test(errorMessage));
}

function formatDeltaPercent(percent?: number) {
  if (typeof percent !== "number") {
    return "0%";
  }
  if (percent > 0) {
    return `+${percent}%`;
  }
  return `${percent}%`;
}

export default function HomeCompressLanding() {
  const { setToken } = useStore();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const itemsRef = React.useRef<HomeItem[]>([]);
  const timersRef = React.useRef<Record<string, number>>({});
  const isUnmountedRef = React.useRef(false);
  const [items, setItems] = React.useState<HomeItem[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isCompressing, setIsCompressing] = React.useState(false);
  const [lang, setLang] = React.useState<Lang>("zh");
  const [showFormatOptions, setShowFormatOptions] = React.useState(false);
  const [selectedFormats, setSelectedFormats] = React.useState<OutputFormat[]>([]);
  const isZh = lang === "zh";

  const copy = React.useMemo(
    () => ({
      heroKicker: isZh ? "智能图片压缩" : "Smart Image Compression",
      heroTitle: isZh ? "一次上传，自动压缩 PNG、JPEG、WebP 和 AVIF" : "Upload once, compress PNG, JPEG, WebP and AVIF automatically",
      heroDesc: isZh
        ? "像 TinyPNG 一样直接开始处理图片，首页完成上传、压缩、下载，尽量减少跳转和流失。"
        : "Start compressing like TinyPNG: upload, optimize and download from one focused homepage without extra steps.",
      dropTitle: isZh ? "将图片拖到这里开始压缩" : "Drop your images here!",
      dropDesc: isZh ? "最多 20 张图片，单张不超过 5 MB" : "Up to 20 images, max 5 MB each.",
      dropAction: isZh ? "选择图片" : "Select images",
      autoLabel: isZh ? "上传后自动开始压缩" : "Convert my images automatically",
      selectAll: isZh ? "全选" : "SELECT ALL",
      processingTitle: isZh
        ? "图片正在优化中，请稍等片刻，我们会尽快给出这一批图片更合适的压缩结果。"
        : "Your images are being processed now. Give us a moment to finish a cleaner, lighter result set.",
      completedTitle: (savedPercent: number, done: number, totalSaved: string) =>
        isZh
          ? `这次压缩共节省 ${savedPercent}% · 已优化 ${done} 张图片 · 共减少 ${totalSaved}`
          : `Compression finished. Saved ${savedPercent}% across ${done} image${done === 1 ? "" : "s"} with ${totalSaved} reduced in total.`,
      optimizing: isZh ? "压缩中..." : "Optimizing...",
      queued: isZh ? "排队中" : "Queued",
      failed: isZh ? "压缩失败" : "Failed",
      download: isZh ? "下载" : "Download",
      downloadZip: isZh ? "打包下载 ZIP" : "Download ZIP",
      origin: isZh ? "原始大小" : "Original",
      output: isZh ? "压缩后" : "Compressed",
      saved: isZh ? "节省" : "Saved",
      sourceFormat: isZh ? "原格式" : "Source",
      targetFormat: isZh ? "目标格式" : "Target",
      transparencyBlocked: isZh
        ? "原图包含透明图层，不能直接转换为 JPEG"
        : "The source image contains transparency, so JPEG output is blocked.",
      unsupportedFormat: isZh ? "当前格式暂不支持" : "This format is not supported yet",
      features: isZh
        ? ["更轻的图片结果", "自动选择更优输出格式", "支持 AVIF 压缩"]
        : ["Lighter image delivery", "Smarter output format selection", "AVIF compression supported"],
      sectionEyebrow: isZh ? "更快的图片交付" : "Faster image delivery",
      sectionTitle: isZh ? "为网页、运营素材和内容站点准备的轻量压缩入口" : "A lightweight compression entry for websites, campaigns and content teams",
      sectionDesc: isZh
        ? "上传后立即开始处理，自动给出更轻的 PNG、JPEG、WebP 或 AVIF 结果。"
        : "Start processing immediately after upload and get lighter PNG, JPEG, WebP or AVIF outputs.",
      cards: isZh
        ? [
            {
              title: "更轻的页面资源",
              desc: "优先压缩常见网页图片，减少首屏加载压力和带宽消耗。",
            },
            {
              title: "自动挑选更优结果",
              desc: "按图片内容尝试更合适的输出格式，支持 PNG、JPEG、WebP 和 AVIF。",
            },
            {
              title: "适合批量整理素材",
              desc: "单张下载和 ZIP 打包都保留，适合一次处理多张图片后集中交付。",
            },
          ]
        : [
            {
              title: "Lighter page assets",
              desc: "Compress common web images to reduce initial load pressure and bandwidth usage.",
            },
            {
              title: "Smarter output selection",
              desc: "Choose a more suitable output format per image across PNG, JPEG, WebP and AVIF.",
            },
            {
              title: "Ready for batch asset cleanup",
              desc: "Keep both single-file download and ZIP export for grouped delivery after bulk compression.",
            },
          ],
    }),
    [isZh],
  );

  React.useEffect(() => {
    setLang(getLang());
    const apiKeyFromEnv = process.env.NEXT_PUBLIC_API_KEY;
    if (apiKeyFromEnv) {
      setToken(apiKeyFromEnv);
    }
  }, [setToken]);

  React.useEffect(() => {
    document.title = isZh ? "图片压缩" : "Image Compression";
  }, [isZh]);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      const timerMap = timersRef.current;
      isUnmountedRef.current = true;
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

  const enqueueFiles = React.useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList).filter((file) => ALLOWED_TYPES.has(file.type));
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
        ...nextFiles.slice(0, remain).map((file) => createItem(file, selectedFormats)),
      ];
    });
  }, [selectedFormats]);

  React.useEffect(() => {
    if (!items.length) {
      return;
    }

    setItems((prev) => prev.map((item) => ensureVariants(item, selectedFormats)));
  }, [items.length, selectedFormats]);

  const startFakeProgress = React.useCallback((itemId: string, variantId: string) => {
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
                  if (variant.id !== variantId || variant.status !== "processing") {
                    return variant;
                  }
                  const target = 98;
                  const remaining = Math.max(0, target - variant.progress);
                  const step = Math.max(0.4, remaining * (0.08 + Math.random() * 0.07));
                  const nextProgress = Math.min(variant.progress + step, target);
                  return { ...variant, progress: nextProgress };
                }),
              },
        ),
      );
    }, 180);
  }, []);

  const stopFakeProgress = React.useCallback((itemId: string, variantId: string) => {
    const timerKey = `${itemId}:${variantId}`;
    if (timersRef.current[timerKey]) {
      window.clearInterval(timersRef.current[timerKey]);
      delete timersRef.current[timerKey];
    }
  }, []);

  const processQueue = React.useCallback(async () => {
    if (isCompressing) {
      return;
    }

    setIsCompressing(true);
    try {
      while (!isUnmountedRef.current) {
        const currentItem = itemsRef.current.find((item) =>
          item.variants.some((variant) => variant.status === "queued"),
        );
        const currentVariant = currentItem?.variants.find(
          (variant) => variant.status === "queued",
        );

        if (!currentItem || !currentVariant) {
          break;
        }

        setItems((prev) =>
          prev.map((item) =>
            item.id === currentItem.id
              ? {
                  ...item,
                  variants: item.variants.map((variant) =>
                    variant.id === currentVariant.id
                      ? {
                          ...variant,
                          status: "processing",
                          progress: Math.max(variant.progress, 8),
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
          );
          if (isUnmountedRef.current) {
            break;
          }

          stopFakeProgress(currentItem.id, currentVariant.id);
          const outputUrl = URL.createObjectURL(compressed.blob);
          const outputSize = compressed.blob.size;
          const percent = Math.round(
            ((outputSize - currentItem.file.size) / currentItem.file.size) * 100,
          );

          setItems((prev) =>
            prev.map((item) =>
              item.id === currentItem.id
                ? {
                    ...item,
                    variants: item.variants.map((variant) =>
                      variant.id === currentVariant.id
                        ? {
                            ...variant,
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
          stopFakeProgress(currentItem.id, currentVariant.id);
          setItems((prev) =>
            prev.map((item) =>
              item.id === currentItem.id
                ? {
                    ...item,
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
      items.some((item) => item.variants.some((variant) => variant.status === "queued"))
    ) {
      processQueue();
    }
  }, [isCompressing, items, processQueue]);

  const completedItems = items.filter((item) =>
    item.variants.some((variant) => variant.status === "done"),
  );
  const completedCount = completedItems.length;
  const totalOriginalSize = completedItems.reduce((sum, item) => sum + item.file.size, 0);
  const totalCompressedSize = completedItems.reduce(
    (sum, item) => sum + (getBestDoneVariant(item)?.outputSize || item.file.size),
    0,
  );
  const totalSavedBytes = Math.max(0, totalOriginalSize - totalCompressedSize);
  const totalSavedPercent = totalOriginalSize > 0 ? Math.max(0, Math.round((totalSavedBytes / totalOriginalSize) * 100)) : 0;
  const hasPendingItems = items.some((item) =>
    item.variants.some((variant) => variant.status === "queued" || variant.status === "processing"),
  );
  const zipItems = completedItems.flatMap((item) =>
    item.variants
      .filter((variant) => variant.status === "done" && variant.outputUrl && variant.outputName)
      .map((variant) => ({ name: variant.outputName!, url: variant.outputUrl! })),
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
      prev.length === formatOptions.length ? [] : formatOptions.map((item) => item.key),
    );
  };

  return (
    <main className="w-full bg-[#ececec] text-slate-800">
      <section className="relative overflow-hidden bg-[#78956b]">
        <div className="absolute inset-0 bg-[url('/images/bamboo.avif')] bg-cover bg-left-center bg-no-repeat" />
        <div className="absolute inset-y-0 right-0 hidden w-[38%] bg-[url('/images/bamboo-panda.avif')] bg-contain bg-right-bottom bg-no-repeat lg:block" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(22,40,20,0.36),rgba(76,102,59,0.12)_40%,rgba(236,244,216,0.16)_100%)]" />

        <div className="relative mx-auto flex h-[720px] max-w-[1440px] flex-col overflow-hidden px-6 pb-20 pt-5 lg:h-[700px] lg:px-10">
          <header className="flex items-center justify-end bg-white/92 px-4 py-3 shadow-[0_16px_50px_rgba(26,34,24,0.12)] backdrop-blur md:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSwitchLang("zh")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${lang === "zh" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => handleSwitchLang("en")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${lang === "en" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                EN
              </button>
            </div>
          </header>

          <div className="relative z-10 flex flex-1 justify-center pt-20 lg:pt-24">
            <div className="grid w-full items-start gap-10 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="max-w-xl text-white drop-shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                <p className="text-sm font-semibold uppercase tracking-[0.36em] text-white/80">{copy.heroKicker}</p>
                <h1 className="mt-5 font-sans text-4xl font-semibold leading-tight md:text-6xl">
                  {copy.heroTitle}
                </h1>
                <p className="mt-5 max-w-lg text-base leading-7 text-white/90 md:text-lg">
                  {copy.heroDesc}
                </p>
                <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/95">
                  {copy.features.map((feature) => (
                    <span key={feature} className="rounded-full border border-white/20 bg-white/12 px-4 py-2 backdrop-blur-sm">
                      {feature}
                    </span>
                  ))}
                </div>
              </div>

              <div className="w-full max-w-[640px] justify-self-center lg:translate-x-[-2%]">
                <div
                  onDragEnter={() => setIsDragging(true)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`rounded-[30px] bg-[rgba(108,119,95,0.78)] p-4 shadow-[0_22px_60px_rgba(24,32,24,0.24)] backdrop-blur-sm transition ${isDragging ? "scale-[1.01] ring-2 ring-white/60" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex w-full flex-col items-center rounded-[26px] border-[3px] border-dashed border-white/75 px-6 py-10 text-center text-white transition hover:bg-white/5"
                  >
                    <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[22px] bg-[linear-gradient(135deg,#4482d6,#143c88)] text-4xl shadow-[0_16px_24px_rgba(7,33,79,0.4)]">
                      ⬇
                    </div>
                    <h2 className="text-[28px] font-semibold leading-none md:text-[30px]">{copy.dropTitle}</h2>
                    <p className="mt-4 text-[14px] font-medium text-white/85 md:text-[15px]">{copy.dropDesc}</p>
                    <span className="mt-8 rounded-full bg-white px-7 py-2 text-[14px] font-semibold text-slate-700">
                      {copy.dropAction}
                    </span>
                  </button>
                  <div className="mt-4 overflow-hidden rounded-[24px] bg-[rgba(246,246,243,0.96)]">
                    <div className="flex items-center gap-3 px-5 py-4 text-[13px] text-slate-600 md:text-[14px]">
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
                        showFormatOptions ? "max-h-24 border-t border-[#e2e6d8]" : "max-h-0 border-t-0"
                      }`}
                    >
                      <div
                        className={`flex min-h-[60px] flex-wrap items-center gap-2 px-4 py-3 transition-opacity duration-150 md:flex-nowrap ${
                          showFormatOptions ? "opacity-100" : "pointer-events-none opacity-0"
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
                              {active && <span className="mr-2 text-lime-500">✓</span>}
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
          <div className="overflow-hidden rounded-[14px] bg-[#4a4f5d] text-white shadow-[0_22px_50px_rgba(40,42,52,0.25)]">
            <div className="flex flex-col gap-5 px-6 py-5 md:flex-row md:items-start md:justify-between">
              <div className="max-w-3xl">
                <h3 className="text-2xl font-semibold text-lime-300">
                  {hasPendingItems
                    ? copy.processingTitle
                    : copy.completedTitle(totalSavedPercent, completedCount, formatSize(totalSavedBytes))}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!zipItems.length}
                  onClick={() =>
                    SystemManager.downloadZip(
                      zipItems,
                      `compressed-images-${SystemManager.getNowformatTime()}.zip`,
                    )
                  }
                  className="rounded-xl bg-lime-300 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
                >
                  {copy.downloadZip}
                </button>
              </div>
            </div>

            <div className="bg-[#f3f3f3] text-slate-700">
              {items.map((item) => {
                const bestVariant = getBestDoneVariant(item);
                const doneVariants = getDoneVariants(item);
                const rankedVariants = [...item.variants].sort((left, right) => {
                  const leftPercent = left.status === "done" ? left.percent ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
                  const rightPercent = right.status === "done" ? right.percent ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
                  return leftPercent - rightPercent;
                });

                return (
                <div key={item.id} className="flex min-h-[84px] items-center gap-2.5 border-t border-[#d9d9d9] px-5 py-2.5 first:border-t-0">
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-slate-200 ring-1 ring-slate-200">
                    <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
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
                                : isTransparencyBlocked(variant.errorMessage)
                                  ? copy.transparencyBlocked
                                  : variant.errorMessage || copy.unsupportedFormat;

                          return (
                            <div
                              key={variant.id}
                              className="relative flex items-center gap-2"
                            >
                              {variant.status === "done" && bestVariant?.id === variant.id && doneVariants.length > 1 && (
                                <span className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#82c341] text-[12px] font-bold text-white shadow-sm">
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
                                    <a
                                      href={variant.outputUrl}
                                      download={variant.outputName || item.file.name}
                                      className={`inline-flex items-center gap-1.5 rounded-[14px] bg-[#dfe5ea] px-2.5 py-1 text-[11px] font-semibold ${accentClass}`}
                                    >
                                      <span className="text-[11px]">⬇</span>
                                      <span>{extToBadge(variant.outputExt)}</span>
                                    </a>
                                  )}
                                </>
                              ) : (
                                <>
                                  <div className={`rounded-[14px] px-2.5 py-1 text-[11px] font-semibold uppercase ${toneClass} ${accentClass}`}>
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
                        item.variants.some((variant) => variant.status !== "done" && variant.status !== "error")
                          ? "h-[4px] bg-[#d7e6c7]"
                          : "h-px bg-[#d4d5d8]"
                      }`}
                    >
                      <div
                        className={`transition-all duration-300 ${
                          item.variants.some((variant) => variant.status !== "done" && variant.status !== "error")
                            ? "h-[4px] bg-[#8cc63f]"
                            : "h-px bg-[#8b909b]"
                        }`}
                        style={{
                          width: `${
                            item.variants.some((variant) => variant.status !== "done" && variant.status !== "error")
                              ? Math.max(getActiveVariant(item)?.progress ?? 0, 6)
                              : 100
                          }%`,
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

      <section className="relative overflow-hidden bg-[#f1f1f1] py-24">
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(241,241,241,0))]" />
        <div className="mx-auto flex max-w-[1180px] flex-col gap-14 px-6 lg:px-10">
          <div className="mx-auto max-w-[980px] text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-600">{copy.sectionEyebrow}</p>
            <h2 className="mt-5 font-sans text-4xl font-semibold leading-tight text-slate-700 md:text-6xl">
              {copy.sectionTitle}
            </h2>
            <p className="mx-auto mt-6 max-w-[920px] text-lg leading-8 text-slate-500 md:text-[22px] md:leading-10">
              {copy.sectionDesc}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {copy.cards.map((card) => (
              <article
                key={card.title}
                className="rounded-[28px] border border-slate-200 bg-white px-7 py-8 shadow-[0_16px_45px_rgba(148,163,184,0.12)]"
              >
                <div className="h-2 w-14 rounded-full bg-[linear-gradient(90deg,#0ea5e9,#22c55e)]" />
                <h3 className="mt-6 text-2xl font-semibold text-slate-700">{card.title}</h3>
                <p className="mt-4 text-base leading-8 text-slate-500">{card.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
