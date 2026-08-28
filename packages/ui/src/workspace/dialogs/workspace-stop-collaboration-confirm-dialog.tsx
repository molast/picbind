import React from "react";
import { FiSave, FiShield, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { WorkspaceImage } from "../types";
import type { CollaborationSaveChoice } from "../hooks/use-workspace-save-collaboration";
import { WorkspaceSavePopover } from "./workspace-save-dialog";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceStopCollaborationConfirmDialog({ image, stopping, onClose, onConfirm, onSaveAndConfirm }: {
  image: WorkspaceImage | null;
  stopping: boolean;
  onClose(): void;
  onConfirm(): void | Promise<void>;
  onSaveAndConfirm(choice: CollaborationSaveChoice): void | Promise<void>;
}) {
  const [saveOpen, setSaveOpen] = React.useState(false);
  React.useEffect(() => setSaveOpen(false), [image?.imageId]);
  if (!image) return null;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => !stopping && event.target === event.currentTarget && onClose()}>
    <section className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="stop-collaboration-title">
      <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700"><FiShield /></div><h2 id="stop-collaboration-title" className="min-w-0 text-base font-semibold text-slate-900">{text("stopCollaborationQuestion")}</h2></div><button type="button" disabled={stopping} onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-40" aria-label={text("close")}><FiX /></button></div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text("stopCollaborationDescription")}</p>
      <p className="mt-2 truncate text-xs text-slate-400">{image.name}</p>
      <footer className="mt-5 grid gap-2 sm:grid-cols-[auto_1fr_1fr]"><button type="button" disabled={stopping} onClick={onClose} className="h-9 rounded-md border px-4 text-sm disabled:opacity-40">{text("cancel")}</button><button type="button" disabled={stopping} onClick={() => void onConfirm()} className="h-9 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">{text("stopDirectly")}</button><div className="relative"><button type="button" disabled={stopping} onClick={() => setSaveOpen((value) => !value)} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[#2f65cf] px-3 text-sm font-semibold text-white hover:bg-[#2457bd] disabled:opacity-50" aria-haspopup="menu" aria-expanded={saveOpen}><FiSave />{stopping ? text("stoppingCollaboration") : text("saveAndStopCollaboration")}</button><WorkspaceSavePopover open={saveOpen} saving={stopping} onClose={() => setSaveOpen(false)} onSave={(choice) => void onSaveAndConfirm(choice)} /></div></footer>
    </section>
  </div>;
}
