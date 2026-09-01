"use client";

import React from "react";
import { FiLink, FiLoader, FiUnlock, FiX } from "react-icons/fi";
import { emptyImageParameterDocument, setImageOperation } from "@picbind/shared";
import { useImageProcessing } from "../../../image-processing";
import type { WorkspaceEditorImage } from "../workspace-editor-types";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";
import { type WorkspaceImageEditResult } from "../../../utils/workspace-image-editing";
import KonvaResizePreview from "./konva-resize-preview";

type ImageResizeDialogProps = {
  image: WorkspaceEditorImage | null;
  posterUrl?: string | null;
  editorBaseReady?: boolean;
  labels: WorkspaceEditorLabels;
  onClose(): void;
  onSave(source: WorkspaceEditorImage, result: WorkspaceImageEditResult): void | Promise<void>;
  parameterAction?: "apply" | "proposal";
  onApplyParameters?(size: { width: number; height: number }): void | Promise<void>;
  initialSize?: { width: number; height: number };
};

const MAX_DIMENSION = 16384;

function validDimension(value: number) {
  return Number.isFinite(value) && value >= 1 && value <= MAX_DIMENSION;
}

export default function ImageResizeDialog({ image, posterUrl, editorBaseReady = true, labels, onClose, onSave, parameterAction, onApplyParameters, initialSize }: ImageResizeDialogProps) {
  const imageProcessing = useImageProcessing();
  const [width, setWidth] = React.useState(1);
  const [height, setHeight] = React.useState(1);
  const [locked, setLocked] = React.useState(true);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ratioRef = React.useRef(1);

  React.useEffect(() => {
    if (!image) return;
    const nextWidth = Math.max(1, initialSize?.width || image.width || 1);
    const nextHeight = Math.max(1, initialSize?.height || image.height || 1);
    ratioRef.current = nextWidth / nextHeight;
    setWidth(nextWidth);
    setHeight(nextHeight);
    setLocked(true);
    setWorking(false);
    setError(null);
  }, [image?.id, initialSize]);

  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [image?.id, onClose, working]);

  if (!image) return null;
  const valid = validDimension(width) && validDimension(height);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.resizeImage}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{labels.resizeImage}</h2>
            <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{image.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={working} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={labels.closeDialog}>
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <KonvaResizePreview imageUrl={image.url} posterUrl={posterUrl} editorBaseReady={editorBaseReady} targetWidth={width} targetHeight={height} />
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="space-y-1.5 text-xs font-medium text-slate-600">
              <span>{labels.widthPx}</span>
              <input type="number" min={1} max={MAX_DIMENSION} value={width} onChange={(event) => { const next = Number(event.target.value); setWidth(next); if (locked && validDimension(next)) setHeight(Math.max(1, Math.round(next / ratioRef.current))); }} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100" />
            </label>
            <button type="button" onClick={() => setLocked((value) => !value)} className={`mb-0.5 flex h-9 w-9 items-center justify-center rounded-md border transition ${locked ? "border-[#2f65cf] bg-blue-50 text-[#2f65cf]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} aria-label={locked ? labels.unlockAspectRatio : labels.lockAspectRatio} title={locked ? labels.aspectRatioLocked : labels.freelyResize}>
              {locked ? <FiLink className="h-4 w-4" aria-hidden="true" /> : <FiUnlock className="h-4 w-4" aria-hidden="true" />}
            </button>
            <label className="space-y-1.5 text-xs font-medium text-slate-600">
              <span>{labels.heightPx}</span>
              <input type="number" min={1} max={MAX_DIMENSION} value={height} onChange={(event) => { const next = Number(event.target.value); setHeight(next); if (locked && validDimension(next)) setWidth(Math.max(1, Math.round(next * ratioRef.current))); }} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-[#2f65cf] focus:ring-2 focus:ring-blue-100" />
            </label>
          </div>
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span>{labels.originalDimensions(image.width, image.height)}</span>
            <span>{locked ? labels.aspectRatioLocked : labels.freeDimensions}</span>
          </div>
          {!valid ? <p className="text-xs text-red-600">{labels.dimensionRangeError(MAX_DIMENSION)}</p> : null}
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} disabled={working} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">{labels.cancel}</button>
          <button type="button" disabled={!valid || working} onClick={() => {
            setWorking(true);
            setError(null);
            const size = { width, height };
            const task = parameterAction && onApplyParameters
              ? Promise.resolve().then(() => onApplyParameters(size))
              : imageProcessing.materialize({
                  source: { kind: "blob", blob: image.blob, name: image.name, mimeType: image.type },
                  document: setImageOperation(emptyImageParameterDocument(), {
                    id: crypto.randomUUID(), userId: "local", time: Date.now(), type: "resize", params: size,
                  }),
                  output: { format: "source" },
                  destination: "memory",
                }, { requestId: `workspace-resize:${crypto.randomUUID()}` }).then((result) => {
                  if (result.artifact.kind !== "blob") throw new Error(labels.resizeFailed);
                  return onSave(image, {
                    blob: result.artifact.blob, name: result.name, width: result.metadata.width,
                    height: result.metadata.height, operation: "resize", parameters: size,
                  });
                });
            void task.catch((reason) => setError(reason instanceof Error ? reason.message : labels.resizeFailed)).finally(() => setWorking(false));
          }} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50">
            {working ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {working?(parameterAction==="proposal"?labels.submittingProposal:parameterAction?labels.applyingChanges:labels.processing):parameterAction==="proposal"?labels.submitProposal:parameterAction?labels.applyChanges:labels.generateResult}
          </button>
        </footer>
      </section>
    </div>
  );
}
