import React from "react";
import { createPortal } from "react-dom";
import { FiCheck, FiChevronDown, FiCrop, FiEye, FiMaximize2, FiMinimize2, FiRefreshCw, FiSliders } from "react-icons/fi";
import { LuCircleDashed, LuHand, LuPaintBucket, LuPalette, LuRotateCw, LuSquareDashed } from "react-icons/lu";
import { TbDimensions } from "react-icons/tb";
import { getLang, getWorkspaceLabels } from "../../locales";
import { COMMON_PREVIEW_COLORS, TRANSPARENT_PREVIEW_COLOR, normalizePreviewColor, previewColorFromHex, previewColorKey, previewColorToCss, previewColorToHex, type WorkspacePreviewColor } from "../workspace-preview-color";

export type WorkspaceCardOperation = "crop" | "resize" | "adjust" | "compress" | "convert" | "review";
export type WorkspacePreviewTool = "pan" | "select" | "crop" | "resize" | "rotateRight" | "rotateLeft" | "flipHorizontal" | "flipVertical" | "freeRotate" | "fillBackground";
export type WorkspacePreviewSelectionMode = "rectangle" | "ellipse" | "lasso" | "smart";
const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;
const imageActions: Array<[WorkspaceCardOperation, string, React.ReactNode]> = [
  ["convert", "convert", <FiRefreshCw key="convert" />],
  ["compress", "compress", <FiMinimize2 key="compress" />],
  ["crop", "crop", <FiCrop key="crop" />],
  ["resize", "resize", <FiMaximize2 key="resize" />],
  ["adjust", "adjust", <FiSliders key="adjust" />],
  ["review", "doodle", <FiEye key="review" />],
];

