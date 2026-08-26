"use client";

import React from "react";
import { FiCheck, FiLink, FiLoader, FiX } from "react-icons/fi";
import { useImageProcessing } from "../../../image-processing";
import type { RoomImage } from "../share-room-types";
import type { ShareRoomLabels } from "../share-room-labels";
import { formatBytes } from "../share-room-formatters";
import {
  type RoomCompressionFormat,
  type RoomCompressionResult,
} from "../../../utils/room-image-compression";

type ImageCompressionDialogProps = {
  image: RoomImage | null;
  labels: ShareRoomLabels;
  onClose(): void;
  onSave(source: RoomImage, result: RoomCompressionResult): void | Promise<void>;
};

const MAX_DIMENSION = 16384;

function validDimension(value: number) {
  return Number.isFinite(value) && value >= 1 && value <= MAX_DIMENSION;
}

export default function ImageCompressionDialog({
  image,
  labels,
  onClose,
  onSave,
}: ImageCompressionDialogProps) {
  const imageProcessing = useImageProcessing();
  const [format, setFormat] = React.useState<RoomCompressionFormat>("auto");
  const [result, setResult] = React.useState<RoomCompressionResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);
  const [width, setWidth] = React.useState(1);
  const [height, setHeight] = React.useState(1);
  const ratioRef = React.useRef(1);
  const compressionGenerationRef = React.useRef(0);
  const compressionAbortRef = React.useRef<AbortController | null>(null);
  const cancelCompression = React.useCallback(() => {
    compressionGenerationRef.current += 1;
    compressionAbortRef.current?.abort();
    compressionAbortRef.current = null;
    setWorking(false);
  }, []);
  const closeDialog = React.useCallback(() => {
    cancelCompression();
    onClose();
  }, [cancelCompression, onClose]);
  const previewUrl = React.useMemo(
    () => (result ? URL.createObjectURL(result.blob) : null),
    [result],
  );

  React.useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  React.useEffect(() => {
    if (!image) return;
    compressionGenerationRef.current += 1;
    compressionAbortRef.current?.abort();
    compressionAbortRef.current = null;
    setFormat("auto");
    const nextWidth = Math.max(1, image.width || 1);
    const nextHeight = Math.max(1, image.height || 1);
    ratioRef.current = nextWidth / nextHeight;
    setWidth(nextWidth);
    setHeight(nextHeight);
    setResult(null);
    setError(null);
    setWorking(false);
  }, [image]);
  React.useEffect(
    () => () => {
      compressionAbortRef.current?.abort();
    },
    [],
  );

  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeDialog, image]);

  if (!image) return null;
  const savedBytes = result ? image.size - result.blob.size : 0;
  const savedPercent = image.size ? (savedBytes / image.size) * 100 : 0;
  const validSize = validDimension(width) && validDimension(height);
  const resized = width !== image.width || height !== image.height;
  const formats: Array<{ value: RoomCompressionFormat; label: string }> = [
    { value: "auto", label: labels.automatic },
    { value: "jpeg", label: "JPEG" },
    { value: "png", label: "PNG" },
    { value: "webp", label: "WebP" },
    { value: "avif", label: "AVIF" },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.imageCompress}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{labels.imageCompress}</h2>
            <p className="mt-0.5 max-w-sm truncate text-xs text-slate-500">{image.name}</p>
          </div>
          <button type="button" onClick={closeDialog} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={labels.closeDialog}>
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-5 gap-2">
            {formats.map((item) => (
              <button key={item.value} type="button" onClick={() => { setFormat(item.value); setResult(null); }} className={`h-9 rounded-md border text-xs font-semibold transition ${format === item.value ? "border-[#2f65cf] bg-blue-50 text-[#2f65cf]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <label className="space-y-1.5 text-xs font-medium text-slate-600">
                <span>{labels.widthPx}</span>
                <input type="number" min={1} max={MAX_DIMENSION} value={width} disabled={working} onChange={(event) => { const next = Number(event.target.value); setWidth(next); setResult(null); if (validDimension(next)) setHeight(Math.max(1, Math.round(next / ratioRef.current))); }} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100 disabled:opacity-50" />
              </label>
              <span className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-[#2f65cf] bg-blue-50 text-[#2f65cf]" aria-label={labels.aspectRatioLocked} title={labels.lockOriginalRatio}>
                <FiLink className="h-4 w-4" aria-hidden="true" />
              </span>
              <label className="space-y-1.5 text-xs font-medium text-slate-600">
                <span>{labels.heightPx}</span>
                <input type="number" min={1} max={MAX_DIMENSION} value={height} disabled={working} onChange={(event) => { const next = Number(event.target.value); setHeight(next); setResult(null); if (validDimension(next)) setWidth(Math.max(1, Math.round(next * ratioRef.current))); }} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100 disabled:opacity-50" />
              </label>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>{labels.originalDimensions(image.width, image.height)}</span>
              <span>{labels.lockOriginalRatio}</span>
            </div>
            {!validSize ? <p className="mt-2 text-xs text-red-600">{labels.dimensionRangeError(MAX_DIMENSION)}</p> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <h3 className="text-xs font-semibold text-slate-800">{labels.originalImage}</h3>
                <span className="text-[10px] font-medium uppercase text-slate-400">{image.type.split("/")[1] || "image"}</span>
              </div>
              <div className="aspect-video bg-slate-100">
                <img src={image.url} alt={image.name} className="h-full w-full object-contain" />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500">
                <span className="col-span-2 truncate font-semibold text-slate-700" title={image.name}>{image.name}</span>
                <span>{formatBytes(image.size)}</span>
                <span className="text-right">{image.width} × {image.height}</span>
              </div>
            </section>
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <h3 className="text-xs font-semibold text-slate-800">{labels.compressionResult}</h3>
                <span className="text-[10px] font-medium uppercase text-slate-400">{result?.format || labels.waitingForCompression}</span>
              </div>
              {result && previewUrl ? (
                <>
                  <div className="aspect-video bg-slate-100">
                    <img src={previewUrl} alt={labels.compressionPreview} className="h-full w-full object-contain" />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500">
                    <span className="col-span-2 truncate font-semibold text-slate-700" title={result.name}>{result.name}</span>
                    <span>{formatBytes(result.blob.size)}</span>
                    <span className="text-right">{result.width} × {result.height}</span>
                    <span className={`col-span-2 font-semibold ${savedBytes > 0 ? "text-emerald-700" : "text-slate-500"}`}>
                      {savedBytes > 0 ? labels.compressionReduced(formatBytes(savedBytes), savedPercent.toFixed(1)) : resized ? labels.resizedImageGenerated : labels.originalKept}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center bg-slate-50 text-center text-xs text-slate-400">
                  {working ? <FiLoader className="mb-2 h-5 w-5 animate-spin text-[#2f65cf]" aria-hidden="true" /> : null}
                  <span>{working ? labels.generatingCompression : labels.chooseFormatToCompress}</span>
                </div>
              )}
            </section>
          </div>
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={working ? cancelCompression : closeDialog} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">{working ? labels.cancelCompression : labels.cancel}</button>
          {result ? (
            <button type="button" onClick={() => void onSave(image, result)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd]">
              <FiCheck className="h-4 w-4" aria-hidden="true" />{labels.continue}
            </button>
          ) : (
            <button type="button" disabled={working || !validSize} onClick={() => {
              const generation = ++compressionGenerationRef.current;
              compressionAbortRef.current?.abort();
              const abortController = new AbortController();
              compressionAbortRef.current = abortController;
              setWorking(true);
              setError(null);
              void imageProcessing.compress({
                source: { kind: "blob", blob: image.blob, name: image.name, mimeType: image.type },
                options: { format, profile: "interactive", dimensions: { width, height } },
                destination: "memory",
              }, {
                requestId: `room-compress:${crypto.randomUUID()}`,
                signal: abortController.signal,
              }).then((nextResult) => {
                if (compressionGenerationRef.current !== generation || nextResult.artifact.kind !== "blob") return;
                const resultFormat = nextResult.metadata.format === "unknown"
                  ? format === "auto" ? "jpeg" : format
                  : nextResult.metadata.format;
                if (resultFormat === "gif" || resultFormat === "bmp" || resultFormat === "ico") {
                  throw new Error(labels.compressionFailed);
                }
                setResult({
                  blob: nextResult.artifact.blob,
                  format: resultFormat,
                  name: nextResult.name,
                  width: nextResult.metadata.width,
                  height: nextResult.metadata.height,
                  operation: "compress",
                  parameters: { format, width, height },
                });
              }).catch((reason) => {
                if (compressionGenerationRef.current === generation && !abortController.signal.aborted) {
                  setError(reason instanceof Error ? reason.message : labels.compressionFailed);
                }
              }).finally(() => {
                if (compressionGenerationRef.current === generation) {
                  compressionAbortRef.current = null;
                  setWorking(false);
                }
              });
            }} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50">
              {working ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{working ? labels.compressing : labels.startCompression}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
