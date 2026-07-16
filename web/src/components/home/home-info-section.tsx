"use client";

import React from "react";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import type { HomeCompressLandingCopy, Lang } from "@/locales";

const COMPARE_IMAGE_SOURCE_PATH = "/images/compare-original.png";

export type HomeCompareCopy = {
  kicker: string;
  title: string;
  desc: string;
  original: string;
  compressed: string;
  hintLeft: string;
  hintRight: string;
};

type HomeInfoSectionProps = {
  copy: HomeCompressLandingCopy;
  lang: Lang;
  compareCopy: HomeCompareCopy;
  showCompareSection: boolean;
  compareSectionReady: boolean;
  compareCompressedSrc: string;
  compareSizes: { original: string; compressed: string };
  showCompressedCount: boolean;
  displayedCompressedCount: number;
  isCountBouncing: boolean;
};

export default function HomeInfoSection({
  copy,
  lang,
  compareCopy,
  showCompareSection,
  compareSectionReady,
  compareCompressedSrc,
  compareSizes,
  showCompressedCount,
  displayedCompressedCount,
  isCountBouncing,
}: HomeInfoSectionProps) {
  const faqCategories = copy.faq.categories;
  const [activeCategoryId, setActiveCategoryId] = React.useState(
    faqCategories[0]?.id || "",
  );
  const [openItemKey, setOpenItemKey] = React.useState<string | null>(
    faqCategories[0]?.items.length ? `${faqCategories[0].id}-0` : null,
  );

  React.useEffect(() => {
    const firstCategory = faqCategories[0];
    setActiveCategoryId(firstCategory?.id || "");
    setOpenItemKey(firstCategory?.items.length ? `${firstCategory.id}-0` : null);
  }, [faqCategories]);

  const activeCategory =
    faqCategories.find((category) => category.id === activeCategoryId) ||
    faqCategories[0];

  return (
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
                {compareSectionReady ? (
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
                          ↔
                        </div>
                      </div>
                    }
                  />
                ) : (
                  <div className="h-[265px] w-full animate-pulse bg-[linear-gradient(110deg,#e5edf9_8%,#f4f8ff_18%,#e5edf9_33%)] bg-[length:220%_100%] sm:h-[360px] md:h-[520px]" />
                )}
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
                <path d="M300 86 C 306 68, 301 44, 297 20" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
                <path d="M700 86 C 694 68, 699 44, 703 20" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
                <path d="M290 24 L 297 14 L 304 24" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
                <path d="M696 24 L 703 14 L 710 24" fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round" />
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
              <p className="mt-4 text-base leading-8 text-slate-500">{card.desc}</p>
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

        {activeCategory ? (
          <section
            id="faq"
            className="rounded-[28px] border border-slate-200 bg-white px-4 py-6 shadow-[0_16px_45px_rgba(148,163,184,0.12)] sm:px-6 sm:py-8 lg:px-8"
          >
            <div className="max-w-[720px]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-600 sm:text-sm sm:tracking-[0.28em]">
                {copy.faq.kicker}
              </p>
              <h2 className="mt-3 text-[30px] font-semibold leading-tight text-slate-700 sm:text-[38px]">
                {copy.faq.title}
              </h2>
            </div>
            <div className="mt-8 grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
              <aside className="lg:sticky lg:top-6 lg:self-start">
                <div className="space-y-2">
                  {faqCategories.map((category) => {
                    const active = category.id === activeCategory.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => {
                          setActiveCategoryId(category.id);
                          setOpenItemKey(
                            category.items.length ? `${category.id}-0` : null,
                          );
                        }}
                        className={`flex w-full items-center rounded-[18px] px-5 py-3.5 text-left text-[18px] font-semibold transition ${
                          active
                            ? "bg-[linear-gradient(135deg,#36bfd3,#44afd8)] text-white shadow-[0_12px_24px_rgba(54,191,211,0.24)]"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {category.label}
                      </button>
                    );
                  })}
                </div>
              </aside>
              <div>
                <h3 className="text-[44px] font-semibold leading-none text-slate-700">
                  {activeCategory.label}
                </h3>
                <div className="mt-6 divide-y divide-slate-200">
                  {activeCategory.items.map((item, index) => {
                    const itemKey = `${activeCategory.id}-${index}`;
                    const open = openItemKey === itemKey;
                    return (
                      <div key={itemKey} className="py-5 sm:py-6">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenItemKey((current) =>
                              current === itemKey ? null : itemKey,
                            )
                          }
                          className="flex w-full items-start justify-between gap-4 text-left"
                          aria-expanded={open}
                        >
                          <span className="text-[24px] font-semibold leading-tight text-slate-700 sm:text-[30px]">
                            {item.question}
                          </span>
                          <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-600 text-lg font-bold leading-none text-white">
                            {open ? "−" : "+"}
                          </span>
                        </button>
                        {open ? (
                          <div className="max-w-[980px] pt-5 text-[17px] leading-8 text-slate-500 sm:text-[18px]">
                            {item.answer.map((paragraph) => (
                              <p key={paragraph} className="mt-4 first:mt-0">
                                {paragraph}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
