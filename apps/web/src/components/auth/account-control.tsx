"use client";

/* OAuth avatars use dynamic provider hosts and need explicit load/fallback handling. */

import React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { FiLoader, FiLogIn, FiLogOut, FiPlus } from "react-icons/fi";
import { WorkspaceShareIdEntryDialog } from "@picbind/ui/source";
import { useAuth } from "./auth-provider";
import type { Lang } from "@/locales";
import { resolveAuthAvatar } from "@/utils/auth-service";

function initials(name: string | null | undefined, email: string | null | undefined) {
  const label = name?.trim() || email?.split("@")[0] || "PB";
  const words = label.split(/\s+/).filter(Boolean);
  const value = words.length > 1
    ? `${words[0][0] || ""}${words[words.length - 1][0] || ""}`
    : [...label].filter((character) => /[\p{L}\p{N}]/u.test(character)).slice(0, 2).join("");
  return (value || "PB").toUpperCase();
}

export default function AccountControl({
  lang,
  showWorkspaceEntry = false,
}: {
  lang: Lang;
  showWorkspaceEntry?: boolean;
}) {
  const auth = useAuth();
  const [open, setOpen] = React.useState(false);
  const [desktop, setDesktop] = React.useState(false);
  const [workspaceEntryOpen, setWorkspaceEntryOpen] = React.useState(false);
  const [avatarLoaded, setAvatarLoaded] = React.useState(false);
  const [avatarFailed, setAvatarFailed] = React.useState(false);
  const [avatarSource, setAvatarSource] = React.useState<string | null>(null);
  const user = auth.state.user;
  const avatar = !avatarFailed ? avatarSource : null;
  const label = initials(user?.name, user?.email);
  const loading = auth.checking || auth.authenticating;

  React.useEffect(() => {
    if (showWorkspaceEntry) setDesktop(isTauri());
  }, [showWorkspaceEntry]);

  React.useEffect(() => {
    let active = true;
    setAvatarLoaded(false);
    setAvatarFailed(false);
    setAvatarSource(null);
    void resolveAuthAvatar(user?.avatar || null)
      .then((source) => {
        if (active) setAvatarSource(source);
      })
      .catch(() => {
        if (active) setAvatarFailed(true);
      });
    return () => {
      active = false;
    };
  }, [user?.avatar, user?.updatedAt]);

  if (!auth.state.authenticated || !user) {
    return (
      <button type="button" aria-label={loading ? (lang === "zh" ? "正在登录" : "Logging in") : (lang === "zh" ? "登录" : "Log in")} aria-busy={loading} disabled={loading} onClick={() => auth.openDialog("login", lang)} className="inline-flex h-9 w-9 items-center justify-center gap-2 rounded-md bg-slate-900 text-[13px] font-bold text-white shadow-sm transition hover:bg-black disabled:cursor-wait disabled:opacity-70 sm:w-auto sm:px-3.5">
        {loading ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FiLogIn className="h-4 w-4" aria-hidden="true" />}
        <span className="hidden sm:inline">{lang === "zh" ? "登录" : "Log in"}</span>
      </button>
    );
  }

  return <>
    <div className="relative">
      <button type="button" aria-label={lang === "zh" ? "账户" : "Account"} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="block h-10 w-10 rounded-full p-0.5 ring-2 ring-white/70 transition hover:ring-white">
        <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#2f65cf] text-[12px] font-bold text-white">
          <span aria-hidden="true">{label}</span>
          {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" onLoad={() => setAvatarLoaded(true)} onError={() => setAvatarFailed(true)} className={`absolute inset-0 h-full w-full object-cover transition-opacity ${avatarLoaded ? "opacity-100" : "opacity-0"}`} /> : null}
        </span>
      </button>
      {open ? (
        <>
          <button type="button" aria-label={lang === "zh" ? "关闭" : "Close"} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[270px] rounded-lg border border-slate-200 bg-white p-3 text-slate-800 shadow-[0_18px_45px_rgba(15,23,42,0.22)]">
            <div className="flex min-w-0 items-center gap-3 border-b border-slate-100 px-1 pb-3">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2f65cf] text-[13px] font-bold text-white">
                <span aria-hidden="true">{label}</span>
                {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" onLoad={() => setAvatarLoaded(true)} onError={() => setAvatarFailed(true)} className={`absolute inset-0 h-full w-full object-cover transition-opacity ${avatarLoaded ? "opacity-100" : "opacity-0"}`} /> : null}
              </span>
              <div className="min-w-0">
                <strong className="block truncate text-[14px]">{user.name || user.email || (lang === "zh" ? "账户" : "Account")}</strong>
                {user.email ? <span className="mt-0.5 block truncate text-[12px] text-slate-500">{user.email}</span> : null}
              </div>
            </div>
            {showWorkspaceEntry && desktop ? (
              <button type="button" onClick={() => { setOpen(false); setWorkspaceEntryOpen(true); }} className="mt-2 flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
                <FiPlus className="h-4 w-4" aria-hidden="true" />
                {lang === "zh" ? "进入工作区" : "Enter Workspace"}
              </button>
            ) : null}
            <button type="button" onClick={() => { setOpen(false); void auth.logout(); }} className="mt-2 flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              <FiLogOut className="h-4 w-4" aria-hidden="true" />
              {lang === "zh" ? "退出登录" : "Log out"}
            </button>
          </div>
        </>
      ) : null}
    </div>
    <WorkspaceShareIdEntryDialog
      open={workspaceEntryOpen}
      lang={lang}
      desktop={desktop}
      onClose={() => setWorkspaceEntryOpen(false)}
    />
  </>;
}
