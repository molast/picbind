import React from "react";
import { FiRefreshCw, FiX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import { ColorControl } from "../components/workspace-action";
import { defaultWorkspaceStyle, type WorkspaceIdentity, type WorkspaceRuntimeState, type WorkspaceStyle } from "../types";

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
  onStyleChange,
  onClose,
  onSave,
}: {
  open: boolean;
  workspace: WorkspaceIdentity;
  runtime: WorkspaceRuntimeState;
  styleDraft: WorkspaceStyle;
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
      <header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-base font-semibold">{text("workspaceSettings")}</h2><p className="mt-0.5 text-xs text-slate-500">{text("workspaceStyle")}</p></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100" aria-label={text("close")}><FiX /></button></header>
      <div className="grid min-h-0 overflow-y-auto md:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]">
        <div className="flex min-w-0 flex-col gap-2.5 border-b bg-[#f6f7f9] p-[18px] md:border-b-0 md:border-r"><span className="text-[11px] font-bold text-slate-500">{text("stylePreview")}</span><div className="flex min-h-[94px] min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-md border border-black/10 px-4 py-3" style={headerBackground(styleDraft)}><strong className="truncate" style={{ fontFamily: styleDraft.header.text.fontFamily, fontSize: styleDraft.header.text.fontSize, fontWeight: styleDraft.header.text.fontWeight }}>{styleDraft.header.text.content || "Workspace"}</strong><span className="text-[10px] opacity-70">{text("imageWorkspace")}</span></div></div>
        {owner ? <fieldset className="grid gap-4 p-[18px] sm:grid-cols-2">
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">{text("headerText")}<input value={styleDraft.header.text.content} maxLength={80} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, content: event.target.value } } }))} className="h-9 rounded-md border bg-white px-3 text-sm font-normal text-slate-800" /></label>
          <div className="grid gap-1.5 sm:col-span-2"><span className="text-[11px] font-bold text-slate-500">{text("background")}</span><div className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-xs"><button type="button" onClick={() => update((value) => ({ ...value, header: { ...value.header, background: { type: "solid", color: "#ffffff" }, text: { ...value.header.text, color: "#273247" } } }))} className={`h-8 rounded ${background.type === "solid" ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>{text("solid")}</button><button type="button" onClick={() => update((value) => ({ ...value, header: { ...value.header, background: { type: "gradient", from: "#17324d", to: "#2f7d66", direction: "right" }, text: { ...value.header.text, color: "#ffffff" } } }))} className={`h-8 rounded ${background.type === "gradient" ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>{text("gradient")}</button></div></div>
          {background.type === "solid" ? <ColorControl label={text("backgroundColor")} value={background.color} onChange={(color) => update((value) => ({ ...value, header: { ...value.header, background: { type: "solid", color } } }))} /> : <><ColorControl label={text("gradientFrom")} value={background.from} onChange={(from) => update((value) => value.header.background.type === "gradient" ? { ...value, header: { ...value.header, background: { ...value.header.background, from } } } : value)} /><ColorControl label={text("gradientTo")} value={background.to} onChange={(to) => update((value) => value.header.background.type === "gradient" ? { ...value, header: { ...value.header, background: { ...value.header.background, to } } } : value)} /><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">{text("gradientDirection")}<select value={background.direction} onChange={(event) => update((value) => value.header.background.type === "gradient" ? { ...value, header: { ...value.header, background: { ...value.header.background, direction: event.target.value as "right" | "down" | "downRight" } } } : value)} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="right">Right</option><option value="down">Down</option><option value="downRight">Down right</option></select></label></>}
          <ColorControl label={text("textColor")} value={styleDraft.header.text.color} onChange={(color) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, color } } }))} />
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500">{text("fontFamily")}<select value={styleDraft.header.text.fontFamily} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, fontFamily: event.target.value as WorkspaceStyle["header"]["text"]["fontFamily"] } } }))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option>Inter</option><option>System</option><option>Serif</option><option>Monospace</option></select></label>
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">{text("fontSize")}<div className="flex h-9 items-center gap-3"><input type="range" min={12} max={32} value={styleDraft.header.text.fontSize} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, fontSize: Number(event.target.value) } } }))} className="min-w-0 flex-1 accent-[#2f65cf]" /><output className="w-12 text-right text-xs font-normal text-slate-600">{styleDraft.header.text.fontSize} px</output></div></label>
          <label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">{text("fontWeight")}<select value={styleDraft.header.text.fontWeight} onChange={(event) => update((value) => ({ ...value, header: { ...value.header, text: { ...value.header.text, fontWeight: Number(event.target.value) as 400 | 500 | 600 | 700 } } }))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label>
        </fieldset> : <dl className="grid content-start gap-3 p-[18px] text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">{text("workspaceName")}</dt><dd className="truncate">{workspace.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">{text("status")}</dt><dd>{runtimeText(runtime)}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">{text("workspaceId")}</dt><dd className="max-w-[220px] truncate">{workspace.workspaceId}</dd></div></dl>}
      </div>
      <footer className="flex items-center gap-2 border-t px-5 py-3">{owner ? <><button type="button" onClick={() => onStyleChange(defaultWorkspaceStyle())} className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs"><FiRefreshCw />{text("resetStyle")}</button><span className="flex-1" /><button type="button" onClick={onClose} className="h-9 rounded-md border px-4 text-xs">{text("cancel")}</button><button type="button" onClick={onSave} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white">{text("save")}</button></> : <><span className="flex-1" /><button type="button" onClick={onClose} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white">{text("close")}</button></>}</footer>
    </div>
  </div>;
}
