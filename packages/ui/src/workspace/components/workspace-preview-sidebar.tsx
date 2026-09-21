"use client";

import React from "react";
import { FiCrosshair, FiImage } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { WorkspaceImage } from "../types";
import type { WorkspacePreviewSelection } from "../workspace-preview-selection";

export type WorkspacePreviewCursor = {
  x: number;
  y: number;
  rgba: [number, number, number, number];
  hex: string;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function rgbToCmyk([red, green, blue]: [number, number, number, number]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const key = 1 - Math.max(r, g, b);
  if (key >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - r - key) / (1 - key)) * 100,
    m: ((1 - g - key) / (1 - key)) * 100,
    y: ((1 - b - key) / (1 - key)) * 100,
    k: key * 100,
  };
}

function rgbToHsb([red, green, blue]: [number, number, number, number]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max ? (delta / max) * 100 : 0, brightness: max * 100 };
}

function ValueCell({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-3 py-1.5 text-[13px]">
    <span className="text-slate-500">{label}: </span>
    <strong className="font-normal tabular-nums text-slate-700">{value}</strong>
  </div>;
}

function PreviewThumbnail({ source }: { source?: HTMLCanvasElement }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d")?.drawImage(source, 0, 0);
  }, [source, source?.width, source?.height]);
  if (!source) return <div className="flex h-full w-full items-center justify-center text-slate-400"><FiImage className="h-6 w-6" /></div>;
  return <canvas ref={ref} className="block h-full w-full object-contain" aria-label="" />;
}

export function WorkspacePreviewSidebar({ image, source, width, height, selection, cursor }: {
  image: WorkspaceImage;
  source?: HTMLCanvasElement;
  width: number;
  height: number;
  selection?: WorkspacePreviewSelection | null;
  cursor: WorkspacePreviewCursor | null;
}) {
  const labels = getWorkspaceLabels(getLang());
  const mime = image.mimeType.replace("image/", "").toUpperCase();
  const cmyk = cursor ? rgbToCmyk(cursor.rgba) : null;
  const hsb = cursor ? rgbToHsb(cursor.rgba) : null;
  const value = (formatted: string) => cursor ? formatted : "-";
  const selectionWidth = selection ? Math.max(1, Math.round(selection.width * width)) : width;
  const selectionHeight = selection ? Math.max(1, Math.round(selection.height * height)) : height;
  return <aside className="border-t border-[#dfe3e8] bg-white text-[#172033] lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0" aria-label={labels.imageInformation}>
    <section className="border-b border-[#e4e7eb] px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[#26344c]"><FiImage aria-hidden="true" /><span>{labels.imageInformation}</span></div>
      <div className="mt-3 grid grid-cols-[62px_minmax(0,1fr)] items-center gap-3">
        <div className="h-[62px] w-[62px] overflow-hidden rounded-sm border border-slate-200 bg-slate-50"><PreviewThumbnail source={source} /></div>
        <div className="min-w-0">
          <strong className="block truncate text-[13px] font-medium text-slate-800" title={image.name}>{image.name}</strong>
          <span className="mt-1 block text-[11px] text-slate-500">{width} x {height} · {mime}</span>
          <span className="mt-1 block text-[11px] text-slate-500">{formatBytes(image.size)}</span>
        </div>
      </div>
    </section>
    <section className="border-b border-[#e4e7eb] py-2" aria-label={labels.cursorColor || "Color"}>
      <div className="px-3 pb-1 text-[10px] font-semibold tracking-wide text-slate-500" style={{ textTransform: "none" }}>{labels.cursorColor || "Cursor color"}</div>
      <div className="grid grid-cols-2">
        <div>
          <ValueCell label="R" value={value(cursor ? String(cursor.rgba[0]) : "-")} />
          <ValueCell label="G" value={value(cursor ? String(cursor.rgba[1]) : "-")} />
          <ValueCell label="B" value={value(cursor ? String(cursor.rgba[2]) : "-")} />
          <ValueCell label="A" value={value(cursor ? String(cursor.rgba[3]) : "-")} />
        </div>
        <div>
          <ValueCell label="C" value={value(cmyk ? formatPercent(cmyk.c) : "-")} />
          <ValueCell label="M" value={value(cmyk ? formatPercent(cmyk.m) : "-")} />
          <ValueCell label="Y" value={value(cmyk ? formatPercent(cmyk.y) : "-")} />
          <ValueCell label="K" value={value(cmyk ? formatPercent(cmyk.k) : "-")} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 border-t border-slate-200 px-3 pt-2 text-[11px] text-slate-500">
        <span className="h-5 w-5 shrink-0 rounded-sm border border-slate-300" style={{ backgroundColor: cursor?.hex || "transparent" }} aria-hidden="true" />
        <span className="font-mono uppercase">{cursor?.hex || "-"}</span>
        <span className="truncate text-slate-400">{labels.cursorColor || "Cursor color"}</span>
      </div>
    </section>
    <section className="border-b border-[#e4e7eb] py-2" aria-label={labels.cursorPosition || "Position"}>
      <div className="px-3 pb-1 text-[10px] font-semibold tracking-wide text-slate-500" style={{ textTransform: "none" }}>{labels.cursorPosition || "Cursor position"}</div>
      <div className="grid grid-cols-2">
        <div><ValueCell label="X" value={value(cursor ? `${cursor.x}px` : "-")} /><ValueCell label="Y" value={value(cursor ? `${cursor.y}px` : "-")} /></div>
        <div><ValueCell label="W" value={`${selectionWidth}px`} /><ValueCell label="H" value={`${selectionHeight}px`} /></div>
      </div>
    </section>
    <section className="py-2" aria-label="HSB">
      <ValueCell label="H" value={value(hsb ? `${Math.round(hsb.hue)}°` : "-")} />
      <ValueCell label="S" value={value(hsb ? formatPercent(hsb.saturation) : "-")} />
      <ValueCell label="B" value={value(hsb ? formatPercent(hsb.brightness) : "-")} />
    </section>
  </aside>;
}
