"use client";

import React from "react";
import { LuFlipHorizontal2, LuFlipVertical2, LuRotateCcwSquare, LuRotateCwSquare } from "react-icons/lu";
import { getLang, getWorkspaceLabels } from "../../locales";

export function WorkspacePreviewFreeRotateDialog({ open, degrees, onDegreesChange, onDegreesCommit, onCancel, onRotateLeft, onRotateRight, onFlipHorizontal, onFlipVertical }: {
  open: boolean;
  degrees: number;
  onDegreesChange(degrees: number): void;
  onDegreesCommit(degrees: number): void;
  onCancel(): void;
  onRotateLeft?(): void;
  onRotateRight?(): void;
  onFlipHorizontal?(): void;
  onFlipVertical?(): void;
}) {
  const labels = getWorkspaceLabels(getLang());

  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel, open]);

  if (!open) return null;
  return <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[135] flex justify-center px-4" role="dialog" aria-label={labels.freeRotate}>
    <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-[#303236]/95 px-2.5 py-2 text-white shadow-2xl backdrop-blur">
      <button type="button" onClick={onRotateLeft} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-100 hover:bg-white/10" title={`${labels.rotate} -90°`} aria-label={`${labels.rotate} -90°`}><LuRotateCcwSquare className="h-4 w-4" /></button>
      <button type="button" onClick={onRotateRight} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-100 hover:bg-white/10" title={`${labels.rotate} 90°`} aria-label={`${labels.rotate} 90°`}><LuRotateCwSquare className="h-4 w-4" /></button>
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-slate-200">{degrees > 0 ? "+" : ""}{degrees}°</span>
        <input type="range" name="workspace-free-rotate-angle" autoComplete="off" min={-180} max={180} step={1} value={degrees} onChange={(event) => onDegreesChange(Number(event.target.value))} onPointerUp={(event) => onDegreesCommit(Number(event.currentTarget.value))} onKeyUp={(event) => { if (event.key === "Enter") onDegreesCommit(Number(event.currentTarget.value)); }} className="h-1.5 w-[min(38vw,280px)] accent-[#6fa2ff]" aria-label={labels.rotationDegrees} />
      </div>
      <button type="button" onClick={onFlipHorizontal} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-100 hover:bg-white/10" title={`${labels.flip} horizontal`} aria-label={`${labels.flip} horizontal`}><LuFlipHorizontal2 className="h-4 w-4" /></button>
      <button type="button" onClick={onFlipVertical} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-100 hover:bg-white/10" title={`${labels.flip} vertical`} aria-label={`${labels.flip} vertical`}><LuFlipVertical2 className="h-4 w-4" /></button>
    </div>
  </div>;
}
