"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  downloadFaviconZip,
  generateFaviconFromImage,
  getFaviconHtmlSnippet,
} from "@/utils/favicon";
import {
  type FontVariant,
  type GoogleFontOption,
  ensureGoogleFontVariantLoaded,
  loadGoogleFontOptions,
} from "@/utils/google-font-catalog";

type GeneratorMode = "image" | "text";
type BgShape = "square" | "circle" | "rounded";
type FontKey = string;

const FALLBACK_FONT_OPTION: GoogleFontOption = {
  key: "fallback",
  label: "sans-serif",
  family: "sans-serif",
  variants: [
    {
      id: "400-normal",
      label: "Regular 400 Normal",
      weight: 400,
      style: "normal",
    },
  ],
  variantUrls: {},
};

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


function resolveCssColor(input: string, fallback = "#FFFFFF") {
  const value = input.trim();
  if (/^#[\da-fA-F]{3}$/.test(value) || /^#[\da-fA-F]{6}$/.test(value)) {
    return value.toUpperCase();
  }
  if (
    /^hsl\(/i.test(value) ||
    /^rgb\(/i.test(value) ||
    /^rgba\(/i.test(value) ||
    value.toLowerCase() === "transparent" ||
    /^[a-z]+$/i.test(value)
  ) {
    return value;
  }
  return fallback;
}

function hslToHex(h: number, s: number, l: number) {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = lightness - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function normalizeHexForCompare(value: string) {
  const raw = value.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9A-F]{6}$/.test(raw)) {
    return raw;
  }
  return raw.toLowerCase();
}

function compactHex(value: string) {
  const hex = normalizeHexForCompare(value);
  if (!/^#[0-9A-F]{6}$/.test(hex)) {
    return value;
  }
  const [r1, r2, g1, g2, b1, b2] = hex.slice(1);
  if (r1 === r2 && g1 === g2 && b1 === b2) {
    return `#${r1}${g1}${b1}`;
  }
  return hex;
}

function contrastTextColor(bgColor: string) {
  const hex = normalizeHexForCompare(bgColor);
  if (!/^#[0-9A-F]{6}$/.test(hex)) {
    return "#FFFFFF";
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#1F2937" : "#FFFFFF";
}

function generateColorSwatches() {
  const rows: string[][] = [];
  const hueCount = 12;
  const lightnessBands = [76, 64, 50, 40, 30, 78, 66, 52, 38, 24];
  const saturationBands = [60, 86, 100, 98, 96, 38, 44, 48, 56, 62];

  for (let row = 0; row < lightnessBands.length; row += 1) {
    const rowColors: string[] = [];
    for (let i = 0; i < hueCount; i += 1) {
      const hue = Math.round((i * 360) / hueCount);
      rowColors.push(
        hslToHex(hue, saturationBands[row], lightnessBands[row]),
      );
    }
    rows.push(rowColors);
  }

  const grayscale = [
    "#F4F4F4",
    "#D9D9D9",
    "#B5B5B5",
    "#8F8F8F",
    "#666666",
    "#2A2A2A",
    "#000000",
  ];

  return { rows, grayscale };
}

const COLOR_SWATCHES = generateColorSwatches();

function drawTextCenter(options: {
  context: CanvasRenderingContext2D;
  text: string;
  size: number;
  fontFamily: string;
  fontColor: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
}) {
  const {
    context,
    text,
    size,
    fontFamily,
    fontColor,
    fontSize,
    fontWeight,
    fontStyle,
  } = options;

  const token = (text || "F").slice(0, 2);
  const baseSize = 120;
  let drawSize = Math.max(14, Math.round((fontSize / baseSize) * size));
  const maxSize = Math.floor(size * 0.86);
  if (drawSize > maxSize) {
    drawSize = maxSize;
  }

  const paintColor = resolveCssColor(fontColor, "#FFFFFF");
  const measureCtxCanvas = document.createElement("canvas");
  measureCtxCanvas.width = size;
  measureCtxCanvas.height = size;
  const measureCtx = measureCtxCanvas.getContext("2d");
  if (!measureCtx) {
    return;
  }

  measureCtx.fillStyle = paintColor;
  measureCtx.textAlign = "center";
  measureCtx.textBaseline = "middle";
  measureCtx.font = `${fontStyle} ${fontWeight} ${drawSize}px ${fontFamily}`;

  let metrics = measureCtx.measureText(token);
  let measured = metrics.width;
  if (measured > size * 0.84) {
    drawSize = Math.max(12, Math.floor((drawSize * size * 0.84) / measured));
    measureCtx.font = `${fontStyle} ${fontWeight} ${drawSize}px ${fontFamily}`;
    metrics = measureCtx.measureText(token);
    measured = metrics.width;
  }
  if (measured < size * 0.42) {
    const bump = Math.min(
      maxSize,
      Math.floor((drawSize * size * 0.56) / Math.max(1, measured)),
    );
    measureCtx.font = `${fontStyle} ${fontWeight} ${bump}px ${fontFamily}`;
  }

  // Pixel-true centering: render once, read opaque bounds, then offset to exact center.
  measureCtx.clearRect(0, 0, size, size);
  measureCtx.fillText(token, size / 2, size / 2);

  const imageData = measureCtx.getImageData(0, 0, size, size).data;
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = imageData[(y * size + x) * 4 + 3];
      if (alpha <= 8) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  context.fillStyle = paintColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = measureCtx.font;

  if (maxX < minX || maxY < minY) {
    context.fillText(token, size / 2, size / 2);
    return;
  }

  const glyphCenterX = (minX + maxX) / 2;
  const glyphCenterY = (minY + maxY) / 2;
  const offsetX = size / 2 - glyphCenterX;
  const offsetY = size / 2 - glyphCenterY;

  context.save();
  context.translate(offsetX, offsetY);
  context.fillText(token, size / 2, size / 2);
  context.restore();
}

function drawBackgroundShape(
  context: CanvasRenderingContext2D,
  size: number,
  shape: BgShape,
  color: string,
) {
  context.fillStyle = color;
  if (shape === "circle") {
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  if (shape === "rounded") {
    const radius = Math.floor(size * 0.11);
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(size - radius, 0);
    context.quadraticCurveTo(size, 0, size, radius);
    context.lineTo(size, size - radius);
    context.quadraticCurveTo(size, size, size - radius, size);
    context.lineTo(radius, size);
    context.quadraticCurveTo(0, size, 0, size - radius);
    context.lineTo(0, radius);
    context.quadraticCurveTo(0, 0, radius, 0);
    context.closePath();
    context.fill();
    return;
  }
  context.fillRect(0, 0, size, size);
}

async function renderTextFaviconBlob(options: {
  text: string;
  fontFamily: string;
  fontColor: string;
  backgroundColor: string;
  backgroundShape: BgShape;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  size?: number;
}) {
  const size = options.size ?? 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable");
  }

  drawBackgroundShape(
    context,
    size,
    options.backgroundShape,
    resolveCssColor(options.backgroundColor, "#209CEE"),
  );

  drawTextCenter({
    context,
    text: options.text,
    size,
    fontFamily: options.fontFamily,
    fontColor: options.fontColor,
    fontSize: options.fontSize,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    throw new Error("Failed to render text favicon preview");
  }
  return blob;
}

function createPreviewDataUrl(options: {
  text: string;
  fontFamily: string;
  fontColor: string;
  backgroundColor: string;
  backgroundShape: BgShape;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  size: number;
}) {
  const pixelRatio =
    typeof window !== "undefined"
      ? Math.max(1, Math.min(2, Math.ceil(window.devicePixelRatio || 1)))
      : 1;
  const canvas = document.createElement("canvas");
  canvas.width = options.size * pixelRatio;
  canvas.height = options.size * pixelRatio;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }
  context.scale(pixelRatio, pixelRatio);

  drawBackgroundShape(
    context,
    options.size,
    options.backgroundShape,
    resolveCssColor(options.backgroundColor, "#209CEE"),
  );

  drawTextCenter({
    context,
    text: options.text,
    size: options.size,
    fontFamily: options.fontFamily,
    fontColor: options.fontColor,
    fontSize: options.fontSize,
    fontWeight: options.fontWeight,
    fontStyle: options.fontStyle,
  });

  return canvas.toDataURL("image/png");
}

function ColorPalette({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const selected = normalizeHexForCompare(resolveCssColor(value, ""));
  const matrixRows = COLOR_SWATCHES.rows;

  return (
    <div className="mt-3 rounded-xl bg-[#e8e8ea] p-3">
      <div
        className="grid gap-0 overflow-hidden rounded-md"
        style={{
          gridTemplateColumns:
            "repeat(12, minmax(0, 1fr)) minmax(32px, 1.12fr) minmax(0, 1fr)",
        }}
      >
        {matrixRows.map((row, rowIndex) => (
          <React.Fragment key={`row-${rowIndex}`}>
            {row.map((color) => (
              <button
                key={`${rowIndex}-${color}`}
                type="button"
                onClick={() => onChange(compactHex(color))}
                className="aspect-square w-full transition"
                style={{
                  backgroundColor: color,
                  boxShadow:
                    selected === normalizeHexForCompare(color)
                      ? "inset 0 0 0 3px #ffffff"
                      : "none",
                }}
                aria-label={`Pick color ${color}`}
              />
            ))}
            <div aria-hidden className="h-full w-full" />
            <button
              type="button"
              onClick={() =>
                onChange(
                  compactHex(
                    COLOR_SWATCHES.grayscale[
                      Math.min(rowIndex, COLOR_SWATCHES.grayscale.length - 1)
                    ],
                  ),
                )
              }
              className="aspect-square w-full transition"
              style={{
                backgroundColor:
                  rowIndex < COLOR_SWATCHES.grayscale.length
                    ? COLOR_SWATCHES.grayscale[rowIndex]
                    : "transparent",
                boxShadow:
                  rowIndex < COLOR_SWATCHES.grayscale.length &&
                  selected ===
                    normalizeHexForCompare(COLOR_SWATCHES.grayscale[rowIndex])
                    ? "inset 0 0 0 3px #ffffff"
                    : "none",
              }}
              aria-label={`Pick grayscale ${
                COLOR_SWATCHES.grayscale[
                  Math.min(rowIndex, COLOR_SWATCHES.grayscale.length - 1)
                ]
              }`}
              disabled={rowIndex >= COLOR_SWATCHES.grayscale.length}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function FaviconGeneratorPage() {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = React.useState<GeneratorMode>("text");
  const [isDragging, setIsDragging] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  const [text, setText] = React.useState("F");
  const [fontColorInput, setFontColorInput] = React.useState("#FFFFFF");
  const [backgroundColorInput, setBackgroundColorInput] =
    React.useState("#209CEE");
  const [backgroundShape, setBackgroundShape] = React.useState<BgShape>("rounded");
  const [fontOptions, setFontOptions] = React.useState<GoogleFontOption[]>([]);
  const [fontKey, setFontKey] = React.useState<FontKey>("leckerli-one");
  const [fontVariantId, setFontVariantId] = React.useState("400-normal");
  const [fontSize, setFontSize] = React.useState(110);
  const [previewIcons, setPreviewIcons] = React.useState<string[]>([]);

  const htmlSnippet = React.useMemo(() => getFaviconHtmlSnippet(), []);
  const isFontListReady = fontOptions.length > 0;
  const selectedFont =
    fontOptions.find((item) => item.key === fontKey) ??
    fontOptions[0] ??
    FALLBACK_FONT_OPTION;
  const selectedVariant =
    selectedFont.variants.find((item) => item.id === fontVariantId) ??
    selectedFont.variants[0] ??
    FALLBACK_FONT_OPTION.variants[0];
  const fontColor = React.useMemo(
    () => resolveCssColor(fontColorInput, "#FFFFFF"),
    [fontColorInput],
  );
  const backgroundColor = React.useMemo(
    () => resolveCssColor(backgroundColorInput, "#209CEE"),
    [backgroundColorInput],
  );

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  React.useEffect(() => {
    let canceled = false;
    (async () => {
      const options = await loadGoogleFontOptions();
      if (canceled) {
        return;
      }
      setFontOptions(options);
      const preferred = options.find((item) => item.key === "leckerli-one");
      if (preferred) {
        setFontKey(preferred.key);
        setFontVariantId(preferred.variants[0]?.id ?? "400-normal");
        return;
      }
      if (options[0]) {
        setFontKey(options[0].key);
        setFontVariantId(options[0].variants[0]?.id ?? "400-normal");
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  React.useEffect(() => {
    if (mode !== "text") {
      return;
    }
    if (!isFontListReady) {
      return;
    }
    let canceled = false;
    (async () => {
      await ensureGoogleFontVariantLoaded(selectedFont, selectedVariant);
      if (typeof document !== "undefined" && document.fonts) {
        const sampleSize = Math.max(32, fontSize);
        await document.fonts.load(
          `${selectedVariant.style} ${selectedVariant.weight} ${sampleSize}px "${selectedFont.family}"`,
        );
      }
      if (canceled) {
        return;
      }
      const next = [48, 32, 16].map((size) =>
        createPreviewDataUrl({
          text,
          fontFamily: selectedFont.family,
          fontColor,
          backgroundColor,
          backgroundShape,
          fontSize,
          fontWeight: selectedVariant.weight,
          fontStyle: selectedVariant.style,
          size,
        }),
      );
      if (!canceled) {
        setPreviewIcons(next.filter(Boolean));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    mode,
    isFontListReady,
    text,
    selectedFont,
    fontColor,
    backgroundColor,
    backgroundShape,
    fontSize,
    selectedVariant,
  ]);

  React.useEffect(() => {
    if (!isFontListReady) {
      return;
    }
    if (!selectedFont.variants.some((item) => item.id === fontVariantId)) {
      setFontVariantId(selectedFont.variants[0]?.id ?? "400-normal");
    }
  }, [isFontListReady, selectedFont, fontVariantId]);

  React.useEffect(() => {
    if (!isFontListReady) {
      return;
    }
    // Preload selected font for faster first paint on mode switch/download.
    void ensureGoogleFontVariantLoaded(selectedFont, selectedVariant);
  }, [isFontListReady, selectedFont, selectedVariant]);

  const onFileSelected = React.useCallback((file: File | null) => {
    if (!file) {
      return;
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Only PNG, JPG, JPEG, BMP and WebP are supported");
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
    if (isGenerating) {
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      if (mode === "image") {
        if (!selectedFile) {
          setError("Please upload an image first.");
          return;
        }
        const files = await generateFaviconFromImage(selectedFile);
        await downloadFaviconZip(files);
        return;
      }

      if (typeof document !== "undefined" && document.fonts) {
        await ensureGoogleFontVariantLoaded(selectedFont, selectedVariant);
        await document.fonts.load(
          `${selectedVariant.style} ${selectedVariant.weight} ${fontSize}px "${selectedFont.family}"`,
        );
      }

      const textBlob = await renderTextFaviconBlob({
        text,
        fontFamily: selectedFont.family,
        fontColor,
        backgroundColor,
        backgroundShape,
        fontSize,
        fontWeight: selectedVariant.weight,
        fontStyle: selectedVariant.style,
      });

      const textFile = new File([textBlob], "text-favicon.png", {
        type: "image/png",
      });
      const files = await generateFaviconFromImage(textFile);
      await downloadFaviconZip(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Favicon generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const onCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(htmlSnippet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    }
  };

  return (
    <main className="w-full bg-[#efefef] text-[#1f2328]">
      <section className="border-b border-[#d9dce0] bg-[#f2f3f5] px-5 py-3 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-8 sm:gap-10">
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-md border border-[#d3d7dd] bg-white px-3 py-2"
          >
            <Image
              src="/images/logo1.png"
              alt="NanoImg logo"
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
            />
            <span className="text-2xl font-extrabold tracking-tight text-[#3b3f44] sm:text-3xl">
              NanoImg
            </span>
          </Link>

          <nav className="flex items-center gap-6 text-xl font-semibold text-[#4a4f55] sm:gap-10 sm:text-2xl">
            <button
              type="button"
              onClick={() => setMode("image")}
              className={`transition hover:text-[#1f2328] ${mode === "image" ? "text-[#1f2328]" : ""}`}
            >
              Converter
            </button>
            <button
              type="button"
              onClick={() => setMode("text")}
              className={`transition hover:text-[#1f2328] ${mode === "text" ? "text-[#1f2328]" : ""}`}
            >
              Generator
            </button>
          </nav>
        </div>
      </section>

      <section className="bg-[#08090c] px-5 pb-20 pt-16 text-white sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1200px]">
          <h1 className="max-w-[760px] text-3xl font-extrabold leading-[1.2] tracking-[0.01em] sm:text-5xl">
            {mode === "text"
              ? "Favicon Generator / Generate from Text"
              : "Favicon Generator / Generate from Image"}
          </h1>
          <p className="mt-5 max-w-[820px] text-base text-white/70 sm:text-lg sm:leading-[1.6]">
            {mode === "text"
              ? "Quickly generate your favicon from text by selecting the text, fonts, and colors. Download your favicon in the most up to date formats."
              : "Quickly generate your favicon from an image by uploading your image below. Download your favicon in the most up to date formats."}
          </p>
        </div>
      </section>

      <section className="px-5 pb-6 pt-0 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1200px] rounded-b-md bg-[#ebebee] px-6 py-3 text-[#555b62]">
          <Link href="/" className="text-[#377ce5] hover:underline">
            Home
          </Link>
          <span className="mx-3 text-[#a4a8ad]">→</span>
          <span>{mode === "text" ? "Text Generator" : "Image Generator"}</span>
        </div>
      </section>

      <section className="px-5 pb-8 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <strong className="text-[#2e3136]">Preview</strong>
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
              {isGenerating ? "Generating..." : "Download"}
            </button>
          </div>
        </div>
      </section>

      {mode === "text" ? (
        <section className="px-5 pb-10 sm:px-8 lg:px-12">
          <div className="mx-auto w-full max-w-[1240px] rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
            <h2 className="text-2xl font-bold text-[#2e3136] sm:text-3xl">
              Generate From Text
            </h2>

            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    Text
                  </span>
                  <input
                    value={text}
                    onChange={(event) => setText(event.target.value.toUpperCase().slice(0, 2))}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    Background
                  </span>
                  <select
                    value={backgroundShape}
                    onChange={(event) => setBackgroundShape(event.target.value as BgShape)}
                    className="w-full rounded-md border border-[#d6d7db] px-3 py-2 text-base outline-none focus:border-[#209cee]"
                  >
                    <option value="square">Square</option>
                    <option value="circle">Circle</option>
                    <option value="rounded">Rounded</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#3a3f45]">
                    Font Family (
                    <a
                      href="https://fonts.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#377ce5] hover:underline"
                    >
                      view all on Google Fonts
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
                    Font Variant
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
                    Font Size
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
                    Font Color
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
                    Background Color
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
              Converter
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
                Drag and drop your file here or click here to upload.
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

      <section className="px-5 pb-16 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-[1240px] rounded-xl border border-[#dfdfdf] bg-white p-6 shadow-[0_10px_30px_rgba(11,12,15,0.04)]">
          <h3 className="text-2xl font-bold text-[#24292f] sm:text-3xl">Why favicon.io?</h3>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            Whether you want to generate a favicon from text, from an existing image, or from an
            emoji we&apos;ve got you covered. The favicon generator is completely free and extremely
            easy to use. The generated favicon will work for all browsers and multiple platforms.
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            Getting started with the favicon generator
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            The tool above will allow you to generate a favicon from text. Start by choosing one
            to two letters for the favicon generator. Since the favicon generator outputs very
            small images it&apos;s important to use few characters for maximum legibility.
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            Making the background simple
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            Next, select the shape of the background. There are three simple shapes available:
            square, circle, and rounded. These are the most common shapes used to generate a
            favicon.
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            Selecting the font for your favicon
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            The favicon generator uses Google Fonts with many fonts available. This is useful to
            match the font used on your own website. You can edit the font size once you&apos;ve
            selected your font.
          </p>

          <h4 className="mt-7 text-2xl font-bold text-[#24292f] sm:text-3xl">
            Tailoring the colors
          </h4>
          <p className="mt-4 text-sm leading-[1.7] text-[#57606a] sm:text-base">
            The last step is to select the colors. If you have the HEX values of the colors you
            want, you can enter them directly into the input boxes. You can also use the color
            picker palettes below each input box.
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
