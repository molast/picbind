import React from "react";
import { FiFolder, FiMaximize2 } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { WorkspaceIdentity, WorkspaceRuntimeState } from "../types";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export const WORKSPACE_SUSPENSION_EVENT = "picbind:workspace-suspension";
export const WORKSPACE_EXIT_EVENT = "picbind:workspace-exit";

export type WorkspaceSuspensionEventDetail = {
  suspended: boolean;
  workspace?: WorkspaceIdentity;
  runtime?: WorkspaceRuntimeState;
  returnHref?: string;
};

export type WorkspaceExitEventDetail = {
  workspace?: WorkspaceIdentity;
};

export function WorkspaceSuspendedDock({
  workspace,
  runtime,
  onRestore,
}: {
  workspace: WorkspaceIdentity;
  runtime: WorkspaceRuntimeState;
  onRestore(): void;
}) {
  return <div className="pointer-events-none fixed inset-0 z-[100] flex items-end justify-end bg-transparent p-4 sm:p-6">
    <aside data-picbind-workspace-dock="true" className="pointer-events-auto w-full max-w-[360px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.16)]" role="status">
      <div className="flex items-center gap-3 p-4">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
          <FiFolder className="h-5 w-5" aria-hidden="true" />
          <span className={`absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-white ${runtime === "connected" || runtime === "available" ? "bg-emerald-500" : "bg-amber-400"}`} />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm text-slate-900">{text("workspaceSuspended")}</strong>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{workspace.name}</span>
        </div>
        <button type="button" onClick={onRestore} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white transition hover:bg-[#2457bd]" aria-label={text("resumeWorkspace")} title={text("resumeWorkspace")}>
          <FiMaximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  </div>;
}
