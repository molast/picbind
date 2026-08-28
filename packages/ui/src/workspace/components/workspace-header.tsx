import React from "react";
import {
  FiHome,
  FiLogIn,
  FiSettings,
  FiShare2,
  FiUsers,
  FiX,
} from "react-icons/fi";
import { getLang, getWorkspaceLabels, type Lang } from "../../locales";
import type { WorkspaceIdentity, WorkspaceRuntimeState, WorkspaceStyle } from "../types";
import { WORKSPACE_VERSION } from "../version";
import { WorkspaceLanguageSwitcher } from "./workspace-language-switcher";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

const runtimeText = (runtime: WorkspaceRuntimeState) => text({
  local: "localStatus",
  connecting: "connectingStatus",
  connected: "connectedStatus",
  syncing: "syncingStatus",
  available: "availableStatus",
  ownerOffline: "ownerOfflineStatus",
  unavailable: "unavailableStatus",
}[runtime]);

function headerBackground(style: WorkspaceStyle): React.CSSProperties {
  const background = style.header.background;
  if (background.type === "solid") {
    return { backgroundColor: background.color, color: style.header.text.color };
  }
  const degrees = background.direction === "down"
    ? "180deg"
    : background.direction === "downRight"
      ? "135deg"
      : "90deg";
  return {
    backgroundImage: `linear-gradient(${degrees}, ${background.from}, ${background.to})`,
    color: style.header.text.color,
  };
}

type WorkspaceHeaderProps = {
  workspace: WorkspaceIdentity;
  runtime: WorkspaceRuntimeState;
  onlinePeers: number;
  collaborationOpen: boolean;
  desktop: boolean;
  lang: Lang;
  onLanguageChange(lang: Lang): void;
  onEnterWorkspace(): void;
  onLeave(): void;
  onToggleCollaboration(): void;
  onShare(): void;
  onSettings(): void;
};

export function WorkspaceHeader({
  workspace,
  runtime,
  onlinePeers,
  collaborationOpen,
  desktop,
  lang,
  onLanguageChange,
  onEnterWorkspace,
  onLeave,
  onToggleCollaboration,
  onShare,
  onSettings,
}: WorkspaceHeaderProps) {
  const isOwner = workspace.role === "owner";
  return <header
    className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[#dfe3e8] px-3 sm:gap-6 sm:px-[22px]"
    style={headerBackground(workspace.style)}
  >
    <div className="flex min-w-0 items-center gap-2 sm:gap-4">
      {isOwner ? <a href="/" className="shrink-0" aria-label="PicBind home">
        <img src="/images/wordmark.png" alt="PicBind" className="h-6 max-w-[78px] object-contain sm:h-7 sm:max-w-none" />
      </a> : <button type="button" onClick={onLeave} className="shrink-0" aria-label={text("leaveWorkspace")}>
        <img src="/images/wordmark.png" alt="PicBind" className="h-6 max-w-[78px] object-contain sm:h-7 sm:max-w-none" />
      </button>}
      <div className="min-w-0 border-l border-current/25 pl-2 sm:pl-4">
        <div className="flex items-center gap-1.5">
          <span className="hidden text-[10px] font-semibold uppercase opacity-70 sm:block">{text("imageWorkspace")}</span>
          <span
            className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold opacity-70"
            title={`${text("workspaceVersion")} ${WORKSPACE_VERSION}`}
            aria-label={`${text("workspaceVersion")} ${WORKSPACE_VERSION}`}
          >v{WORKSPACE_VERSION}</span>
        </div>
        <strong
          className="block max-w-[92px] truncate sm:max-w-[34vw]"
          style={{
            fontFamily: workspace.style.header.text.fontFamily,
            fontSize: workspace.style.header.text.fontSize,
            fontWeight: workspace.style.header.text.fontWeight,
          }}
        >{workspace.style.header.text.content || workspace.name}</strong>
      </div>
      <span className="hidden rounded bg-black/5 px-2 py-1 text-[10px] font-semibold uppercase opacity-70 sm:inline-flex">
        {runtimeText(runtime)}
      </span>
    </div>

    <div className="flex shrink-0 items-center gap-1">
      {isOwner && desktop ? <button
        type="button"
        className="flex h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:bg-black/5"
        onClick={onEnterWorkspace}
        title={text("enterWorkspace")}
      >
        <FiLogIn className="h-[17px] w-[17px]" />
        <span className="hidden lg:inline">{text("join")}</span>
      </button> : null}
      <WorkspaceLanguageSwitcher lang={lang} onChange={onLanguageChange} />
      <button
        type="button"
        className={`relative flex h-9 items-center justify-center gap-1 rounded-md px-2 hover:bg-black/5 ${collaborationOpen ? "bg-black/5" : ""}`}
        onClick={onToggleCollaboration}
        title={text("collaboration")}
        aria-pressed={collaborationOpen}
      >
        <FiUsers className="h-[18px] w-[18px]" />
        {onlinePeers ? <span className="min-w-3 text-[10px] font-bold">{onlinePeers}</span> : null}
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5"
        onClick={onShare}
        title={text("workspaceShare")}
      ><FiShare2 /></button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5"
        onClick={onSettings}
        title={text("workspaceSettings")}
      ><FiSettings /></button>
      {isOwner ? <a
        href="/"
        className="hidden h-9 w-9 items-center justify-center rounded-md hover:bg-black/5 sm:flex"
        title={text("home")}
      ><FiHome /></a> : <button
        type="button"
        onClick={onLeave}
        className="hidden h-9 w-9 items-center justify-center rounded-md text-red-600 hover:bg-red-50 sm:flex"
        title={text("leaveWorkspace")}
      ><FiX /></button>}
    </div>
  </header>;
}