export function WorkspaceImageActionToolbar({
  disabled = false,
  activeTool = "select",
  onTool,
  hasSelection = false,
  selectionMode = "rectangle",
  onSelectionMode,
  color = { r: 255, g: 255, b: 255, a: 255 },
  onColorChange,
}: {
  disabled?: boolean;
  activeTool?: WorkspacePreviewTool;
  onTool(tool: WorkspacePreviewTool): void;
  hasSelection?: boolean;
  selectionMode?: WorkspacePreviewSelectionMode;
  onSelectionMode?(mode: WorkspacePreviewSelectionMode): void;
  color?: WorkspacePreviewColor;
  onColorChange?(color: WorkspacePreviewColor): void;
}) {
  const [menu, setMenu] = React.useState<"select" | "color" | null>(null);
  const normalizedColor = normalizePreviewColor(color);
  const normalizedColorKey = previewColorKey(normalizedColor);
  const colorInputRef = React.useRef<HTMLInputElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const zh = getLang() === "zh";
  const label = (en: string, zhText: string) => zh ? zhText : en;
  const selectedSelectionMode = selectionMode === "ellipse" ? "ellipse" : "rectangle";
  const selectedSelectionIcon = selectedSelectionMode === "ellipse" ? <LuCircleDashed /> : <LuSquareDashed />;
  React.useEffect(() => {
    if (!menu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && toolbarRef.current?.contains(target)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menu]);
  const selectColor = (nextColor: WorkspacePreviewColor, close = true) => {
    const next = normalizePreviewColor(nextColor);
    onColorChange?.(next);
    if (close) setMenu(null);
  };
  const button = (tool: WorkspacePreviewTool, title: string, icon: React.ReactNode, active = false) => <button type="button" key={tool} disabled={disabled} onClick={() => { setMenu(null); onTool(tool); }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-blue-50 text-[#2f65cf]" : "text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]"} disabled:cursor-not-allowed disabled:opacity-35`} title={title} aria-label={title} aria-pressed={active}>{icon}</button>;
  const colorSwatch = (swatch: WorkspacePreviewColor, title: string) => <button type="button" key={previewColorKey(swatch)} onClick={() => selectColor(swatch)} className={`relative h-6 w-6 rounded border border-slate-200 shadow-sm ${swatch.a === 0 ? "[background-image:linear-gradient(45deg,#d6dbe3_25%,transparent_25%),linear-gradient(-45deg,#d6dbe3_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d6dbe3_75%),linear-gradient(-45deg,transparent_75%,#d6dbe3_75%)] [background-position:0_0,0_6px,6px_-6px,-6px_0] [background-size:12px_12px]" : ""} ${normalizedColorKey === previewColorKey(swatch) ? "ring-2 ring-[#2f65cf] ring-offset-1" : ""}`} style={swatch.a === 0 ? undefined : { backgroundColor: previewColorToCss(swatch) }} title={title} aria-label={title} aria-pressed={normalizedColorKey === previewColorKey(swatch)}>{swatch.a === 0 ? <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[calc(100%+4px)] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-slate-400" aria-hidden="true" /> : null}</button>;
  const colorMenu = menu === "color" ? <div className="absolute right-0 top-9 z-[120] w-60 rounded-md border border-slate-200 bg-white p-3 text-slate-700 shadow-xl" role="dialog" aria-label={text("backgroundColor")} onPointerDown={(event) => event.stopPropagation()}>
    <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-500">{label("Common colors", "常用颜色")}</span><span className="h-5 w-5 rounded border border-slate-200" style={{ backgroundColor: previewColorToCss(normalizedColor) }} aria-hidden="true" /></div>
    <div className="grid grid-cols-6 gap-2">{colorSwatch(TRANSPARENT_PREVIEW_COLOR, label("Transparent", "透明"))}{COMMON_PREVIEW_COLORS.map((swatch) => colorSwatch(swatch, previewColorToHex(swatch)))}</div>
    <div className="border-t border-slate-100 pt-3"><input ref={colorInputRef} type="color" value={previewColorToHex(normalizedColor)} onChange={(event) => { const next = previewColorFromHex(event.target.value); if (next) selectColor(next, false); }} className="sr-only" tabIndex={-1} /><button type="button" onClick={() => colorInputRef.current?.click()} className="flex h-9 w-full items-center gap-3 rounded px-2 text-left text-xs text-slate-600 hover:bg-slate-50 hover:text-[#2f65cf]"><LuPalette className="h-5 w-5 shrink-0 text-[#2f65cf]" aria-hidden="true" /><span>{label("Choose any color", "任意颜色")}</span></button></div>
  </div> : null;
  return <div ref={toolbarRef} className="flex min-w-max items-center gap-1" role="toolbar" aria-label={text("imageActions")}>
    {button("pan", text("panTool"), <LuHand />, activeTool === "pan")}
    <div className="relative flex items-center"><button type="button" disabled={disabled} onClick={() => { setMenu(null); onTool("select"); }} className={`flex h-8 w-8 items-center justify-center rounded-l-md ${(activeTool === "select" || menu === "select") ? "bg-blue-50 text-[#2f65cf]" : "text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]"} disabled:opacity-35`} title={text("selectTool")} aria-label={text("selectTool")} aria-pressed={activeTool === "select"}><span className="flex h-5 w-5 items-center justify-center">{selectedSelectionIcon}</span></button><button type="button" disabled={disabled} onClick={() => setMenu(menu === "select" ? null : "select")} className={`flex h-8 w-5 items-center justify-center rounded-r-md ${menu === "select" ? "bg-blue-50 text-[#2f65cf]" : "text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]"} disabled:opacity-35`} title={text("selectTool")} aria-label={text("selectTool")} aria-haspopup="menu" aria-expanded={menu === "select"}><FiChevronDown className="h-3.5 w-3.5" /></button>{menu === "select" ? <div className="absolute left-0 top-9 z-[120] grid w-44 gap-0.5 rounded-md border border-slate-200 bg-white p-1 shadow-xl" role="menu">
      {([["rectangle", <LuSquareDashed />, label("Rectangle marquee", "矩形选择")], ["ellipse", <LuCircleDashed />, label("Ellipse marquee", "椭圆选择")]] as Array<[WorkspacePreviewSelectionMode, React.ReactNode, string]>).map(([mode, icon, title]) => <button type="button" role="menuitemradio" aria-checked={selectedSelectionMode === mode} key={mode} onClick={() => { onSelectionMode?.(mode); setMenu(null); onTool("select"); }} className={`flex h-9 items-center gap-2 rounded px-2 text-left text-xs ${selectedSelectionMode === mode ? "bg-blue-50 text-[#2f65cf]" : "text-slate-600 hover:bg-slate-50"}`}><span className="flex w-5 items-center justify-center">{selectedSelectionMode === mode ? <FiCheck aria-hidden="true" /> : null}</span><span className="flex w-5 items-center justify-center">{icon}</span><span>{title}</span></button>)}
    </div> : null}</div>
    {hasSelection ? button("crop", text("crop"), <FiCrop />) : null}
    {button("freeRotate", text("rotate"), <LuRotateCw />, activeTool === "freeRotate")}
    {button("resize", text("resize"), <TbDimensions />)}
    <div className="relative flex items-center"><button type="button" disabled={disabled} onClick={() => { setMenu(null); onTool("fillBackground"); }} className="flex h-8 w-8 items-center justify-center rounded-l-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf] disabled:opacity-35" title={label("Fill background", "填充背景色")} aria-label={label("Fill background", "填充背景色")}><span className="relative flex h-5 w-5 items-center justify-center"><LuPaintBucket className="text-slate-500" /><span className={`pointer-events-none absolute bottom-0.5 left-1/2 h-1 w-3 -translate-x-1/2 rounded-sm border border-white/80 shadow-sm ${normalizedColor.a === 0 ? "[background-image:linear-gradient(45deg,#cbd5e1_25%,transparent_25%),linear-gradient(-45deg,#cbd5e1_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#cbd5e1_75%),linear-gradient(-45deg,transparent_75%,#cbd5e1_75%)] [background-position:0_0,0_3px,3px_-3px,-3px_0] [background-size:6px_6px]" : ""}`} style={normalizedColor.a === 0 ? undefined : { backgroundColor: previewColorToCss(normalizedColor) }} /></span></button><button type="button" disabled={disabled} onClick={() => setMenu(menu === "color" ? null : "color")} className={`flex h-8 w-5 items-center justify-center rounded-r-md ${menu === "color" ? "bg-blue-50 text-[#2f65cf]" : "text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]"} disabled:opacity-35`} title={label("Choose background color", "选择背景颜色")} aria-label={label("Choose background color", "选择背景颜色")} aria-haspopup="dialog" aria-expanded={menu === "color"}><FiChevronDown className="h-3.5 w-3.5" /></button>{colorMenu}</div>
  </div>;
}

export function WorkspaceImageActionMenu({ anchor, onClose, onOperation }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose(): void; onOperation(operation: WorkspaceCardOperation): void }) {
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    const update = () => { const rect = anchor.current?.getBoundingClientRect(); if (!rect) return; const width = 144, height = 208, gap = 8, padding = 8; const preferredLeft = rect.right + gap; const left = preferredLeft + width <= window.innerWidth - padding ? preferredLeft : Math.max(padding, rect.left - width - gap); const top = Math.max(padding, Math.min(rect.top, window.innerHeight - height - padding)); setPosition({ left, top }); };
    update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor]);
  const menu = <><button type="button" className="fixed inset-0 z-[70] cursor-default" aria-label={text("close")} onClick={onClose} /><div className="fixed z-[71] grid w-36 gap-0.5 rounded-md border bg-white p-1 shadow-xl" role="menu" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>{imageActions.map(([operation, label, icon]) => <button type="button" role="menuitem" key={operation} onClick={() => onOperation(operation)} className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-[#2f65cf]"><span>{icon}</span><span>{text(label)}</span></button>)}</div></>;
  return typeof document !== "undefined" ? createPortal(menu, document.body) : null;
}
