"use client";

import Image from "next/image";
import Link from "next/link";
import HomeFooter from "@/components/home/home-footer";
import { getHomeCompressLandingCopy } from "@/locales";
import {
  ColorPalette,
  contrastTextColor,
  installFiles,
  type BgShape,
  type FontKey,
  type GeneratorMode,
} from "./favicon-tools";
import { useFaviconGenerator } from "./use-favicon-generator";
import FaviconPageLoading from "./favicon-page-loading";

export default function FaviconGeneratorPage({
  initialMode = "text",
}: {
  initialMode?: GeneratorMode;
}) {
  const {
    mode,
    lang,
    langReady,
    copy,
    pageTitle,
    inputRef,
    isDragging,
    setIsDragging,
    isGenerating,
    error,
    selectedFile,
    previewUrl,
    text,
    setText,
    fontColorInput,
    setFontColorInput,
    backgroundColorInput,
    setBackgroundColorInput,
    backgroundShape,
    setBackgroundShape,
    fontOptions,
    fontKey,
    setFontKey,
    fontVariantId,
    setFontVariantId,
    fontSize,
    setFontSize,
    previewIcons,
    htmlSnippet,
    isFontListReady,
    selectedFont,
    selectedVariant,
    fontColor,
    backgroundColor,
    handleModeSwitch,
    onFileSelected,
    onDrop,
    onDownload,
    onCopyHtml,
  } = useFaviconGenerator({ initialMode });

  if (!langReady) {
    return <FaviconPageLoading />;
  }

  const homeCopy = getHomeCompressLandingCopy(lang);

  return (
    <main className="w-full bg-[#efefef] text-[#1f2328]">
      <section className="border-b border-[#d9dce0] bg-[#f2f3f5] px-5 sm:px-8 lg:px-12">
        <div className="mx-auto flex h-[64px] w-full max-w-[1240px] items-center gap-8 sm:gap-10">
          <Link
            href="/"
            className="inline-flex items-center"
          >
            <Image
              src="/images/wordmark.png"
              alt="Picbind"
              width={178}
              height={38}
              className="h-10 w-auto object-contain"
              priority
            />
          </Link>

          <nav className="flex items-center gap-6 text-[16px] font-semibold text-[#4a4f55] sm:gap-10 sm:text-[16px]">
            <button
              type="button"
              onClick={() => handleModeSwitch("image")}
              className={`rounded-full px-3 py-1 transition ${
                mode === "image"
                  ? "bg-[#c7dbff] text-[#2f65cf]"
                  : "hover:bg-white/60 hover:text-[#1f2328]"
              }`}
            >
              {copy.navConverter}
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("text")}
              className={`rounded-full px-3 py-1 transition ${
                mode === "text"
                  ? "bg-[#c7dbff] text-[#2f65cf]"
                  : "hover:bg-white/60 hover:text-[#1f2328]"
              }`}
            >
              {copy.navGenerator}
            </button>
          </nav>
        </div>
      </section>

      <section className="bg-[#08090c] px-5 pb-20 pt-16 text-white sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1200px]">
          <h1 className="max-w-[760px] text-3xl font-extrabold leading-[1.2] tracking-[0.01em] sm:text-5xl">
            {mode === "text"
              ? copy.heroTitleText
              : copy.heroTitleImage}
          </h1>
          <p className="mt-5 max-w-[820px] text-base text-white/70 sm:text-lg sm:leading-[1.6]">
            {mode === "text"
              ? copy.heroDescText
              : copy.heroDescImage}
          </p>
        </div>
      </section>

      <section className="px-5 pb-6 pt-0 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1240px] rounded-b-md bg-[#ebebee] px-6 py-3 text-[#555b62]">
          <Link href="/" className="text-[#377ce5] hover:underline">
            {copy.breadcrumbHome}
          </Link>
          <span className="mx-3 text-[#a4a8ad]">→</span>
          <span>{mode === "text" ? copy.breadcrumbText : copy.breadcrumbImage}</span>
        </div>
      </section>

      <section className="px-5 pb-8 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <strong className="text-[#2e3136]">{copy.previewLabel}</strong>
            {mode === "text" ? (
              <div className="flex items-center gap-2">
                {[48, 32, 16].map((iconSize, index) => {
                  const iconSrc = previewIcons[index];
                  if (!iconSrc) {
                    return null;
                  }
                  return (
                    <Image
                      key={`${iconSrc}-${iconSize}`}
                      src={iconSrc}
                      alt={`preview ${index + 1}`}
                      width={iconSize}
                      height={iconSize}
                      unoptimized
                      className="rounded-[1px] object-cover"
                    />
                  );
                })}
              </div>
            ) : previewUrl ? (
              <Image
                src={previewUrl}
                alt="uploaded preview"
                width={56}
                height={56}
                unoptimized
                className="h-14 w-14 rounded bg-white object-cover ring-1 ring-[#d0d7de]"
              />
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDownload}
              disabled={isGenerating}
              className="rounded-md bg-[#3494e7] px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9fc7ee]"
            >
              {isGenerating ? copy.generatingButton : copy.downloadButton}
            </button>
          </div>
        </div>
      </section>

      {mode === "text" ? (
        <section className="px-5 pb-10 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-[1240px] rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
            <h2 className="text-2xl font-bold text-[#2e3136] sm:text-3xl">
              {copy.textSectionTitle}
            </h2>

            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.text}
                  </span>
                  <input
                    value={text}
                    onChange={(event) => setText(event.target.value.toUpperCase().slice(0, 2))}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.background}
                  </span>
                  <select
                    value={backgroundShape}
                    onChange={(event) => setBackgroundShape(event.target.value as BgShape)}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                  >
                    <option value="square">{copy.labels.square}</option>
                    <option value="circle">{copy.labels.circle}</option>
                    <option value="rounded">{copy.labels.rounded}</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.fontFamilyPrefix}
                    <a
                      href="https://fonts.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#377ce5] hover:underline"
                    >
                      {copy.labels.viewGoogleFonts}
                    </a>
                    )
                  </span>
                  <select
                    value={fontKey}
                    onChange={(event) => setFontKey(event.target.value as FontKey)}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                    disabled={!isFontListReady}
                  >
                    {fontOptions.map((font) => (
                      <option key={font.key} value={font.key}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.fontVariant}
                  </span>
                  <select
                    value={selectedVariant.id}
                    onChange={(event) => setFontVariantId(event.target.value)}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                  >
                    {selectedFont.variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.fontSize}
                  </span>
                  <input
                    type="number"
                    min={16}
                    max={420}
                    value={fontSize}
                    onChange={(event) => setFontSize(Number(event.target.value || 110))}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                  />
                </label>
              </div>

              <div>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.fontColor}
                  </span>
                  <input
                    value={fontColorInput}
                    onChange={(event) => setFontColorInput(event.target.value)}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                    style={{
                      backgroundColor: fontColor,
                      color: contrastTextColor(fontColor),
                    }}
                  />
                </label>
                <ColorPalette value={fontColorInput} onChange={setFontColorInput} />
              </div>

              <div>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    {copy.labels.backgroundColor}
                  </span>
                  <input
                    value={backgroundColorInput}
                    onChange={(event) => setBackgroundColorInput(event.target.value)}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                    style={{
                      backgroundColor: backgroundColor,
                      color: contrastTextColor(backgroundColor),
                    }}
                  />
                </label>
                <ColorPalette
                  value={backgroundColorInput}
                  onChange={setBackgroundColorInput}
                />
              </div>
            </div>

            {error ? <p className="mt-5 text-sm text-[#cf222e]">{error}</p> : null}
          </div>
        </section>
      ) : (
        <section className="px-5 pb-10 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-[1240px] rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
            <h2 className="text-2xl font-bold text-[#2e3136] sm:text-3xl">
              {copy.imageSectionTitle}
            </h2>
            <div
              className={`mt-6 rounded-lg border border-dashed px-6 py-12 text-center transition ${
                isDragging
                  ? "border-[#2f81f7] bg-[#f4f9ff]"
                  : "border-[#c8ccd1] bg-[#f7f8fa]"
              }`}
              onDragEnter={() => setIsDragging(true)}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <p className="cursor-pointer text-base text-[#57606a] sm:text-lg">
                {copy.converterDropHint}
              </p>
              {selectedFile && (
                <p className="mt-3 text-sm font-medium text-[#24292f]">
                  {selectedFile.name}
                </p>
              )}
            </div>
            {error ? <p className="mt-4 text-sm text-[#cf222e]">{error}</p> : null}
          </div>
        </section>
      )}

      <section className="px-5 pb-8 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1240px] rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
          <h3 className="text-2xl font-bold text-[#24292f] sm:text-3xl">{copy.installation.title}</h3>
          <p className="mt-4 text-sm leading-[1.6] text-[#57606a] sm:text-base">
            {copy.installation.step1}
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-7 text-sm text-[#4f5660] sm:text-base">
            {installFiles.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <p className="mt-6 text-sm leading-[1.6] text-[#57606a] sm:text-base">
            {copy.installation.step2Prefix}
            <code className="rounded bg-[#f3f4f6] px-2 py-1 text-[#cf222e]">{copy.installation.step2Head}</code>
            {copy.installation.step2Suffix}
          </p>

          <pre className="mt-4 overflow-auto rounded bg-[#f6f8fa] p-4 text-xs leading-[1.55] text-[#3d444d] sm:text-sm">
            <code>{htmlSnippet}</code>
          </pre>

          <button
            type="button"
            onClick={onCopyHtml}
            className="mt-4 rounded-md bg-[#3a98f6] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2b89e8]"
          >
            {copy.installation.copy}
          </button>
        </div>
      </section>

      <section className="px-5 pb-16 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1240px] rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
          <h3 className="text-2xl font-bold text-[#24292f] sm:text-3xl">{copy.article.title}</h3>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            {copy.article.p1}
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            {copy.article.h2}
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            {copy.article.p2}
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            {copy.article.h3}
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            {copy.article.p3}
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            {copy.article.h4}
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            {copy.article.p4}
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            {copy.article.h5}
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            {copy.article.p5}
          </p>
        </div>
      </section>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp"
        className="hidden"
        onChange={(event) => {
          onFileSelected(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />

      <HomeFooter copy={homeCopy} lang={lang} />
    </main>
  );
}
