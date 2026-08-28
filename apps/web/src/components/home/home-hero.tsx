"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { WorkspaceLanguageSwitcher } from "@picbind/ui/source";
import type { HomeCompressLandingCopy, Lang } from "@/locales";
import type { HomeOutputFormat } from "./home-compression-types";
import AccountControl from "@/components/auth/account-control";

type HomeHeroProps = {
  copy: HomeCompressLandingCopy;
  lang: Lang;
  inputRef: React.RefObject<HTMLInputElement>;
  isDragging: boolean;
  showFormatOptions: boolean;
  selectedFormats: HomeOutputFormat[];
  formatOptions: Array<{ key: HomeOutputFormat; label: string }>;
  onSwitchLang(lang: Lang): void;
  onDraggingChange(dragging: boolean): void;
  onDrop(event: React.DragEvent<HTMLDivElement>): void;
  onFormatOptionsChange(open: boolean): void;
  onToggleFormat(format: HomeOutputFormat): void;
  onSelectAllFormats(): void;
};

export default function HomeHero({
  copy,
  lang,
  inputRef,
  isDragging,
  showFormatOptions,
  selectedFormats,
  formatOptions,
  onSwitchLang,
  onDraggingChange,
  onDrop,
  onFormatOptionsChange,
  onToggleFormat,
  onSelectAllFormats,
}: HomeHeroProps) {
  return (
    <section className="relative min-h-[470px] overflow-hidden bg-[#c8d8f2] sm:min-h-[520px] lg:min-h-[560px]">
      <div className="absolute inset-0 bg-[url('/images/hero-background.avif')] bg-cover bg-center bg-no-repeat" />
      <div className="absolute inset-y-0 right-0 hidden w-[38%] bg-[url('/images/hero-illustration.avif')] bg-contain bg-right-bottom bg-no-repeat lg:block" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(216,228,248,0.44),rgba(216,228,248,0.34)_50%,rgba(216,228,248,0.44)_100%)]" />

      <div className="relative mx-auto flex min-h-[470px] max-w-[1440px] flex-col px-4 pb-5 pt-0 sm:min-h-[520px] sm:px-6 sm:pb-6 sm:pt-0 lg:min-h-[560px] lg:px-10">
        <header className="relative py-0">
          <div className="-mx-4 flex h-[64px] items-center px-5 sm:-mx-6 sm:px-8 lg:-mx-10 lg:px-12">
            <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between">
              <div className="flex min-w-0 items-center gap-8">
                <Link href="/" className="inline-flex items-center">
                  <Image
                    src="/images/wordmark.png"
                    alt="Picbind"
                    width={178}
                    height={38}
                    className="h-8 w-auto object-contain sm:h-10"
                    priority
                  />
                </Link>
                <nav className="hidden items-center gap-3 text-[15px] font-semibold text-[#4d5d7a] md:flex">
                  <button
                    type="button"
                    className="rounded-full bg-[#c7dbff] px-3 py-1 text-[#2f65cf]"
                  >
                    {lang === "zh" ? "图片压缩" : "Image Compress"}
                  </button>
                  <Link
                    href="/favicon-converter"
                    className="rounded-full px-3 py-1 transition hover:bg-white/35"
                  >
                    {lang === "zh" ? "Favicon 工具" : "Favicon Tools"}
                  </Link>
                  <Link href="/workspace" className="rounded-full px-3 py-1 transition hover:bg-white/35">
                    {lang === "zh" ? "图片工作区" : "Image Workspace"}
                  </Link>
                </nav>
              </div>
              <div className="flex items-center gap-3">
                <AccountControl lang={lang} showWorkspaceEntry />
                <WorkspaceLanguageSwitcher lang={lang} onChange={onSwitchLang} />
              </div>
            </div>
          </div>
          <div className="mx-auto mt-2 flex items-center gap-2 px-1 text-[14px] font-semibold text-[#4d5d7a] md:hidden">
            <button
              type="button"
              className="rounded-full bg-[#c3d8ff] px-3 py-1 text-[#2f65cf]"
            >
              {lang === "zh" ? "图片压缩" : "Image Compress"}
            </button>
            <Link href="/favicon-converter" className="rounded-full px-3 py-1">
              {lang === "zh" ? "Favicon 工具" : "Favicon Tools"}
            </Link>
            <Link href="/workspace" className="rounded-full px-3 py-1">
              {lang === "zh" ? "图片工作区" : "Image Workspace"}
            </Link>
          </div>
        </header>

        <div className="relative z-10 flex flex-1 items-start justify-center pt-4 sm:pt-6 lg:pt-8">
          <div className="w-full max-w-[780px]">
            <div
              onDragEnter={() => onDraggingChange(true)}
              onDragOver={(event) => {
                event.preventDefault();
                onDraggingChange(true);
              }}
              onDragLeave={() => onDraggingChange(false)}
              onDrop={onDrop}
              className={`mx-auto w-full rounded-[24px] bg-[rgba(223,232,250,0.68)] p-3 shadow-[0_20px_52px_rgba(64,92,148,0.16)] backdrop-blur-sm transition sm:rounded-[26px] sm:p-3.5 md:p-4 ${
                isDragging ? "scale-[1.01] ring-2 ring-[#9ec0ff]/70" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex h-[172px] w-full flex-col items-center justify-center rounded-[20px] border-[3px] border-dashed border-[#7aabff] bg-[rgba(242,247,255,0.62)] px-4 py-4 text-center text-[#22325d] transition hover:bg-[rgba(242,247,255,0.78)] sm:h-[205px] sm:px-6 sm:py-5 md:h-[245px] md:py-6"
              >
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#6fb2f8,#438ef2)] shadow-[0_8px_18px_rgba(68,133,232,0.22)] sm:mb-4 sm:h-14 sm:w-14 sm:rounded-[16px]">
                  <svg viewBox="0 0 24 24" className="h-7 w-7 text-white sm:h-8 sm:w-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 4v10" />
                    <path d="m8.5 10.5 3.5 3.5 3.5-3.5" />
                    <path d="M6 19h12" />
                  </svg>
                </div>
                <h2 className="text-[16px] font-semibold leading-tight text-[#21335f] sm:text-[19px] md:text-[22px]">
                  {copy.dropTitle}
                </h2>
                <p className="mt-2 text-[11px] font-medium text-[#5d6d95] sm:mt-3 sm:text-[13px] md:text-[14px]">
                  {copy.dropDesc}
                </p>
              </button>
              <div className="mt-3 overflow-hidden rounded-[18px] bg-[rgba(251,253,255,0.98)] sm:rounded-[20px]">
                <div className="flex items-center gap-3 px-4 py-3 text-[11px] text-[#5f6e90] sm:px-5 sm:text-[13px] md:text-[14px]">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onFormatOptionsChange(!showFormatOptions);
                    }}
                    aria-pressed={showFormatOptions}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
                      showFormatOptions ? "bg-[#5a9dff]" : "bg-[#c5d2e6]"
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
                  className={`overflow-hidden bg-[#edf3ff] transition-all duration-200 ${
                    showFormatOptions
                      ? "max-h-40 border-t border-[#d5e0f8] sm:max-h-24"
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
                            onToggleFormat(format.key);
                          }}
                          className={`inline-flex h-8 min-w-[82px] items-center justify-center rounded-full border px-2.5 text-[10px] font-semibold tracking-[0.02em] transition md:min-w-[88px] md:text-[11px] ${
                            active
                              ? "border-[#5a9dff] bg-white text-[#2d6fde] shadow-sm"
                              : "border-[#c7d3ea] bg-[#f6f8ff] text-[#5b6782]"
                          }`}
                        >
                          {active ? <span className="mr-2 text-[#5a9dff]">✓</span> : null}
                          <span>{format.label}</span>
                        </button>
                      );
                    })}
                    <span className="hidden h-8 w-px bg-[#c7d3ea] md:block" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectAllFormats();
                      }}
                      className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-full border border-[#c7d3ea] bg-[#f6f8ff] px-2.5 text-[10px] font-semibold tracking-[0.02em] text-[#5b6782] transition hover:bg-white md:min-w-[104px] md:text-[11px]"
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
  );
}
