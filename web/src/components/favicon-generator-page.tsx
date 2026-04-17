"use client";

import React from "react";
import Image from "next/image";
import { downloadFaviconZip, generateFaviconFromImage, getFaviconHtmlSnippet } from "@/utils/favicon";

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/bmp",
  "image/webp",
]);

const installFiles = [
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon.ico",
  "site.webmanifest",
];

export default function FaviconGeneratorPage() {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  const htmlSnippet = React.useMemo(() => getFaviconHtmlSnippet(), []);

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const onFileSelected = React.useCallback((file: File | null) => {
    if (!file) {
      return;
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("仅支持 PNG、JPG、JPEG、BMP、WebP 图片");
      return;
    }

    setError(null);
    setSelectedFile(file);
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  }, []);

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFileSelected(event.dataTransfer.files?.[0] ?? null);
  };

  const onDownload = async () => {
    if (!selectedFile || isGenerating) {
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      const files = await generateFaviconFromImage(selectedFile);
      await downloadFaviconZip(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Favicon 生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const onCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(htmlSnippet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制失败");
    }
  };

  return (
    <main className="w-full bg-[#efefef] text-[#1f2328]">
      <section className="bg-[#08090c] px-5 pb-20 pt-16 text-white sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1200px]">
          <h1 className="max-w-[720px] text-3xl font-extrabold leading-[1.15] tracking-[0.01em] sm:text-4xl">
            Favicon Generator / Generate from Image
          </h1>
          <p className="mt-5 max-w-[760px] text-base text-white/70 sm:text-lg">
            Quickly generate your favicon from an image by uploading your image below.
            Download your favicon in the most up to date formats.
          </p>
        </div>
      </section>

      <section className="mx-auto mt-[-52px] w-full max-w-[1240px] px-5 pb-8 sm:px-8 lg:px-12">
        <div className="rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.06)]">
          <h2 className="text-2xl font-bold leading-none tracking-[-0.02em] text-[#24292f] sm:text-3xl">
            Converter
          </h2>
          <div
            className={`mt-6 rounded-lg border border-dashed px-6 py-14 text-center transition ${
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
              Drag and drop your file here or click here to upload.
            </p>
            {selectedFile && (
              <p className="mt-3 text-sm font-medium text-[#24292f]">{selectedFile.name}</p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onDownload}
              disabled={!selectedFile || isGenerating}
              className="inline-flex items-center rounded-full bg-[#3a98f6] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2b89e8] disabled:cursor-not-allowed disabled:bg-[#9fc7ee] sm:px-7 sm:py-2.5 sm:text-base"
            >
              {isGenerating ? "Generating..." : "Download"}
            </button>
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt="uploaded preview"
                width={40}
                height={40}
                unoptimized
                className="h-10 w-10 rounded bg-white object-cover ring-1 ring-[#d0d7de]"
              />
            ) : null}
            {error ? <p className="text-sm text-[#cf222e]">{error}</p> : null}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1240px] px-5 pb-8 sm:px-8 lg:px-12">
        <div className="rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
          <h3 className="text-2xl font-bold text-[#24292f] sm:text-3xl">Installation</h3>
          <p className="mt-4 text-sm leading-[1.6] text-[#57606a] sm:text-base">
            First, use the download button to download the files listed below. Place the files in
            the root directory of your website.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-7 text-sm text-[#4f5660] sm:text-base">
            {installFiles.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <p className="mt-6 text-sm leading-[1.6] text-[#57606a] sm:text-base">
            Next, copy the following link tags and paste them into the{" "}
            <code className="rounded bg-[#f3f4f6] px-2 py-1 text-[#cf222e]">head</code> of your
            HTML.
          </p>

          <pre className="mt-4 overflow-auto rounded bg-[#f6f8fa] p-4 text-xs leading-[1.55] text-[#3d444d] sm:text-sm">
            <code>{htmlSnippet}</code>
          </pre>

          <button
            type="button"
            onClick={onCopyHtml}
            className="mt-4 rounded-md bg-[#3a98f6] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2b89e8]"
          >
            Copy
          </button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1240px] px-5 pb-16 sm:px-8 lg:px-12">
        <div className="rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
          <h3 className="text-2xl font-bold text-[#24292f] sm:text-3xl">About the favicon generator</h3>
          <p className="mt-4 text-sm leading-[1.65] text-[#57606a] sm:text-base">
            If you already have an image that you would like to use for a favicon on your website
            the this is the tool you need. The favicon generator will convert you image to a
            favicon. You can upload a PNG, JPG, or BMP and the favicon generator will output an ICO
            file.
          </p>
          <p className="mt-4 text-sm leading-[1.65] text-[#57606a] sm:text-base">
            For the best result you should upload an square image. You can use a standard image
            editing tool if you need to crop your image. Once your image is prepared upload it
            using the tool above. Next, verify that the preview image is to your liking. Finally,
            use the download button to export your favicon in ICO format.
          </p>

          <h4 className="mt-6 text-xl font-bold text-[#24292f] sm:text-2xl">Why do I need an ICO file instead of a PNG?</h4>
          <p className="mt-4 text-sm leading-[1.65] text-[#57606a] sm:text-base">
            An ICO file is a special image file use by the browser. The unique feature of an ICO
            file is that it is multilayered. Each layer of the favicon holds a different size of
            the image. The common sizes for a ICO formatted favicon are 16x16px, 32x32px, and
            48x48px.
          </p>
          <p className="mt-4 text-sm leading-[1.65] text-[#57606a] sm:text-base">
            For best compatibility web browsers can leverage the ICO file generated by the favicon
            generator. The browsers will use the different sizes for displaying in different areas
            of the website such as the bookmarks bar, the address bar, the browser tab, and as a
            desktop shortcut.
          </p>

          <h4 className="mt-6 text-xl font-bold text-[#24292f] sm:text-2xl">
            What types of images work best for the favicon generator?
          </h4>
          <p className="mt-4 text-sm leading-[1.65] text-[#57606a] sm:text-base">
            The favicon generator works best with a simple icon, logo, or letter. Intricate or
            complex designs don&apos;t work well when they are resized using the favicon generator as
            much detail is lost. If your logo is very complex we recommend generating the favicon
            from text using the alternative generator.
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
    </main>
  );
}
