"use client";

import Image from "next/image";
import Link from "next/link";
import React from "react";
import {
  FiCheck,
  FiCode,
  FiCopy,
  FiDownload,
  FiFolder,
  FiGrid,
  FiImage,
  FiPlus,
  FiType,
  FiUploadCloud,
} from "react-icons/fi";
import {
  WorkspaceLanguageSwitcher,
  WorkspaceShareIdEntryDialog,
} from "@picbind/ui/source";
import AccountControl from "@/components/auth/account-control";
import { getHomeCompressLandingCopy } from "@/locales";
import {
  ColorPalette,
  contrastTextColor,
  installFiles,
  type BgShape,
  type FontKey,
  type GeneratorMode,
} from "./favicon-tools";
import type { useFaviconGenerator } from "./use-favicon-generator";

type FaviconGenerator = ReturnType<typeof useFaviconGenerator>;

function DesktopHeader({ generator }: { generator: FaviconGenerator }) {
  const [workspaceEntryOpen, setWorkspaceEntryOpen] = React.useState(false);
  const nav = getHomeCompressLandingCopy(generator.lang).desktop;

  return (
    <>
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
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 transition hover:bg-slate-100"
          >
            <FiImage className="h-4 w-4" aria-hidden="true" />
            {nav.compress}
          </Link>
          <Link
            href="/favicon-converter"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-blue-50 px-3 text-[#2f65cf]"
          >
            <FiGrid className="h-4 w-4" aria-hidden="true" />
            {nav.favicon}
          </Link>
          <Link
            href="/workspace"
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 transition hover:bg-slate-100"
          >
            <FiFolder className="h-4 w-4" aria-hidden="true" />
            {nav.workspace}
          </Link>
          <button
            type="button"
            onClick={() => setWorkspaceEntryOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 transition hover:bg-slate-100"
          >
            <FiPlus className="h-4 w-4" aria-hidden="true" />
            {nav.enterWorkspace}
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <AccountControl lang={generator.lang} />
          <WorkspaceLanguageSwitcher
            lang={generator.lang}
            onChange={generator.handleSwitchLang}
          />
        </div>
      </header>

      <WorkspaceShareIdEntryDialog
        open={workspaceEntryOpen}
        lang={generator.lang}
        desktop
        onClose={() => setWorkspaceEntryOpen(false)}
      />
    </>
  );
}

function ModeControl({
  mode,
  converter,
  generator,
  onChange,
}: {
  mode: GeneratorMode;
  converter: string;
  generator: string;
  onChange(mode: GeneratorMode): void;
}) {
  return (
    <div className="inline-flex h-10 items-center rounded-md border border-slate-200 bg-white p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange("image")}
        className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition ${
          mode === "image"
            ? "bg-slate-900 text-white"
            : "text-slate-500 hover:bg-slate-100"
        }`}
      >
        <FiImage className="h-3.5 w-3.5" aria-hidden="true" />
        {converter}
      </button>
      <button
        type="button"
        onClick={() => onChange("text")}
        className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition ${
          mode === "text"
            ? "bg-slate-900 text-white"
            : "text-slate-500 hover:bg-slate-100"
        }`}
      >
        <FiType className="h-3.5 w-3.5" aria-hidden="true" />
        {generator}
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold text-slate-500">
      {children}
    </span>
  );
}

const fieldClass =
  "h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100";

function TextEditor({ generator }: { generator: FaviconGenerator }) {
  return (
    <section className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-[760px] grid-cols-[220px_minmax(240px,1fr)_minmax(240px,1fr)] gap-4">
        <div className="space-y-3">
          <label className="block">
            <FieldLabel>{generator.copy.labels.text}</FieldLabel>
            <input
              value={generator.text}
              onChange={(event) => generator.setText(event.target.value.toUpperCase().slice(0, 2))}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <FieldLabel>{generator.copy.labels.background}</FieldLabel>
            <select
              value={generator.backgroundShape}
              onChange={(event) => generator.setBackgroundShape(event.target.value as BgShape)}
              className={fieldClass}
            >
              <option value="square">{generator.copy.labels.square}</option>
              <option value="circle">{generator.copy.labels.circle}</option>
              <option value="rounded">{generator.copy.labels.rounded}</option>
            </select>
          </label>
          <label className="block">
            <FieldLabel>{generator.copy.labels.fontFamilyPrefix.replace(/[（(]/g, "")}</FieldLabel>
            <select
              value={generator.fontKey}
              onChange={(event) => generator.setFontKey(event.target.value as FontKey)}
              className={fieldClass}
              disabled={!generator.isFontListReady}
            >
              {generator.fontOptions.map((font) => (
                <option key={font.key} value={font.key}>{font.label}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className="block min-w-0">
              <FieldLabel>{generator.copy.labels.fontVariant}</FieldLabel>
              <select
                value={generator.selectedVariant.id}
                onChange={(event) => generator.setFontVariantId(event.target.value)}
                className={fieldClass}
              >
                {generator.selectedFont.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>{variant.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <FieldLabel>{generator.copy.labels.fontSize}</FieldLabel>
              <input
                type="number"
                min={16}
                max={420}
                value={generator.fontSize}
                onChange={(event) => generator.setFontSize(Number(event.target.value || 110))}
                className={fieldClass}
              />
            </label>
          </div>
        </div>

        <div>
          <label className="block">
            <FieldLabel>{generator.copy.labels.fontColor}</FieldLabel>
            <input
              value={generator.fontColorInput}
              onChange={(event) => generator.setFontColorInput(event.target.value)}
              className={fieldClass}
              style={{
                backgroundColor: generator.fontColor,
                color: contrastTextColor(generator.fontColor),
              }}
            />
          </label>
          <ColorPalette
            compact
            value={generator.fontColorInput}
            onChange={generator.setFontColorInput}
          />
        </div>

        <div>
          <label className="block">
            <FieldLabel>{generator.copy.labels.backgroundColor}</FieldLabel>
            <input
              value={generator.backgroundColorInput}
              onChange={(event) => generator.setBackgroundColorInput(event.target.value)}
              className={fieldClass}
              style={{
                backgroundColor: generator.backgroundColor,
                color: contrastTextColor(generator.backgroundColor),
              }}
            />
          </label>
          <ColorPalette
            compact
            value={generator.backgroundColorInput}
            onChange={generator.setBackgroundColorInput}
          />
        </div>
      </div>
      {generator.error ? (
        <p className="mt-3 text-xs font-medium text-red-600">{generator.error}</p>
      ) : null}
    </section>
  );
}

function ImageEditor({ generator }: { generator: FaviconGenerator }) {
  return (
    <section className="flex min-h-0 flex-col rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div
        className={`flex min-h-[260px] flex-1 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-8 text-center transition ${
          generator.isDragging
            ? "border-[#2f65cf] bg-blue-50 ring-2 ring-blue-100"
            : "border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50"
        }`}
        onDragEnter={() => generator.setIsDragging(true)}
        onDragOver={(event) => {
          event.preventDefault();
          generator.setIsDragging(true);
        }}
        onDragLeave={() => generator.setIsDragging(false)}
        onDrop={generator.onDrop}
        onClick={() => generator.inputRef.current?.click()}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[#2f65cf] text-white shadow-sm">
          <FiUploadCloud className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-4 max-w-md text-sm font-semibold text-slate-700">
          {generator.copy.converterDropHint}
        </p>
        <p className="mt-2 text-xs text-slate-400">PNG · JPG · BMP · WEBP</p>
        {generator.selectedFile ? (
          <span className="mt-4 max-w-full truncate rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
            {generator.selectedFile.name}
          </span>
        ) : null}
      </div>
      {generator.error ? (
        <p className="mt-3 text-xs font-medium text-red-600">{generator.error}</p>
      ) : null}
    </section>
  );
}

function PreviewPanel({ generator }: { generator: FaviconGenerator }) {
  const preview = generator.mode === "text"
    ? generator.previewIcons[0]
    : generator.previewUrl;

  return (
    <section className="flex min-h-[190px] flex-col rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-700">{generator.copy.previewLabel}</h2>
        {generator.mode === "text" && generator.previewIcons.length > 0 ? (
          <div className="flex items-end gap-2">
            {generator.previewIcons.slice(1).map((icon, index) => (
              <Image
                key={icon}
                src={icon}
                alt=""
                width={index === 0 ? 32 : 16}
                height={index === 0 ? 32 : 16}
                unoptimized
                className="object-cover"
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f5f9_75%),linear-gradient(-45deg,transparent_75%,#f1f5f9_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
        {preview ? (
          <Image
            src={preview}
            alt={generator.copy.previewLabel}
            width={128}
            height={128}
            unoptimized
            className="h-28 w-28 rounded-md object-contain shadow-[0_8px_24px_rgba(15,23,42,0.16)]"
          />
        ) : (
          <FiImage className="h-10 w-10 text-slate-300" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}

function InstallationPanel({ generator }: { generator: FaviconGenerator }) {
  const [copied, setCopied] = React.useState(false);

  const copyHtml = async () => {
    await generator.onCopyHtml();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-slate-600">
          <FiCode className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-slate-800">{generator.copy.installation.title}</h2>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        {generator.copy.installation.step1}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {installFiles.map((file) => (
          <code key={file} className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
            {file}
          </code>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        {generator.copy.installation.step2Prefix}
        <code className="rounded bg-slate-100 px-1 text-red-600">
          {generator.copy.installation.step2Head}
        </code>
        {generator.copy.installation.step2Suffix}
      </p>
      <pre className="mt-3 max-h-24 overflow-auto rounded-md bg-slate-950 p-3 text-[10px] leading-4 text-slate-300">
        <code>{generator.htmlSnippet}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copyHtml()}
        className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
      >
        {copied ? <FiCheck className="h-3.5 w-3.5 text-emerald-600" /> : <FiCopy className="h-3.5 w-3.5" />}
        {generator.copy.installation.copy}
      </button>
    </section>
  );
}

export default function DesktopFaviconGeneratorPage({
  generator,
}: {
  generator: FaviconGenerator;
}) {
  return (
    <main className="flex h-[100dvh] min-h-[640px] w-full flex-col overflow-hidden bg-[#f5f7fa] text-slate-800">
      <DesktopHeader generator={generator} />

      <input
        ref={generator.inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp"
        className="hidden"
        onChange={(event) => {
          generator.onFileSelected(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />

      <section className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-4">
        <div className="mx-auto flex w-full max-w-[1320px] shrink-0 items-center justify-between gap-6 pb-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-800">
              {generator.mode === "text"
                ? generator.copy.textSectionTitle
                : generator.copy.imageSectionTitle}
            </h1>
            <p className="mt-1 truncate text-xs text-slate-500">
              {generator.mode === "text"
                ? generator.copy.breadcrumbText
                : generator.copy.breadcrumbImage}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ModeControl
              mode={generator.mode}
              converter={generator.copy.navConverter}
              generator={generator.copy.navGenerator}
              onChange={generator.handleModeSwitch}
            />
            <button
              type="button"
              onClick={() => void generator.onDownload()}
              disabled={generator.isGenerating}
              className="inline-flex h-10 min-w-[112px] items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#2457bd] disabled:cursor-wait disabled:opacity-60"
            >
              <FiDownload className={`h-4 w-4 ${generator.isGenerating ? "animate-bounce" : ""}`} aria-hidden="true" />
              {generator.isGenerating
                ? generator.copy.generatingButton
                : generator.copy.downloadButton}
            </button>
          </div>
        </div>

        <div className="mx-auto grid min-h-0 w-full max-w-[1320px] flex-1 grid-cols-[minmax(0,1fr)_340px] gap-4">
          {generator.mode === "text" ? (
            <TextEditor generator={generator} />
          ) : (
            <ImageEditor generator={generator} />
          )}
          <aside className="flex min-h-0 flex-col gap-4">
            <PreviewPanel generator={generator} />
            <InstallationPanel generator={generator} />
          </aside>
        </div>
      </section>
    </main>
  );
}
