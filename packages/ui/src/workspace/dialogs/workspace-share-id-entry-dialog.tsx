"use client";

import React from "react";
import { FiArrowRight, FiHash, FiX } from "react-icons/fi";
import type { Lang } from "../../locales";

export default function WorkspaceShareIdEntryDialog({
  open,
  lang,
  onClose,
}: {
  open: boolean;
  lang: Lang;
  onClose(): void;
}) {
  const [shareId, setShareId] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setShareId("");
      setInvalid(false);
    }
  }, [open]);

  if (!open) return null;
  const labels = lang === "zh"
    ? {
        title: "进入工作区",
        shareId: "分享 ID",
        placeholder: "粘贴分享 ID",
        enter: "进入工作区",
        invalid: "请输入有效的分享 ID",
        close: "关闭",
      }
    : {
        title: "Enter Workspace",
        shareId: "Share ID",
        placeholder: "Paste a Share ID",
        enter: "Enter Workspace",
        invalid: "Enter a valid Share ID",
        close: "Close",
      };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = shareId.trim();
    if (!/^share_[A-Za-z0-9_-]{12}$/.test(value)) {
      setInvalid(true);
      return;
    }
    const destination = new URL("/workspace", window.location.origin);
    destination.searchParams.set("share", value);
    window.location.assign(destination.toString());
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[430px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-share-id-entry-title"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
              <FiHash />
            </span>
            <h2 id="workspace-share-id-entry-title" className="text-base font-semibold text-slate-900">
              {labels.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label={labels.close}
          >
            <FiX />
          </button>
        </header>
        <div className="p-5">
          <label className="grid gap-2 text-xs font-semibold text-slate-600">
            {labels.shareId}
            <input
              autoFocus
              value={shareId}
              onChange={(event) => {
                setShareId(event.target.value);
                setInvalid(false);
              }}
              placeholder={labels.placeholder}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              className={`h-11 rounded-md border bg-white px-3 font-mono text-sm font-normal text-slate-900 outline-none transition focus:ring-2 focus:ring-blue-100 ${invalid ? "border-red-400" : "border-slate-300 focus:border-[#2f65cf]"}`}
            />
          </label>
          {invalid ? <p className="mt-2 text-xs text-red-600">{labels.invalid}</p> : null}
        </div>
        <footer className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="submit"
            disabled={!shareId.trim()}
            className="flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2859b9] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {labels.enter}
            <FiArrowRight />
          </button>
        </footer>
      </form>
    </div>
  );
}
