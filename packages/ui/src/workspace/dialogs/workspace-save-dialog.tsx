import React from "react";
import { FiSave } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceSaveDialog({ open, saving, onClose, onSave }: {
  open: boolean;
  saving: boolean;
  onClose(): void;
  onSave(choice: "replace" | "copy"): void;
}) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]"><FiSave /></div>
        <h2 className="min-w-0 text-base font-semibold text-slate-900">{text("saveImageQuestion")}</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text("saveImageConfirmationDescription")}</p>
      <footer className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={saving} onClick={onClose} className="h-9 rounded-md border px-4 text-sm disabled:opacity-40">{text("cancel")}</button><button type="button" disabled={saving} onClick={() => onSave("replace")} className="h-9 rounded-md border border-[#2f65cf] px-4 text-sm font-semibold text-[#2f65cf] disabled:opacity-50">{text("replaceOriginal")}</button><button type="button" disabled={saving} onClick={() => onSave("copy")} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? text("saving") : text("saveAsNewImage")}</button></footer>
    </section>
  </div>;
}
