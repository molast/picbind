"use client";

import { FiHardDrive, FiZap, FiX } from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import { useDialogEscape } from "../use-dialog-escape";

type ImageSourceDialogProps = {
  open: boolean;
  labels: ShareRoomLabels;
  onClose(): void;
  onLocal(): void;
  onCompressed(): void;
};

export default function ImageSourceDialog({
  open,
  labels,
  onClose,
  onLocal,
  onCompressed,
}: ImageSourceDialogProps) {
  useDialogEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-white shadow-2xl">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
          <h2 className="text-base font-semibold text-slate-900">{labels.chooseImageSource}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={labels.closeDialog}
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={onLocal}
            className="flex min-h-32 flex-col items-start rounded-md border border-slate-200 p-4 text-left transition hover:border-[#2f65cf] hover:bg-blue-50/60"
          >
            <FiHardDrive className="h-6 w-6 text-[#2f65cf]" aria-hidden="true" />
            <span className="mt-4 text-sm font-semibold text-slate-900">{labels.localImages}</span>
            <span className="mt-1 text-xs leading-5 text-slate-500">{labels.localImagesHint}</span>
          </button>
          <button
            type="button"
            onClick={onCompressed}
            className="flex min-h-32 flex-col items-start rounded-md border border-slate-200 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50/60"
          >
            <FiZap className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            <span className="mt-4 text-sm font-semibold text-slate-900">{labels.compressedImages}</span>
            <span className="mt-1 text-xs leading-5 text-slate-500">{labels.compressedImagesHint}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
