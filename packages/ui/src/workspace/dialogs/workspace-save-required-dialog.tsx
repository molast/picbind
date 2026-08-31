import React from "react";
import { createPortal } from "react-dom";
import { FiCopy, FiLoader, FiRefreshCw, FiSave, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { CollaborationSaveChoice } from "../hooks/use-workspace-save-collaboration";
import type { WorkspaceImage } from "../types";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export type WorkspaceSaveRequiredAction = "download" | "collaborate" | "save" | "stop";

export function WorkspaceSaveRequiredDialog({ image, action, saving, onClose, onSave }: {
  image: WorkspaceImage | null;
  action: WorkspaceSaveRequiredAction;
  saving: boolean;
  onClose(): void;
  onSave(choice: CollaborationSaveChoice): void;
}) {
  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [image, onClose, saving]);

  if (!image || typeof document === "undefined") return null;
  const description = action === "download"
    ? text("saveBeforeDownload")
    : action === "collaborate"
      ? text("saveBeforeCollaboration")
      : text("saveImageConfirmationDescription");

  return createPortal(<div
    className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4"
    onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
  >
    <section className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workspace-save-required-title">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700"><FiSave /></span>
          <div className="min-w-0">
            <h2 id="workspace-save-required-title" className="text-base font-semibold text-slate-900">{text("saveImageQuestion")}</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{image.name}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={text("close")}><FiX /></button>
      </div>

      <div className="mt-5 grid gap-2">
        <button type="button" disabled={saving} onClick={() => onSave("replace")} className="flex w-full items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-left hover:border-blue-200 hover:bg-blue-50/50 disabled:opacity-50">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">{saving ? <FiLoader className="animate-spin" /> : <FiRefreshCw />}</span>
          <span className="min-w-0"><strong className="block text-xs text-slate-800">{text("replaceOriginal")}</strong><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{text("replaceOriginalDescription")}</span></span>
        </button>
        <button type="button" disabled={saving} onClick={() => onSave("copy")} className="flex w-full items-start gap-3 rounded-md border border-slate-200 px-3 py-3 text-left hover:border-emerald-200 hover:bg-emerald-50/50 disabled:opacity-50">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">{saving ? <FiLoader className="animate-spin" /> : <FiCopy />}</span>
          <span className="min-w-0"><strong className="block text-xs text-slate-800">{text("saveAsNewImage")}</strong><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{text("saveAsNewImageDescription")}</span></span>
        </button>
      </div>
      <footer className="mt-4 flex justify-end"><button type="button" disabled={saving} onClick={onClose} className="h-9 rounded-md border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">{text("cancel")}</button></footer>
    </section>
  </div>, document.body);
}
