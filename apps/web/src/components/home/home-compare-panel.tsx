"use client";

import React from "react";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import {
  formatSize,
  type CompareAsset,
  type HomeCompareCopy,
} from "./home-compression-types";

const DEFAULT_SOURCE = "/images/compare-original.png";

type HomeComparePanelProps = {
  copy: HomeCompareCopy;
  ready: boolean;
  defaultCompressedSrc: string;
  defaultSizes: { original: string; compressed: string };
  assets: CompareAsset[];
  leftAssetId: string | null;
  rightAssetId: string | null;
  hasResults: boolean;
};

export default function HomeComparePanel({
  copy,
  ready,
  defaultCompressedSrc,
  defaultSizes,
  assets,
  leftAssetId,
  rightAssetId,
  hasResults,
}: HomeComparePanelProps) {
  const leftAsset = assets.find((asset) => asset.id === leftAssetId);
  const rightAsset = assets.find((asset) => asset.id === rightAssetId);
  const leftSrc = leftAsset?.src || DEFAULT_SOURCE;
  const rightSrc = rightAsset?.src || defaultCompressedSrc;
  const leftLabel = leftAsset?.label || copy.original;
  const rightLabel = rightAsset?.label || copy.compressed;
  const leftSize = leftAsset ? formatSize(leftAsset.size) : defaultSizes.original;
  const rightSize = rightAsset
    ? formatSize(rightAsset.size)
    : defaultSizes.compressed;

  return (
    <section
      className={`relative z-10 mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6 lg:px-10 ${
        hasResults ? "-mt-12" : "pt-16"
      }`}
    >
      <div className="mx-auto w-full rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_16px_45px_rgba(148,163,184,0.12)] sm:rounded-[28px] sm:p-5 md:p-8">
        <div className="mx-auto max-w-[820px] text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-600 sm:text-xs sm:tracking-[0.24em]">
            {copy.kicker}
          </p>
          <h3 className="mt-3 text-[26px] font-semibold leading-tight text-slate-700 sm:text-3xl md:text-4xl">
            {copy.title}
          </h3>
          <p className="mt-3 text-[13px] leading-6 text-slate-500 sm:text-sm md:text-base">
            {copy.desc}
          </p>
        </div>

        <div className="relative mt-5 sm:mt-6">
          <div className="relative overflow-hidden rounded-[24px] border border-slate-200">
            {ready ? (
              <ReactCompareSlider
                className="h-[265px] w-full sm:h-[360px] md:h-[520px]"
                itemOne={
                  <ReactCompareSliderImage
                    src={leftSrc}
                    alt={leftLabel}
                    style={{ objectFit: "cover" }}
                  />
                }
                itemTwo={
                  <ReactCompareSliderImage
                    src={rightSrc}
                    alt={rightLabel}
                    style={{ objectFit: "cover" }}
                  />
                }
                handle={
                  <div className="flex h-full items-center">
                    <div className="h-full w-[2px] bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
                    <div className="-ml-[14px] flex h-7 w-7 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-600 shadow-md">
                      ↔
                    </div>
                  </div>
                }
              />
            ) : (
              <div className="h-[265px] w-full animate-pulse bg-[linear-gradient(110deg,#e5edf9_8%,#f4f8ff_18%,#e5edf9_33%)] bg-[length:220%_100%] sm:h-[360px] md:h-[520px]" />
            )}
            <div className="pointer-events-none absolute bottom-4 left-[9%] max-w-[38%] text-xs text-white [text-shadow:0_3px_12px_rgba(0,0,0,0.72)] sm:bottom-5 sm:left-[13%]">
              <div className="truncate text-[10px] font-semibold tracking-[0.12em] sm:text-sm md:text-base">
                {leftLabel}
              </div>
              <div className="mt-0.5 text-[10px] text-white/90 sm:text-[11px]">
                {leftSize}
              </div>
            </div>
            <div className="pointer-events-none absolute right-[9%] top-6 max-w-[38%] text-right text-xs text-white [text-shadow:0_3px_12px_rgba(0,0,0,0.72)] sm:right-[13%] sm:top-10">
              <div className="truncate text-[10px] font-semibold tracking-[0.12em] sm:text-sm md:text-base">
                {rightLabel}
              </div>
              <div className="mt-0.5 text-[10px] text-white/90 sm:text-[11px]">
                {rightSize}
              </div>
            </div>
          </div>

          <svg
            viewBox="0 0 1000 90"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 top-[77%] z-20 h-[44px] w-full sm:top-[79%] sm:h-[72px]"
          >
            <path d="M300 86 C 306 68, 301 44, 297 20" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
            <path d="M700 86 C 694 68, 699 44, 703 20" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
            <path d="M290 24 L 297 14 L 304 24" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
            <path d="M696 24 L 703 14 L 710 24" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
          </svg>

          <div className="relative z-30 mt-16 grid grid-cols-2 gap-4 text-center text-sky-600 sm:mt-12 md:grid-cols-2">
            <p className="mx-auto max-w-[150px] text-[11px] font-medium leading-tight sm:max-w-[260px] sm:text-base md:text-2xl [font-family:'Comic_Sans_MS','Marker_Felt','Bradley_Hand',cursive]">
              {copy.hintLeft}
            </p>
            <p className="mx-auto max-w-[150px] text-[11px] font-medium leading-tight sm:max-w-[260px] sm:text-base md:text-2xl [font-family:'Comic_Sans_MS','Marker_Felt','Bradley_Hand',cursive]">
              {copy.hintRight}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
