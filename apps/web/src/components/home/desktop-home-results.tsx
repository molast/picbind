"use client";

import React from "react";
import {
  FiAlertCircle,
  FiCheck,
  FiChevronLeft,
  FiChevronRight,
  FiDownload,
  FiLoader,
} from "react-icons/fi";
import type { HomeCompressLandingCopy, Lang } from "@/locales";
import SystemManager from "@/utils/System";
import type { OutputFormat } from "@/utils/compress-shared";
import {
  formatDeltaPercent,
  formatSize,
  getBestDoneVariant,
  isTransparencyBlocked,
  type HomeItem,
  type OutputVariant,
} from "./home-compression-types";

type FormatFilter = "all" | OutputFormat;

type DesktopHomeResultsProps = {
  copy: HomeCompressLandingCopy;
  lang: Lang;
  items: HomeItem[];
  hasPendingItems: boolean;
  completedCount: number;
  totalSavedBytes: number;
  totalSavedPercent: number;
  canDownloadZip: boolean;
  onDownloadZip(): void;
  onConvertAnyway(itemId: string, variantId: string): void;
};

const PAGE_SIZE = 10;
const FILTERS: FormatFilter[] = ["all", "jpeg", "png", "webp", "avif"];

function variantAccent(format: OutputFormat) {
  if (format === "jpeg") return "bg-blue-500";
  if (format === "png") return "bg-emerald-500";
  if (format === "webp") return "bg-violet-500";
  return "bg-amber-500";
}

