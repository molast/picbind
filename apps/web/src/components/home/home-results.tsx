"use client";

import React from "react";
import { FiColumns, FiLock } from "react-icons/fi";
import {
  extToBadge,
  formatDeltaPercent,
  formatMetricPercent,
  formatMetricRatio,
  formatSize,
  getActiveVariant,
  getBestDoneVariant,
  getDoneVariants,
  isTransparencyBlocked,
  type HomeItem,
  type CompareAsset,
  type OutputVariant,
} from "./home-compression-types";
import type { HomeCompressLandingCopy, Lang } from "@/locales";
import SystemManager from "@/utils/System";

type HomeResultsProps = {
  copy: HomeCompressLandingCopy;
  items: HomeItem[];
  hasPendingItems: boolean;
  totalSavedPercent: number;
  completedCount: number;
  totalSavedBytes: number;
  canDownloadZip: boolean;
  whyVariantId: string | null;
  metricsVariantId: string | null;
  lang: Lang;
  allowCompareSelection: boolean;
  showQualityMetrics: boolean;
  compareAssets: CompareAsset[];
  onDownloadZip(): void;
  onWhyVariantChange: React.Dispatch<React.SetStateAction<string | null>>;
  onMetricsVariantChange: React.Dispatch<React.SetStateAction<string | null>>;
  onLoadVariantMetrics(item: HomeItem, variant: OutputVariant): void | Promise<void>;
  onConvertAnyway(itemId: string, variantId: string): void;
  onAddVariantToCompare(item: HomeItem, variant: OutputVariant): void | Promise<void>;
};

