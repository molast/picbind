import React from "react";
import { createPortal } from "react-dom";
import { FiCrop, FiEye, FiMaximize2, FiMinimize2, FiRefreshCw, FiSliders } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";

export type WorkspaceCardOperation = "crop" | "resize" | "adjust" | "compress" | "convert" | "review";
const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceImageActionMenu({ anchor, onClose, onOperation }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose(): void; onOperation(operation: WorkspaceCardOperation): void }) {
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    const update = () => { const rect = anchor.current?.getBoundingClientRect(); if (!rect) return; const width = 144, height = 208, gap = 8, padding = 8; const preferredLeft = rect.right + gap; const left = preferredLeft + width <= window.innerWidth - padding ? preferredLeft : Math.max(padding, rect.left - width - gap); const top = Math.max(padding, Math.min(rect.top, window.innerHeight - height - padding)); setPosition({ left, top }); };
    update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor]);
  const items: Array<[WorkspaceCardOperation, string, React.ReactNode]> = [["convert", "convert", <FiRefreshCw key="convert" />], ["compress", "compress", <FiMinimize2 key="compress" />], ["crop", "crop", <FiCrop key="crop" />], ["resize", "resize", <FiMaximize2 key="resize" />], ["adjust", "adjust", <FiSliders key="adjust" />], ["review", "doodle", <FiEye key="review" />]];
  const menu = <><button type="button" className="fixed inset-0 z-[70] cursor-default" aria-label={text("close")} onClick={onClose} /><div className="fixed z-[71] grid w-36 gap-0.5 rounded-md border bg-white p-1 shadow-xl" role="menu" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>{items.map(([operation, label, icon]) => <button type="button" role="menuitem" key={operation} onClick={() => onOperation(operation)} className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-[#2f65cf]"><span>{icon}</span><span>{text(label)}</span></button>)}</div></>;
  return typeof document !== "undefined" ? createPortal(menu, document.body) : null;
}
