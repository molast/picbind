import React from "react";
import { FiRefreshCw, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels, type WorkspaceEditorLabels } from "../../locales";
import type { MessagingProviderSnapshot, MessagingService } from "../../messaging";
import { ColorControl } from "../components/workspace-action";
import { defaultWorkspaceStyle, type WorkspaceIdentity, type WorkspaceRuntimeState, type WorkspaceStyle } from "../types";
import { WorkspaceMessagingServiceSettings } from "./workspace-messaging-service-dialog";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;
const runtimeText = (runtime: WorkspaceRuntimeState) => text({ local: "localStatus", connecting: "connectingStatus", connected: "connectedStatus", syncing: "syncingStatus", available: "availableStatus", ownerOffline: "ownerOfflineStatus", unavailable: "unavailableStatus" }[runtime]);

function headerBackground(style: WorkspaceStyle): React.CSSProperties {
  const background = style.header.background;
  return background.type === "solid"
    ? { backgroundColor: background.color, color: style.header.text.color }
    : { backgroundImage: `linear-gradient(${background.direction === "down" ? "180deg" : background.direction === "downRight" ? "135deg" : "90deg"}, ${background.from}, ${background.to})`, color: style.header.text.color };
}

export function WorkspaceSettingsDialog({
  open,
  workspace,
  runtime,
  styleDraft,
  desktop,
  messagingService,
  messagingProviders,
  messagingLabels,
  onStyleChange,
  onClose,
  onSave,
}: {
  open: boolean;
  workspace: WorkspaceIdentity;
  runtime: WorkspaceRuntimeState;
  styleDraft: WorkspaceStyle;
  desktop: boolean;
  messagingService?: MessagingService;
  messagingProviders: MessagingProviderSnapshot[];
  messagingLabels: WorkspaceEditorLabels;
  onStyleChange: React.Dispatch<React.SetStateAction<WorkspaceStyle>>;
  onClose(): void;
  onSave(): void;
}) {
  if (!open) return null;
  const owner = workspace.role === "owner";
  const update = (change: (style: WorkspaceStyle) => WorkspaceStyle) => onStyleChange(change);
  const background = styleDraft.header.background;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="flex max-h-[calc(100vh-32px)] w-full max-w-[720px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b px-5 py-3"><h2 className="text-base font-semibold">{text("workspaceSettings")}</h2><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={text("close")}><FiX /></button></header>
      <div className="min-h-0 overflow-y-auto">
        <section className="border-b border-slate-200">
          <div className="flex min-h-12 items-center justify-between gap-3 px-[18px] py-2.5"><h3 className="text-sm font-semibold text-slate-800">{text("workspaceStyleEditor")}</h3>{owner ? <button type="button" onClick={() => onStyleChange(defaultWorkspaceStyle())} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#2f65cf]" title={text("resetStyle")}><FiRefreshCw className="h-3.5 w-3.5" />{text("resetStyle")}</button> : null}</div>
          <div className="grid gap-3 px-[18px] pb-[18px] sm:grid-cols-[190px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-1.5"><span className="text-[10px] font-semibold text-slate-500">{text("stylePreview")}</span><div className="flex min-h-[76px] min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-md border border-black/10 px-3 py-2.5" style={headerBackground(styleDraft)}><strong className="truncate" style={{ fontFamily: styleDraft.header.text.fontFamily, fontSize: styleDraft.header.text.fontSize, fontWeight: styleDraft.header.text.fontWeight }}>{styleDraft.header.text.content || "Workspace"}</strong><span className="text-[10px] opacity-70">{text("imageWorkspace")}</span></div></div>
        {owner ? <fieldset className="grid min-w-0 gap-x-3 gap-y-2.5 sm:grid-cols-2">
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">{text("headerText")}<input value={styleDraft.header.text.content} maxLength={80} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, content: event.target.value } } }))} className="h-9 rounded-md border bg-white px-3 text-sm font-normal text-slate-800" /></label>
          <div className="grid gap-1.5"><span className="text-[11px] font-bold text-slate-500">{text("background")}</span><div className="grid h-9 grid-cols-2 rounded-md bg-slate-100 p-1 text-[11px]"><button type="button" onClick={() => update((value) => ({ ...value, header: { ...value.header, background: { type: "solid", color: "#ffffff" }, text: { ...value.header.text, color: "#273247" } } }))} className={`rounded ${background.type === "solid" ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>{text("solid")}</button><button type="button" onClick={() => update((value) => ({ ...value, header: { ...value.header, background: { type: "gradient", from: "#17324d", to: "#2f7d66", direction: "right" }, text: { ...value.header.text, color: "#ffffff" } } }))} className={`rounded ${background.type === "gradient" ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>{text("gradient")}</button></div></div>
          {background.type === "solid" ? <ColorControl label={text("backgroundColor")} value={background.color} onChange={(color) => update((value) => ({ ...value, header: { ...value.header, background: { type: "solid", color } } }))} /> : <><ColorControl label={text("gradientFrom")} value={background.from} onChange={(from) => update((value) => value.header.background.type === "gradient" ? { ...value, header: { ...value.header, background: { ...value.header.background, from } } } : value)} /><ColorControl label={text("gradientTo")} value={background.to} onChange={(to) => update((value) => value.header.background.type === "gradient" ? { ...value, header: { ...value.header, background: { ...value.header.background, to } } } : value)} /><label className="grid gap-1.5 text-[11px] font-bold text-slate-500">{text("gradientDirection")}<select value={background.direction} onChange={(event) => update((value) => value.header.background.type === "gradient" ? { ...value, header: { ...value.header, background: { ...value.header.background, direction: event.target.value as "right" | "down" | "downRight" } } } : value)} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="right">{text("right")}</option><option value="down">{text("down")}</option><option value="downRight">{text("downRight")}</option></select></label></>}
          <ColorControl label={text("textColor")} value={styleDraft.header.text.color} onChange={(color) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, color } } }))} />
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500">{text("fontFamily")}<select value={styleDraft.header.text.fontFamily} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, fontFamily: event.target.value as WorkspaceStyle["header"]["text"]["fontFamily"] } } }))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option>Inter</option><option>System</option><option>Serif</option><option>Monospace</option></select></label>
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500">{text("fontSize")}<div className="flex h-9 items-center gap-2"><input type="range" min={12} max={32} value={styleDraft.header.text.fontSize} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, fontSize: Number(event.target.value) } } }))} className="min-w-0 flex-1 accent-[#2f65cf]" /><output className="w-11 text-right text-[11px] font-normal text-slate-600">{styleDraft.header.text.fontSize} px</output></div></label>
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500">{text("fontWeight")}<select value={styleDraft.header.text.fontWeight} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, fontWeight: Number(event.target.value) as 400 | 500 | 600 | 700 } } }))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label>
        </fieldset> : <dl className="grid content-start gap-2 text-xs"><div className="flex justify-between gap-4"><dt className="text-slate-500">{text("workspaceName")}</dt><dd className="truncate">{workspace.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">{text("status")}</dt><dd>{runtimeText(runtime)}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">{text("workspaceId")}</dt><dd className="max-w-[220px] truncate">{workspace.workspaceId}</dd></div></dl>}
          </div>
        </section>
      {desktop && messagingService ? <WorkspaceMessagingServiceSettings service={messagingService} providers={messagingProviders} labels={messagingLabels} /> : null}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t px-5 py-3">{owner ? <><button type="button" onClick={onClose} className="h-9 rounded-md border px-4 text-xs">{text("cancel")}</button><button type="button" onClick={onSave} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white">{text("save")}</button></> : <button type="button" onClick={onClose} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white">{text("close")}</button>}</footer>
    </div>
  </div>;
}