export default function HomeResults({
  copy,
  items,
  hasPendingItems,
  totalSavedPercent,
  completedCount,
  totalSavedBytes,
  canDownloadZip,
  whyVariantId,
  metricsVariantId,
  lang,
  allowCompareSelection,
  showQualityMetrics,
  compareAssets,
  onDownloadZip,
  onWhyVariantChange,
  onMetricsVariantChange,
  onLoadVariantMetrics,
  onConvertAnyway,
  onAddVariantToCompare,
}: HomeResultsProps) {
  const blockedCopy = copy.errorOverlay;
  const metricsCopy = copy.metricsOverlay;
  return (
    <>
      {items.length > 0 && (
        <section className="relative z-10 mx-auto -mt-8 w-full max-w-[1100px] px-4 pb-20 md:-mt-12">
          <div className="overflow-visible rounded-[18px] border border-[#c4d8fb] bg-[rgba(237,244,255,0.88)] text-[#334a72] shadow-[0_18px_48px_rgba(78,120,193,0.2)] backdrop-blur">
            {(hasPendingItems || completedCount > 0) && (
              <div className="flex flex-col gap-5 border-b border-[#c9dbfb] px-6 py-5 md:flex-row md:items-start md:justify-between">
                <div className="max-w-3xl">
                  <h3 className="text-[30px] font-semibold leading-tight text-[#2f4b7d]">
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
                    disabled={!canDownloadZip}
                    onClick={onDownloadZip}
                    className="rounded-xl bg-[#3f80ea] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#356fd0] disabled:cursor-not-allowed disabled:bg-[#9ab3d8] disabled:text-[#eef4ff]"
                  >
                    {copy.downloadZip}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-[rgba(248,251,255,0.9)] text-[#3b4a62]">
              {items.map((item) => {
                if (item.rejection === "file-too-large") {
                  return (
                    <div
                      key={item.id}
                      className="flex min-h-[84px] flex-col gap-3 border-t border-[#d6e3f9] bg-white px-5 py-3 first:border-t-0 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#4a4f59] ring-1 ring-[#eceef1]">
                          <FiLock aria-hidden="true" className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-[#a0a3aa]">
                            {item.fileName}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[12px] text-[#9b9ea5]">
                            <span className="rounded-md bg-[#f7f5ff] px-2 py-0.5 font-semibold uppercase text-[#a691e8]">
                              {item.sourceFormat}
                            </span>
                            <span>{formatSize(item.fileSize)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="sm:w-[48%] sm:text-center">
                        <div className="text-[15px] font-semibold text-[#3f434c]">
                          {copy.uploadNotice.fileTooLargeTitle}
                        </div>
                        <div className="mt-0.5 text-[13px] text-[#5f626b]">
                          {copy.uploadNotice.fileTooLargeDescription}
                        </div>
                      </div>
                    </div>
                  );
                }
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
                    className="flex min-h-[84px] items-center gap-2.5 border-t border-[#d6e3f9] px-5 py-2.5 first:border-t-0"
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[#eaf1ff] ring-1 ring-[#cdddf7]">
                      {/* Blob preview URLs cannot use the Next image optimizer. */}
                      <img
                        src={item.previewUrl}
                        alt={item.fileName}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold leading-none text-[#41557a]">
                            {item.fileName}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#6c7f9f]">
                            <span className="inline-flex rounded-md bg-[#e2eeff] px-2 py-0.5 text-[12px] font-semibold uppercase leading-none text-[#2f6ccc]">
                              {item.sourceFormat.toUpperCase()}
                            </span>
                            <span>{formatSize(item.fileSize)}</span>
                          </div>
                        </div>
                        <div className="flex flex-row-reverse flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                          {rankedVariants.map((variant) => {
                            const toneClass =
                              variant.status === "done"
                                ? "border-transparent bg-[#e5efff] text-[#45608d]"
                                : variant.status === "error"
                                  ? "border-[#ffd9d4] bg-[#fff1ef] text-[#d14332]"
                                  : variant.status === "processing"
                                    ? "border-transparent bg-[#edf4ff] text-[#3a7ce6]"
                                    : "border-transparent bg-[#eef3fb] text-[#61779e]";

                            const accentClass =
                              variant.format === "jpeg"
                                ? "text-[#2f6ccc]"
                                : variant.format === "png"
                                  ? "text-[#2a7de1]"
                                  : variant.format === "webp"
                                    ? "text-[#6d4fe0]"
                                    : "text-[#61779e]";

                            const detail =
                              variant.status === "done"
                                ? `${formatSize(variant.outputSize || 0)}`
                                : variant.status === "processing"
                                  ? copy.optimizing
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
                                    <span className="absolute -right-2 -top-2 z-30 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#3f80ea] text-[12px] font-bold text-white shadow-sm">
                                      ✓
                                    </span>
                                  )}
                                {variant.status === "done" ? (
                                  <>
                                    <div className="min-w-[52px] text-right">
                                      <div className="text-[14px] font-semibold leading-none text-[#41557a]">
                                        {formatDeltaPercent(variant.percent)}
                                      </div>
                                      <div className="mt-0.5 text-[10px] leading-none text-[#6f82a4]">
                                        {detail}
                                      </div>
                                    </div>
                                    {variant.outputUrl && (
                                      <div
                                        className="relative"
                                        onMouseEnter={
                                          showQualityMetrics
                                            ? () => {
                                                onMetricsVariantChange(variant.id);
                                                void onLoadVariantMetrics(
                                                  item,
                                                  variant,
                                                );
                                              }
                                            : undefined
                                        }
                                        onMouseLeave={
                                          showQualityMetrics
                                            ? () =>
                                                onMetricsVariantChange((prev) =>
                                                  prev === variant.id ? null : prev,
                                                )
                                            : undefined
                                        }
                                      >
                                        <div className="flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => void SystemManager.downloadImage(
                                              variant.outputUrl!,
                                              variant.outputName || item.fileName,
                                            )}
                                            className={`inline-flex items-center gap-1.5 rounded-[14px] bg-[#dde9ff] px-2.5 py-1 text-[11px] font-semibold ${accentClass}`}
                                          >
                                            <span className="text-[11px]">⬇</span>
                                            <span>
                                              {extToBadge(variant.outputExt)}
                                            </span>
                                          </button>
                                          {allowCompareSelection && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                void onAddVariantToCompare(
                                                  item,
                                                  variant,
                                                )
                                              }
                                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                                                compareAssets.some(
                                                  (asset) =>
                                                    asset.variantId ===
                                                      variant.id &&
                                                    asset.itemId === item.id,
                                                )
                                                  ? "bg-[#3f80ea] text-white"
                                                  : "bg-[#dde9ff] text-[#5374a8] hover:bg-[#cbdfff]"
                                              }`}
                                              title={
                                                lang === "zh"
                                                  ? "加入图片对比"
                                                  : "Add to image comparison"
                                              }
                                              aria-label={
                                                lang === "zh"
                                                  ? "加入图片对比"
                                                  : "Add to image comparison"
                                              }
                                            >
                                              <FiColumns
                                                aria-hidden="true"
                                                className="h-3.5 w-3.5"
                                              />
                                            </button>
                                          )}
                                        </div>
                                        {showQualityMetrics &&
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
                                        onWhyVariantChange(variant.id)
                                      }
                                      onMouseLeave={() =>
                                        onWhyVariantChange((prev) =>
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
                                          onWhyVariantChange((prev) =>
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
                                                  onConvertAnyway(
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
                                      {variant.automatic
                                        ? "auto"
                                        : variant.format}
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
                            ? "h-[2px] bg-[#dce8fb]"
                            : "h-px bg-[#d6e3f9]"
                        }`}
                      >
                        <div
                          className={`transition-all duration-300 ${
                            hasInFlightVariant
                              ? activeProgress <= 0
                                ? "h-[2px] bg-[#4b86e8] transition-none"
                                : "h-[2px] bg-[#4b86e8]"
                              : "h-px bg-[#8aa4cf]"
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

    </>
  );
}
