"use client";

import React from "react";
import { FiCheck, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";

export function WorkspacePreviewPngDialog({ open, saving, onConfirm, onCancel }: {
  open: boolean;
  saving: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const labels = getWorkspaceLabels(getLang());
  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel, open, saving]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <section className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workspace-preview-png-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="workspace-preview-png-title" className="text-base font-semibold text-slate-900">{labels.previewTransparencyTitle || "Transparent area detected"}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">{labels.previewTransparencyDescription || "JPEG cannot store transparency. Save this result as PNG to keep the transparent area?"}</p>
        </div>
        <button type="button" onClick={onCancel} disabled={saving} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={labels.close}><FiX /></button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">{labels.cancel}</button>
        <button type="button" onClick={onConfirm} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50"><FiCheck aria-hidden="true" />{labels.saveAsPng || "Save as PNG"}</button>
      </div>
    </section>
  </div>;
}
