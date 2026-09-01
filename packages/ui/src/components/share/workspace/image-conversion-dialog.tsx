"use client";

import React from "react";
import { FiCheck, FiLoader, FiX } from "react-icons/fi";
import { useImageProcessing } from "../../../image-processing";
import type { WorkspaceEditorImage } from "../workspace-editor-types";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";
import { formatBytes } from "../workspace-formatters";
import { type WorkspaceConversionFormat } from "../../../utils/workspace-image-conversion";
import type { WorkspaceImageEditResult } from "../../../utils/workspace-image-editing";

type ImageConversionDialogProps = {
  image: WorkspaceEditorImage | null;
  labels: WorkspaceEditorLabels;
  onClose(): void;
  onSave(source: WorkspaceEditorImage, result: WorkspaceImageEditResult): void | Promise<void>;
};

const FORMATS: Array<{ value: WorkspaceConversionFormat; label: string }> = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
];

function formatFromMime(type: string): WorkspaceConversionFormat {
  const subtype = type.split("/")[1]?.toLowerCase();
  if (subtype === "jpg" || subtype === "jpeg") return "jpeg";
  if (subtype === "png" || subtype === "webp" || subtype === "avif") return subtype;
  return "jpeg";
}

function defaultTarget(source: WorkspaceConversionFormat): WorkspaceConversionFormat {
  return source === "webp" ? "avif" : "webp";
}

export default function ImageConversionDialog({ image, labels, onClose, onSave }: ImageConversionDialogProps) {
  const imageProcessing = useImageProcessing();
  const sourceFormat = image ? formatFromMime(image.type) : "jpeg";
  const [format, setFormat] = React.useState<WorkspaceConversionFormat>("webp");
  const [result, setResult] = React.useState<WorkspaceImageEditResult | null>(null);
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
  const targetFormats = FORMATS.filter((item) => item.value !== sourceFormat);

  const startConversion = () => {
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setWorking(true);
    setResult(null);
    setError(null);
    void imageProcessing.convert({
      source: { kind: "blob", blob: image.blob, name: image.name, mimeType: image.type },
      format,
      allowAlphaLoss: format === "jpeg",
      destination: "memory",
    }, {
      requestId: `workspace-convert:${crypto.randomUUID()}`,
      signal: abortController.signal,
    }).then((nextResult) => {
      if (generationRef.current !== generation || nextResult.artifact.kind !== "blob") return;
      setResult({
        blob: nextResult.artifact.blob,
        name: nextResult.name,
        width: nextResult.metadata.width,
        height: nextResult.metadata.height,
        operation: "convert",
        parameters: { format },
      });
    }).catch((reason) => {
      if (generationRef.current === generation && !abortController.signal.aborted) {
        setError(reason instanceof Error ? reason.message : labels.conversionFailed);
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
      <section className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.convertImage}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{labels.convertImage}</h2>
            <p className="mt-0.5 max-w-sm truncate text-xs text-slate-500">{image.name}</p>
          </div>
          <button type="button" onClick={closeDialog} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={labels.closeDialog}><FiX className="h-4 w-4" aria-hidden="true" /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2">
            {targetFormats.map((item) => (
              <button key={item.value} type="button" disabled={working} onClick={() => { setFormat(item.value); setResult(null); setError(null); }} className={`h-9 rounded-md border text-xs font-semibold transition ${format === item.value ? "border-[#2f65cf] bg-blue-50 text-[#2f65cf]" : "border-slate-200 text-slate-600 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}>{item.label}</button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span>{sourceFormat.toUpperCase()}</span><span className="text-slate-400">→</span><span className="text-[#2f65cf]">{format.toUpperCase()}</span>
          </div>
          {result && previewUrl ? (
            <div className="space-y-3">
              <div className="aspect-video overflow-hidden rounded-md bg-slate-100"><img src={previewUrl} alt={labels.conversionPreview} className="h-full w-full object-contain" /></div>
              <div className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                <span>{labels.originalSizeLabel}: {formatBytes(image.size)}</span><span>{labels.resultSizeLabel}: {formatBytes(result.blob.size)}</span>
                <span>{labels.formatLabel}: {format.toUpperCase()}</span><span>{labels.dimensionsLabel}: {result.width} × {result.height}</span>
              </div>
            </div>
          ) : null}
          {format === "jpeg" ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{labels.jpegTransparencyWarning}</p> : null}
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={working ? cancelConversion : closeDialog} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">{working ? labels.cancelConversion : labels.cancel}</button>
          {result ? (
            <button type="button" onClick={() => void onSave(image, result)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd]"><FiCheck className="h-4 w-4" aria-hidden="true" />{labels.continue}</button>
          ) : (
            <button type="button" disabled={working || format === sourceFormat} onClick={startConversion} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50">{working ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{working ? labels.converting : labels.startConversion}</button>
          )}
        </footer>
      </section>
    </div>
  );
}
