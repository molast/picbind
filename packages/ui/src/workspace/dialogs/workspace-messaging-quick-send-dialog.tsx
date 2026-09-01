"use client";

import React from "react";
import { FiLoader, FiSend, FiX, FiZap } from "react-icons/fi";
import type { WorkspaceEditorLabels } from "../../locales";
import { formatBytes, middleEllipsisFileName } from "../../components/share/workspace-formatters";
import type { WorkspacePreparedMessagingImage } from "../types";

export function WorkspaceMessagingQuickSendDialog({
  prepared,
  labels,
  sending,
  error,
  onConfirm,
  onClose,
}: {
  prepared: WorkspacePreparedMessagingImage | null;
  labels: WorkspaceEditorLabels;
  sending: boolean;
  error?: string | null;
  onConfirm(): boolean | void | Promise<boolean | void>;
  onClose(): void;
}) {
  React.useEffect(() => {
    if (!prepared) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sending) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, prepared, sending]);

  if (!prepared) return null;

  return <div className="fixed inset-0 z-[135] flex items-center justify-center bg-slate-950/55 p-4">
    <section className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.messagingQuickSendTitle}>
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{labels.messagingQuickSendTitle}</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">{labels.messagingQuickSendHint}</p>
        </div>
        <button type="button" onClick={onClose} disabled={sending} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={labels.closeDialog}><FiX className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-5">
        <div className="relative flex min-h-56 max-h-[56vh] items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white">
          <img src={prepared.previewUrl} alt={prepared.file.name} className="max-h-[56vh] max-w-full object-contain" />
          {sending ? <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[1px]" role="status" aria-live="polite"><span className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow"><FiLoader className="h-4 w-4 animate-spin text-[#2f65cf]" />{labels.messagingSendingImage}</span></div> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <strong className="block max-w-[28rem] truncate text-xs font-semibold text-slate-800" title={prepared.file.name}>{middleEllipsisFileName(prepared.file.name, 52)}</strong>
            <span className="mt-1 block text-[10px] text-slate-500">{prepared.width} × {prepared.height}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[10px] text-slate-500">
            <span>{labels.messagingOriginalSize} <strong className="font-semibold text-slate-700">{formatBytes(prepared.originalSize)}</strong></span>
            <span>{labels.messagingSendSize} <strong className="font-semibold text-slate-700">{formatBytes(prepared.file.size)}</strong></span>
            <span className="inline-flex h-6 items-center gap-1 rounded bg-blue-50 px-2 font-semibold text-[#2f65cf]"><FiZap className="h-3 w-3" />{prepared.returnedOriginal ? labels.messagingOriginalRetained : labels.messagingFastCompression}</span>
          </div>
        </div>
        {error ? <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </div>

      <footer className="flex min-h-16 shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <button type="button" onClick={onClose} disabled={sending} className="h-9 rounded-md px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">{labels.cancel}</button>
        <button type="button" onClick={() => void onConfirm()} disabled={sending} className="inline-flex h-9 min-w-24 items-center justify-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-50">{sending ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiSend className="h-3.5 w-3.5" />}{sending ? labels.messagingSendingImage : labels.messagingSendNow}</button>
      </footer>
    </section>
  </div>;
}
