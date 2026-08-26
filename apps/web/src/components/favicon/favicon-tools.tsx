"use client";

import React from "react";
import type { GoogleFontOption } from "@/utils/google-font-catalog";

export type GeneratorMode = "image" | "text";
export type BgShape = "square" | "circle" | "rounded";
export type FontKey = string;

export const FALLBACK_FONT_OPTION: GoogleFontOption = {
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

export const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/bmp",
  "image/webp",
]);

export const installFiles = [
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon.ico",
  "site.webmanifest",
];


export function resolveCssColor(input: string, fallback = "#FFFFFF") {
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
  const [r1, r2, g1, g2, b1, b2] = hex.slice(1).split("");
  if (r1 === r2 && g1 === g2 && b1 === b2) {
    return `#${r1}${g1}${b1}`;
  }
  return hex;
}

export function contrastTextColor(bgColor: string) {
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

export async function renderTextFaviconBlob(options: {
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

export function createPreviewDataUrl(options: {
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

export function ColorPalette({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (color: string) => void;
  compact?: boolean;
}) {
  const selected = normalizeHexForCompare(resolveCssColor(value, ""));
  const matrixRows = COLOR_SWATCHES.rows;

  return (
    <div className={compact ? "mt-2 rounded-md bg-slate-100 p-2" : "mt-3 rounded-xl bg-[#e8e8ea] p-3"}>
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
