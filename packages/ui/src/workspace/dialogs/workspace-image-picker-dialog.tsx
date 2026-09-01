"use client";

import React from "react";
import { FiCheck, FiChevronLeft, FiImage, FiLoader, FiX } from "react-icons/fi";
import { formatBytes, middleEllipsisFileName } from "../../components/share/workspace-formatters";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceImageMedia } from "../components/workspace-image-media";

export function WorkspaceImagePickerDialog({
  open,
  title,
  description,
  images,
  role,
  selectedId,
  pending,
  pendingLabel,
  actionLabel,
  cancelLabel,
  closeLabel,
  unavailableLabel,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  backLabel,
  footerLeading,
  error,
  onSelectedIdChange,
  onConfirm,
  onClose,
  onEmptyAction,
  onBack,
}: {
  open: boolean;
  title: string;
  description: string;
  images: WorkspaceImage[];
  role: WorkspaceIdentity["role"];
  selectedId: string | null;
  pending: boolean;
  pendingLabel: string;
  actionLabel: string;
  cancelLabel: string;
  closeLabel: string;
  unavailableLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyActionLabel?: string;
  backLabel?: string;
  footerLeading?: React.ReactNode;
  error?: string | null;
  onSelectedIdChange(imageId: string): void;
  onConfirm(image: WorkspaceImage): void | Promise<void>;
  onClose(): void;
  onEmptyAction?(): void;
  onBack?(): void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open, pending]);

  if (!open) return null;
  const selected = images.find((image) => image.imageId === selectedId) || null;

  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 p-4">
    <section className="relative flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-3">
        {onBack ? <button type="button" onClick={onBack} disabled={pending} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={backLabel}><FiChevronLeft /></button> : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
        </div>
        <button type="button" onClick={onClose} disabled={pending} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label={closeLabel}><FiX className="h-4 w-4" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {images.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-3">
          {images.map((image) => {
            const isSelected = image.imageId === selectedId;
            const available = Boolean(image.sourceCached);
            return <button
              key={image.imageId}
              type="button"
              disabled={pending || !available}
              onClick={() => onSelectedIdChange(image.imageId)}
              className={`group relative min-w-0 overflow-hidden rounded-md border bg-white text-left transition disabled:cursor-not-allowed ${isSelected ? "border-[#2f65cf] shadow-[0_0_0_2px_#2f65cf]" : "border-slate-200 hover:border-slate-300"} ${available ? "" : "opacity-55"}`}
              aria-pressed={isSelected}
            >
              <span className="relative block aspect-[5/3] overflow-hidden bg-slate-100">
                <WorkspaceImageMedia image={image} role={role} fit="cover" />
                <span className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border shadow-sm ${isSelected ? "border-[#2f65cf] bg-[#2f65cf] text-white" : "border-white/80 bg-white/90 text-transparent"}`}><FiCheck className="h-3.5 w-3.5" /></span>
              </span>
              <span className="block px-3 py-2.5">
                <strong className="block truncate text-xs font-semibold text-slate-800" title={image.name}>{middleEllipsisFileName(image.name, 34)}</strong>
                <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>{formatBytes(image.size)}</span>{available ? <span>{image.width} × {image.height}</span> : <span className="text-amber-600">{unavailableLabel}</span>}</span>
              </span>
            </button>;
          })}
        </div> : <div className="flex min-h-72 flex-col items-center justify-center px-5 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-100 text-slate-400"><FiImage className="h-5 w-5" /></span>
          <strong className="mt-3 text-sm font-semibold text-slate-700">{emptyTitle}</strong>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{emptyDescription}</p>
          {emptyActionLabel && onEmptyAction ? <button type="button" onClick={onEmptyAction} className="mt-4 h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd]">{emptyActionLabel}</button> : null}
        </div>}
        {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </div>

      <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
        <div className="min-w-0 flex-1">{footerLeading}</div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 rounded-md px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">{cancelLabel}</button>
          <button type="button" onClick={() => selected && void onConfirm(selected)} disabled={!selected || pending} className="inline-flex h-9 min-w-24 items-center justify-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40">{pending ? <><FiLoader className="h-3.5 w-3.5 animate-spin" />{pendingLabel}</> : actionLabel}</button>
        </div>
      </footer>
      {pending ? <div className="pointer-events-none absolute inset-x-0 bottom-0 top-14 flex items-center justify-center bg-white/65 backdrop-blur-[1px]" role="status" aria-live="polite"><span className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow"><FiLoader className="h-4 w-4 animate-spin text-[#2f65cf]" />{pendingLabel}</span></div> : null}
    </section>
  </div>;
}
