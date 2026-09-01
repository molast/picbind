import React from "react";
import { FiLoader, FiLogOut, FiMinimize2, FiUsers, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

type WorkspaceLeaveDialogProps = {
  open: boolean;
  onClose(): void;
  onLeave(remember?: boolean): void;
  onTemporaryLeave?(remember?: boolean): void;
  owner?: boolean;
  pending?: boolean;
  rememberChoice?: boolean;
  onRememberChoiceChange?(remember: boolean): void;
};

export function WorkspaceLeaveDialog({
  open,
  onClose,
  onLeave,
  onTemporaryLeave,
  owner = false,
  pending = false,
  rememberChoice = false,
  onRememberChoiceChange,
}: WorkspaceLeaveDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, pending]);

  if (!open) return null;
  return <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
    onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}
  >
    <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workspace-leave-title">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700"><FiUsers /></div>
        <h2 id="workspace-leave-title" className="min-w-0 text-base font-semibold">
          {owner ? text("ownerLeaveWorkspaceQuestion") : text("leaveWorkspaceQuestion")}
        </h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {owner ? text("exitWorkspaceDescription") : text("leaveWorkspaceDescription")}
      </p>
      {owner ? <div className="mt-5 grid gap-2">
        <button type="button" disabled={pending} onClick={() => onTemporaryLeave?.(rememberChoice)} className="flex w-full items-start gap-3 rounded-md border border-slate-200 p-3 text-left hover:border-blue-200 hover:bg-blue-50/50 disabled:cursor-wait disabled:opacity-50">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]"><FiMinimize2 /></span>
          <span className="min-w-0"><strong className="block text-sm text-slate-800">{text("temporarilyLeaveWorkspace")}</strong><span className="mt-0.5 block text-xs leading-4 text-slate-500">{text("temporarilyLeaveWorkspaceDescription")}</span></span>
        </button>
        <button type="button" disabled={pending} onClick={() => onLeave(rememberChoice)} className="flex w-full items-start gap-3 rounded-md border border-red-200 p-3 text-left hover:bg-red-50 disabled:cursor-wait disabled:opacity-50">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">{pending ? <FiLoader className="animate-spin" /> : <FiLogOut />}</span>
          <span className="min-w-0"><strong className="block text-sm text-slate-800">{text("exitWorkspace")}</strong><span className="mt-0.5 block text-xs leading-4 text-slate-500">{text("exitWorkspaceDescription")}</span></span>
        </button>
      </div> : <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={pending} onClick={onClose} className="h-9 rounded-md border px-4 text-sm disabled:opacity-50">{text("cancel")}</button>
        <button type="button" disabled={pending} onClick={() => onLeave()} className="flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50">{pending ? <FiLoader className="animate-spin" /> : null}{text("leaveWorkspace")}</button>
      </div>}
      {owner ? <div className="mt-4 flex items-center justify-between gap-3"><label className="flex min-w-0 items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={rememberChoice} onChange={(event) => onRememberChoiceChange?.(event.target.checked)} disabled={pending} className="h-4 w-4 accent-[#2f65cf]" />{text("rememberWorkspaceLeaveChoice")}</label><button type="button" disabled={pending} onClick={onClose} className="h-9 shrink-0 rounded-md border px-4 text-sm disabled:opacity-50">{text("cancel")}</button></div> : null}
    </div>
  </div>;
}
export function WorkspaceRemovedDialog({open,onReturnHome}:{open:boolean;onReturnHome():void}){return open?<div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"><FiX/></div><h2 className="min-w-0 text-base font-semibold text-slate-900">{text("removedFromWorkspace")}</h2></div><p className="mt-2 text-sm leading-6 text-slate-600">{text("removedFromWorkspaceDescription")}</p><div className="mt-5 flex justify-end"><a href="/" onClick={onReturnHome} className="flex h-9 items-center rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white">{text("returnHome")}</a></div></div></div>:null;}
