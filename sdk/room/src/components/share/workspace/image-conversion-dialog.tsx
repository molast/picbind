"use client";

import React from "react";
import { FiCheck, FiLoader, FiX } from "react-icons/fi";
import type { RoomImage } from "../share-room-types";
import { formatBytes } from "../share-room-formatters";
import {
  convertRoomImageTask,
  type RoomConversionFormat,
} from "../../../utils/room-image-conversion";
import type { RoomImageEditResult } from "../../../utils/room-image-editing";

type ImageConversionDialogProps = {
  image: RoomImage | null;
  onClose(): void;
  onSave(source: RoomImage, result: RoomImageEditResult): void | Promise<void>;
};

const FORMATS: Array<{ value: RoomConversionFormat; label: string }> = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
];

function formatFromMime(type: string): RoomConversionFormat {
  const subtype = type.split("/")[1]?.toLowerCase();
  if (subtype === "jpg" || subtype === "jpeg") return "jpeg";
  if (subtype === "png" || subtype === "webp" || subtype === "avif") return subtype;
  return "jpeg";
}

function defaultTarget(source: RoomConversionFormat): RoomConversionFormat {
  return source === "webp" ? "avif" : "webp";
}

export default function ImageConversionDialog({ image, onClose, onSave }: ImageConversionDialogProps) {
  const sourceFormat = image ? formatFromMime(image.type) : "jpeg";
  const [format, setFormat] = React.useState<RoomConversionFormat>("webp");
  const [result, setResult] = React.useState<RoomImageEditResult | null>(null);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const generationRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const previewUrl = React.useMemo(() => result ? URL.createObjectURL(result.blob) : null, [result]);

  const cancelConversion = React.useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setWorking(false);
  }, []);
  const closeDialog = React.useCallback(() => {
    cancelConversion();
    onClose();
  }, [cancelConversion, onClose]);

  React.useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  React.useEffect(() => {
    if (!image) return;
    cancelConversion();
    setFormat(defaultTarget(formatFromMime(image.type)));
    setResult(null);
    setError(null);
  }, [cancelConversion, image]);
  React.useEffect(() => () => abortRef.current?.abort(), []);
  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") closeDialog(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeDialog, image]);

  if (!image) return null;

  const startConversion = () => {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setWorking(true);
    setResult(null);
    setError(null);
    void convertRoomImageTask(
      new File([image.blob], image.name, { type: image.type }),
      format,
      abortController.signal,
    ).then((nextResult) => {
      if (generationRef.current === generation) setResult(nextResult);
    }).catch((reason) => {
      if (generationRef.current === generation && (!(reason instanceof DOMException) || reason.name !== "AbortError")) {
        setError(reason instanceof Error ? reason.message : "格式转换失败");
      }
    }).finally(() => {
      if (generationRef.current === generation) {
        abortRef.current = null;
        setWorking(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="转换图片格式">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">转换图片格式</h2>
            <p className="mt-0.5 max-w-sm truncate text-xs text-slate-500">{image.name}</p>
          </div>
          <button type="button" onClick={closeDialog} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="关闭"><FiX className="h-4 w-4" aria-hidden="true" /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-4 gap-2">
            {FORMATS.map((item) => {
              const current = item.value === sourceFormat;
              return <button key={item.value} type="button" disabled={current || working} onClick={() => { setFormat(item.value); setResult(null); setError(null); }} className={`h-9 rounded-md border text-xs font-semibold transition ${format === item.value ? "border-[#2f65cf] bg-blue-50 text-[#2f65cf]" : "border-slate-200 text-slate-600 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300`}>{item.label}{current ? " · 当前" : ""}</button>;
            })}
          </div>
          <div className="flex items-center justify-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span>{sourceFormat.toUpperCase()}</span><span className="text-slate-400">→</span><span className="text-[#2f65cf]">{format.toUpperCase()}</span>
          </div>
          {result && previewUrl ? (
            <div className="space-y-3">
              <div className="aspect-video overflow-hidden rounded-md bg-slate-100"><img src={previewUrl} alt="转换结果预览" className="h-full w-full object-contain" /></div>
              <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                <span>原图：{formatBytes(image.size)}</span><span>结果：{formatBytes(result.blob.size)}</span>
                <span>格式：{format.toUpperCase()}</span><span>尺寸：{result.width} × {result.height}</span>
              </div>
            </div>
          ) : null}
          {format === "jpeg" ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">JPEG 不支持透明通道；存在真实透明像素时会停止转换，不会压平背景。</p> : null}
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={working ? cancelConversion : closeDialog} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">{working ? "取消转换" : "取消"}</button>
          {result ? (
            <button type="button" onClick={() => void onSave(image, result)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd]"><FiCheck className="h-4 w-4" aria-hidden="true" />继续</button>
          ) : (
            <button type="button" disabled={working || format === sourceFormat} onClick={startConversion} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50">{working ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{working ? "转换中" : "开始转换"}</button>
          )}
        </footer>
      </section>
    </div>
  );
}
