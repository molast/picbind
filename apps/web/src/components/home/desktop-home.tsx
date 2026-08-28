"use client";

import Image from "next/image";
import Link from "next/link";
import {
  FiFolder,
  FiGrid,
  FiImage,
  FiUploadCloud,
} from "react-icons/fi";
import { WorkspaceLanguageSwitcher } from "@picbind/ui/source";
import AccountControl from "@/components/auth/account-control";
import type { useHomeCompression } from "./use-home-compression";
import DesktopHomeResults from "./desktop-home-results";

type DesktopHomeProps = {
  home: ReturnType<typeof useHomeCompression>;
};

export default function DesktopHome({
  home,
}: DesktopHomeProps) {
  const hasItems = home.sortedItems.length > 0;
  const desktopCopy = home.copy.desktop;

  return (
    <main className="flex h-[100dvh] min-h-[640px] w-full flex-col overflow-hidden bg-[#f5f7fa] bg-[linear-gradient(rgba(245,247,250,0.76),rgba(245,247,250,0.9)),url('/images/hero-background.avif')] bg-cover bg-center bg-no-repeat text-slate-800">
      <header className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-6">
        <Link href="/" className="inline-flex shrink-0 items-center" aria-label="PicBind">
          <Image
            src="/images/wordmark.png"
            alt="PicBind"
            width={142}
            height={30}
            className="h-8 w-auto object-contain"
            priority
          />
        </Link>

        <nav className="ml-8 flex items-center gap-1 text-sm font-medium text-slate-600">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-50 px-3 text-[#2f65cf]"
          >
            <FiImage className="h-4 w-4" aria-hidden="true" />
            {desktopCopy.compress}
          </Link>
          <Link
            href="/favicon-converter"
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 transition hover:bg-slate-100"
          >
            <FiGrid className="h-4 w-4" aria-hidden="true" />
            {desktopCopy.favicon}
          </Link>
          <Link
            href="/workspace"
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 transition hover:bg-slate-100"
          >
            <FiFolder className="h-4 w-4" aria-hidden="true" />
            {desktopCopy.workspace}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <AccountControl lang={home.lang} showWorkspaceEntry />
          <WorkspaceLanguageSwitcher
            lang={home.lang}
            onChange={home.handleSwitchLang}
          />
        </div>
      </header>

      <input
        ref={home.inputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.avif,image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        onChange={(event) => {
          home.enqueueFiles(event.target.files ?? []);
          event.target.value = "";
        }}
      />

      <section className="flex min-h-0 flex-1 flex-col px-6 pb-5">
        <div
          className={`mx-auto flex w-full max-w-[1160px] shrink-0 flex-col items-center transition-all ${
            hasItems ? "pb-4 pt-5" : "my-auto pb-12"
          }`}
        >
          {!hasItems ? (
            <div className="mb-8 text-center">
              <h1 className="text-[30px] font-semibold text-slate-800">
                {desktopCopy.title}
              </h1>
              <p className="mt-2 text-sm text-slate-500">{desktopCopy.subtitle}</p>
            </div>
          ) : null}

          <div
            onDragEnter={() => home.setIsDragging(true)}
            onDragOver={(event) => {
              event.preventDefault();
              home.setIsDragging(true);
            }}
            onDragLeave={() => home.setIsDragging(false)}
            onDrop={home.handleDrop}
            className={`flex w-full items-center gap-3 rounded-lg border bg-white p-2 shadow-[0_8px_28px_rgba(15,23,42,0.08)] transition ${
              hasItems ? "max-w-[1160px]" : "max-w-[760px]"
            } ${home.isDragging ? "border-[#2f65cf] ring-2 ring-blue-100" : "border-slate-200"}`}
          >
            <button
              type="button"
              onClick={() => home.inputRef.current?.click()}
              className="flex h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-3 text-left transition hover:bg-slate-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white">
                <FiUploadCloud className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {hasItems ? desktopCopy.addImages : home.copy.dropTitle}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {home.copy.dropDesc}
                </span>
              </span>
            </button>

            <div className="h-9 w-px shrink-0 bg-slate-200" />

            <div className="flex shrink-0 items-center gap-1 pr-1" aria-label={desktopCopy.outputFormat}>
              <button
                type="button"
                onClick={home.handleUseAutomaticFormat}
                className={`h-9 rounded-md px-3 text-xs font-semibold transition ${
                  !home.showFormatOptions
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {desktopCopy.auto}
              </button>
              {home.desktopFormatOptions.map((format) => {
                const selected = home.showFormatOptions && home.selectedFormats.includes(format.key);
                return (
                  <button
                    key={format.key}
                    type="button"
                    onClick={() => {
                      if (!home.showFormatOptions) home.setShowFormatOptions(true);
                      home.handleToggleFormat(format.key);
                    }}
                    className={`h-9 rounded-md px-2.5 text-[11px] font-semibold transition ${
                      selected
                        ? "bg-blue-50 text-[#2f65cf] ring-1 ring-inset ring-blue-200"
                        : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {format.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {hasItems ? (
          <DesktopHomeResults
            copy={home.copy}
            lang={home.lang}
            items={home.sortedItems}
            hasPendingItems={home.hasPendingItems}
            completedCount={home.completedCount}
            totalSavedBytes={home.totalSavedBytes}
            totalSavedPercent={home.totalSavedPercent}
            canDownloadZip={home.zipItems.length > 0}
            onDownloadZip={home.handleDownloadZip}
            onConvertAnyway={home.handleConvertAnyway}
          />
        ) : null}
      </section>

    </main>
  );
}
