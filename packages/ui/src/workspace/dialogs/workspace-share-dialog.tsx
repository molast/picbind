"use client";

import React from "react";
import { FiCheck, FiHash, FiLink, FiRefreshCw, FiShare2, FiX } from "react-icons/fi";
import type { Lang } from "../../locales";
import type { WorkspaceIdentity } from "../types";

type CopyTarget = "link" | "id";

export function WorkspaceShareDialog({
  open,
  lang,
  role,
  shareId,
  shareLink,
  onClose,
  onCreate,
  onCopySuccess,
}: {
  open: boolean;
  lang: Lang;
  role: WorkspaceIdentity["role"];
  shareId: string;
  shareLink: string;
  onClose(): void;
  onCreate(): Promise<void>;
  onCopySuccess(target: CopyTarget): void;
}) {
  const [copied, setCopied] = React.useState<CopyTarget | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [createFailed, setCreateFailed] = React.useState(false);
  const copiedTimer = React.useRef<number | null>(null);

  const labels = lang === "zh"
    ? {
        title: "工作区分享",
        description: role === "owner" ? "将分享链接或分享 ID 发送给协作者。" : "复制当前工作区的分享链接或分享 ID。",
        link: "分享链接",
        id: "分享 ID",
        linkCopied: "分享链接复制成功",
        idCopied: "分享 ID 复制成功",
        create: "创建分享链接",
        creating: "正在创建...",
        createFailed: "分享链接创建失败，请重试。",
        unavailable: "当前没有可用的分享信息。",
        close: "关闭",
      }
    : {
        title: "Workspace share",
        description: role === "owner" ? "Send the share link or Share ID to collaborators." : "Copy this workspace's share link or Share ID.",
        link: "Share link",
        id: "Share ID",
        linkCopied: "Share link copied",
        idCopied: "Share ID copied",
        create: "Create share link",
        creating: "Creating...",
        createFailed: "Unable to create the share link. Try again.",
        unavailable: "No share information is currently available.",
        close: "Close",
      };

  React.useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  React.useEffect(() => {
    if (open) {
      setCopied(null);
      setCreateFailed(false);
    }
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, [open]);

  if (!open) return null;

  const copy = async (target: CopyTarget, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      setCopied(target);
      onCopySuccess(target);
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      await onCreate();
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  };

  const copyRow = (target: CopyTarget, label: string, value: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => void copy(target, value)}
      className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)_20px] items-center gap-3 rounded-md border border-slate-200 p-3 text-left transition hover:border-[#2f65cf] hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f65cf]/25"
      title={copied === target ? (target === "link" ? labels.linkCopied : labels.idCopied) : label}
      aria-label={copied === target ? (target === "link" ? labels.linkCopied : labels.idCopied) : label}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-slate-500">{copied === target ? (target === "link" ? labels.linkCopied : labels.idCopied) : label}</span>
        <span className="mt-0.5 block truncate font-mono text-[13px] font-medium text-slate-800">{value}</span>
      </span>
      <span className="flex h-5 w-5 items-center justify-center text-[#2f65cf]" aria-hidden="true">
        {copied === target ? <FiCheck /> : null}
      </span>
    </button>
  );

  const hasShare = Boolean(shareId && shareLink);

  return <div
    className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4"
    onMouseDown={(event) => event.target === event.currentTarget && onClose()}
  >
    <section
      className="w-full max-w-[480px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-share-dialog-title"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]"><FiShare2 /></span>
          <h2 id="workspace-share-dialog-title" className="text-base font-semibold text-slate-900">{labels.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title={labels.close} aria-label={labels.close}><FiX /></button>
      </header>
      <div className="p-5">
        <p className="text-sm leading-6 text-slate-600">{labels.description}</p>
        {hasShare ? <div className="mt-4 grid gap-2.5">
          {copyRow("link", labels.link, shareLink, <FiLink />)}
          {copyRow("id", labels.id, shareId, <FiHash />)}
        </div> : role === "owner" ? <div className="mt-4">
          <button type="button" onClick={() => void create()} disabled={creating} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2859b9] disabled:cursor-wait disabled:opacity-60">
            {creating ? <FiRefreshCw className="animate-spin" /> : <FiLink />}
            {creating ? labels.creating : labels.create}
          </button>
          {createFailed ? <p className="mt-2 text-xs text-red-600">{labels.createFailed}</p> : null}
        </div> : <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-500">{labels.unavailable}</p>}
      </div>
    </section>
  </div>;
}