function VariantResult({
  item,
  variant,
  best,
  copy,
  onConvertAnyway,
}: {
  item: HomeItem;
  variant: OutputVariant;
  best: boolean;
  copy: HomeCompressLandingCopy;
  onConvertAnyway(itemId: string, variantId: string): void;
}) {
  const label = variant.automatic
    ? `AUTO · ${variant.format.toUpperCase()}`
    : variant.format.toUpperCase();

  return (
    <div className="min-w-0 overflow-hidden border-l border-slate-200 pl-2.5 first:border-l-0 first:pl-0">
      <div className="flex h-4 min-w-0 items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${variantAccent(variant.format)}`} />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[10px] font-semibold text-slate-600" title={label}>
          {label}
        </span>
        {best ? (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-emerald-600">
            <FiCheck className="h-3 w-3" aria-hidden="true" />
            {copy.desktop.best}
          </span>
        ) : null}
      </div>

      {variant.status === "done" && variant.outputUrl ? (
        <div className="mt-1 flex h-7 min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate whitespace-nowrap text-[13px] font-semibold text-slate-800">
            {formatSize(variant.outputSize || 0)}
          </span>
          <span className={`shrink-0 whitespace-nowrap text-[10px] font-medium ${(variant.percent || 0) <= 0 ? "text-emerald-600" : "text-amber-600"}`}>
            {formatDeltaPercent(variant.percent)}
          </span>
          <button
            type="button"
            onClick={() => void SystemManager.downloadImage(
              variant.outputUrl!,
              variant.outputName || item.fileName,
            )}
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#2f65cf] transition hover:bg-blue-50"
            aria-label={copy.desktop.downloadResult}
            title={copy.desktop.downloadResult}
          >
            <FiDownload className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : variant.status === "error" ? (
        <div className="mt-1 flex h-7 min-w-0 items-center gap-1.5 text-[10px] text-red-600">
          <FiAlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
            {isTransparencyBlocked(variant.errorMessage)
              ? copy.transparencyBlocked
              : variant.errorMessage || copy.unsupportedFormat}
          </span>
          {isTransparencyBlocked(variant.errorMessage) ? (
            <button
              type="button"
              onClick={() => onConvertAnyway(item.id, variant.id)}
              className="shrink-0 font-semibold text-[#2f65cf] hover:underline"
            >
              {copy.errorOverlay.convertAnyway}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-1 flex h-7 min-w-0 items-center gap-1.5 text-[10px] text-slate-500">
          {variant.status === "processing" ? (
            <FiLoader className="h-3.5 w-3.5 shrink-0 animate-spin text-[#2f65cf]" aria-hidden="true" />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
          )}
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
            {variant.status === "processing" ? copy.optimizing : copy.queued}
          </span>
          <span className="shrink-0 whitespace-nowrap tabular-nums">{Math.round(variant.progress)}%</span>
        </div>
      )}
    </div>
  );
}

export default function DesktopHomeResults({
  copy,
  lang,
  items,
  hasPendingItems,
  completedCount,
  totalSavedBytes,
  totalSavedPercent,
  canDownloadZip,
  onDownloadZip,
  onConvertAnyway,
}: DesktopHomeResultsProps) {
  const [filter, setFilter] = React.useState<FormatFilter>("all");
  const [page, setPage] = React.useState(0);

  const filteredItems = React.useMemo(
    () => filter === "all"
      ? items
      : items.filter((item) => item.variants.some((variant) => variant.format === filter)),
    [filter, items],
  );
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleItems = filteredItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const outputCount = items.reduce((total, item) => total + item.variants.length, 0);

  React.useEffect(() => {
    setPage(0);
  }, [filter]);

  React.useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-[1160px] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]">
      <header className="flex h-[68px] shrink-0 items-center gap-5 border-b border-slate-200 px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-800">{copy.desktop.results}</h2>
            {hasPendingItems ? (
              <FiLoader className="h-4 w-4 animate-spin text-[#2f65cf]" aria-hidden="true" />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {copy.desktop.resultCount(items.length, outputCount)}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase text-slate-400">
              {copy.desktop.totalSaved}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-emerald-600">
              {formatSize(totalSavedBytes)} · {totalSavedPercent}%
            </div>
          </div>
          <button
            type="button"
            disabled={!canDownloadZip}
            onClick={onDownloadZip}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FiDownload className="h-4 w-4" aria-hidden="true" />
            {copy.downloadZip}
          </button>
        </div>
      </header>

      <div className="flex h-11 shrink-0 items-center border-b border-slate-200 bg-slate-50 px-5">
        <div className="flex items-center gap-1" role="tablist" aria-label={copy.desktop.filterByFormat}>
          {FILTERS.map((format) => {
            const active = filter === format;
            const count = format === "all"
              ? items.length
              : items.filter((item) => item.variants.some((variant) => variant.format === format)).length;
            return (
              <button
                key={format}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(format)}
                className={`h-7 rounded-md px-3 text-[11px] font-semibold transition ${
                  active ? "bg-white text-[#2f65cf] shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {format === "all" ? copy.desktop.all : format.toUpperCase()}
                <span className="ml-1.5 text-[10px] text-slate-400">{count}</span>
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-[11px] text-slate-400">
          {hasPendingItems
            ? copy.desktop.processing
            : copy.desktop.completed(completedCount)}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {visibleItems.map((item) => {
          const variants = filter === "all"
            ? item.variants
            : item.variants.filter((variant) => variant.format === filter);
          const bestVariant = getBestDoneVariant(item);

          return (
            <article
              key={item.id}
              className="grid min-h-16 grid-cols-1 gap-2 border-b border-slate-100 px-4 py-2 last:border-b-0 md:grid-cols-[180px_minmax(0,1fr)] md:items-center md:gap-3 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-200">
                  {item.rejection ? (
                    <span className="flex h-full w-full items-center justify-center text-red-500">
                      <FiAlertCircle className="h-5 w-5" aria-hidden="true" />
                    </span>
                  ) : (
                    <img src={item.previewUrl} alt={item.fileName} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[13px] font-semibold text-slate-800" title={item.fileName}>
                    {item.fileName}
                  </h3>
                  <p className="mt-0.5 truncate whitespace-nowrap text-[10px] text-slate-500">
                    {item.sourceFormat.toUpperCase()} · {formatSize(item.fileSize)}
                  </p>
                </div>
              </div>

              {item.rejection ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-red-600">
                  <FiAlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{copy.uploadNotice.fileTooLargeTitle}</span>
                </div>
              ) : (
                <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-2 gap-y-2">
                  {variants.map((variant) => (
                    <VariantResult
                      key={variant.id}
                      item={item}
                      variant={variant}
                      best={bestVariant?.id === variant.id && variants.length > 1}
                      copy={copy}
                      onConvertAnyway={onConvertAnyway}
                    />
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5">
        <span className="text-[11px] text-slate-500">
          {copy.desktop.page(safePage + 1, pageCount)}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-white disabled:opacity-30"
            aria-label={lang === "zh" ? "上一页" : "Previous page"}
          >
            <FiChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-white disabled:opacity-30"
            aria-label={lang === "zh" ? "下一页" : "Next page"}
          >
            <FiChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}
