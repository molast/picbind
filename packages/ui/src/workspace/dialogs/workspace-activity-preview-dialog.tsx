import React from "react";
import { FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { WorkspaceActivity, WorkspaceCommit, WorkspaceIdentity } from "../types";
import { BlobImageMedia } from "../components/workspace-image-media";
import { readableActivityName } from "../utils/workspace-activity-display";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

type ActivityPreview = { activity: WorkspaceActivity; parameterDocument: { operations: unknown[] }; preview: Blob };

export function WorkspaceActivityPreviewDialog({ preview, role, isCurrent, onClose, onRollback, onApprove, onReject }: {
  preview: ActivityPreview | null;
  role: WorkspaceIdentity["role"];
  isCurrent: boolean;
  onClose(): void;
  onRollback(): void;
  onApprove(): void;
  onReject(): void;
}) {
  if (!preview) return null;
  const proposalActivity = preview.activity.kind.startsWith("proposal") && preview.activity.kind !== "proposalApproved";
  const owner = role === "owner";
  return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true"><header className="flex items-center justify-between border-b px-5 py-4"><div className="min-w-0"><h2 className="text-base font-semibold text-slate-900">{!owner || proposalActivity ? text("activityPreview") : isCurrent ? text("currentStep") : text("rollbackToStep")}</h2><p className="mt-0.5 truncate text-xs text-slate-500">{readableActivityName(preview.activity)} · {preview.parameterDocument.operations.length} {text("parameterActions")}</p></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-slate-500" aria-label={text("close")}><FiX /></button></header><div className="p-5"><div className="aspect-video overflow-hidden rounded-md border bg-slate-100"><BlobImageMedia blob={preview.preview} alt={text("activityPreview")} fit="contain" /></div></div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={onClose} className="h-9 rounded-md border px-4 text-sm">{!owner || proposalActivity ? text("close") : text("cancel")}</button>{owner && proposalActivity ? <><button type="button" onClick={onReject} className="h-9 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700">{text("reject")}</button><button type="button" onClick={onApprove} className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white">{text("approve")}</button></> : null}{owner && !proposalActivity ? <button type="button" disabled={isCurrent} onClick={onRollback} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:opacity-40">{isCurrent ? text("currentStep") : text("confirmRollback")}</button> : null}</footer></section></div>;
}

export function WorkspaceRollbackDialog({ target, preview, role, onClose, onRollback }: { target: WorkspaceCommit | null; preview?: Blob; role: WorkspaceIdentity["role"]; onClose(): void; onRollback(): void }) {
  if (!target) return null;
  return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true"><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-base font-semibold text-slate-900">{role === "owner" ? text("confirmRollback") : text("activityPreview")}</h2><p className="mt-0.5 text-xs text-slate-500">{text("previewQueue")}</p></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center" aria-label={text("close")}><FiX /></button></header><div className="p-5"><div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-slate-100">{preview ? <BlobImageMedia blob={preview} alt={text("activityPreview")} fit="contain" /> : null}</div></div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={onClose} className="h-9 rounded-md border px-4 text-sm">{role === "owner" ? text("cancel") : text("close")}</button>{role === "owner" ? <button type="button" disabled={!preview} onClick={onRollback} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:opacity-40">{text("confirmRollback")}</button> : null}</footer></section></div>;
}
