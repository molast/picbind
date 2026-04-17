"use client";

import { initWasm } from "@/utils/wasm-runtime";

type FaviconSet = {
  favicon16: Uint8Array;
  favicon32: Uint8Array;
  apple: Uint8Array;
  android192: Uint8Array;
  android512: Uint8Array;
  ico: Uint8Array;
};

function toUint8Array(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(0));
  }
  throw new Error(`Missing favicon output: ${field}`);
}

function buildManifestBytes() {
  const manifest = {
    name: "NanoImg",
    short_name: "NanoImg",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    theme_color: "#ffffff",
    background_color: "#ffffff",
    display: "standalone",
  };
  return new TextEncoder().encode(JSON.stringify(manifest));
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function generateFaviconFromImage(file: File): Promise<FaviconSet> {
  const mod = await initWasm();
  if (!mod || typeof mod.generate_favicon !== "function") {
    throw new Error("WASM module does not expose generate_favicon");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw = mod.generate_favicon(bytes) as Record<string, unknown>;

  return {
    favicon16: toUint8Array(raw.favicon16, "favicon16"),
    favicon32: toUint8Array(raw.favicon32, "favicon32"),
    apple: toUint8Array(raw.apple, "apple"),
    android192: toUint8Array(raw.android192, "android192"),
    android512: toUint8Array(raw.android512, "android512"),
    ico: toUint8Array(raw.ico, "ico"),
  };
}

export async function downloadFaviconZip(files: FaviconSet) {
  const mod = await initWasm();
  if (!mod || typeof mod.create_zip_from_items !== "function") {
    throw new Error("WASM module does not expose create_zip_from_items");
  }

  const zipEntries = [
    { name: "favicon.ico", bytes: files.ico },
    { name: "favicon-16x16.png", bytes: files.favicon16 },
    { name: "favicon-32x32.png", bytes: files.favicon32 },
    { name: "apple-touch-icon.png", bytes: files.apple },
    { name: "android-chrome-192x192.png", bytes: files.android192 },
    { name: "android-chrome-512x512.png", bytes: files.android512 },
    { name: "site.webmanifest", bytes: buildManifestBytes() },
  ];

  const zipBytes = mod.create_zip_from_items(zipEntries) as Uint8Array;
  const blob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
  triggerDownload(blob, "favicon_package.zip");
}

export function getFaviconHtmlSnippet() {
  return `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="manifest" href="/site.webmanifest">`;
}
