"use client";

import React from "react";
import { FiCheck, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";

export function WorkspacePreviewCloseDialog({ open, saving, onSave, onDiscard, onCancel }: {
  open: boolean;
  saving: boolean;
  onSave(): void;
  onDiscard(): void;
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
  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <section className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workspace-preview-close-title">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="workspace-preview-close-title" className="text-base font-semibold text-slate-900">{labels.savePreviewChanges || "Save preview changes?"}</h2><p className="mt-1 text-sm leading-5 text-slate-600">{labels.savePreviewChangesDescription || "This image has unapplied preview changes."}</p></div>
        <button type="button" onClick={onCancel} disabled={saving} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={labels.close}><FiX /></button>
      </div>
      <div className="mt-5 grid gap-2">
        <button type="button" onClick={onSave} disabled={saving} className="flex w-full items-center gap-3 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-3 text-left hover:bg-blue-50 disabled:opacity-50"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 text-[#2f65cf]"><FiCheck /></span><span><strong className="block text-xs text-slate-800">{labels.savePreviewChanges || "Save changes"}</strong><span className="mt-0.5 block text-[11px] text-slate-500">{labels.savePreviewChangesDescription || "Keep the edits when returning to the gallery."}</span></span></button>
        <button type="button" onClick={onDiscard} disabled={saving} className="flex w-full items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left hover:bg-slate-50 disabled:opacity-50"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600"><FiX /></span><span><strong className="block text-xs text-slate-800">{labels.discardPreviewChanges || "Discard changes"}</strong><span className="mt-0.5 block text-[11px] text-slate-500">{labels.discardPreviewChangesDescription || "Leave the image unchanged."}</span></span></button>
      </div>
      <footer className="mt-4 flex justify-end"><button type="button" onClick={onCancel} disabled={saving} className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">{labels.cancel}</button></footer>
    </section>
  </div>;
}
