import React from "react";
import { FiRefreshCw, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { WorkspacePageStatusProps } from "./workspace-page-state";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceUnavailable({ notice }: { notice: string | null }) {
  return <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center"><FiX className="mb-3 h-8 w-8 text-red-500" /><h1 className="text-lg font-semibold text-slate-900">{text("workspaceUnavailable")}</h1><p className="mt-2 max-w-md text-sm text-slate-600">{notice || text("shareLinkUnavailable")}</p><a href="/workspace" className="mt-5 rounded-md bg-[#2f65cf] px-4 py-2 text-sm text-white">{text("openMyWorkspace")}</a></main>;
}

export function WorkspaceLoading() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><FiRefreshCw className="mr-2 animate-spin" />{text("loadingWorkspace")}</main>;
}

export function WorkspaceStatusBands({ workspace, runtime, notice, imageCount, onDismissNotice }: WorkspacePageStatusProps) {
  return <>{notice ? <div className="flex shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"><span>{notice}</span><button type="button" onClick={onDismissNotice} className="flex h-7 w-7 items-center justify-center rounded hover:bg-amber-100"><FiX /></button></div> : null}{workspace?.role === "collaborator" && (runtime === "ownerOffline" || runtime === "unavailable") ? <div className="shrink-0 border-b border-amber-200 bg-[#fff9eb] px-[18px] py-2 text-xs text-[#754f13]"><strong className="mr-2">{text("ownerOffline")}</strong>{imageCount ? text("showingCachedWorkspace") : text("noCachedWorkspace")}</div> : null}</>;
}
