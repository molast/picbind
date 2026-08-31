import React from "react";
import { createPortal } from "react-dom";
import { FiLoader, FiRotateCcw, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { WorkspaceImage } from "../types";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceRestoreConfirmDialog({ image, restoring, onClose, onConfirm }: {
  image: WorkspaceImage | null;
  restoring: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !restoring) onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [image, onClose, restoring]);

  if (!image || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !restoring && onClose()}
    >
      <section className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="workspace-restore-title">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700"><FiRotateCcw /></span>
            <div className="min-w-0">
              <h2 id="workspace-restore-title" className="text-base font-semibold text-slate-900">{text("restoreOriginalQuestion")}</h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">{text("restoreOriginalDescription")}</p>
              <p className="mt-1 truncate text-xs text-slate-400">{image.name}</p>
            </div>
          </div>
          <button type="button" disabled={restoring} onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={text("close")}><FiX /></button>
        </div>
        <footer className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={restoring} onClick={onClose} className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">{text("cancel")}</button>
          <button type="button" disabled={restoring} onClick={onConfirm} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">{restoring ? <FiLoader className="animate-spin" /> : <FiRotateCcw />}{text("confirmRestoreOriginal")}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
