"use client";

import { FiArrowRight, FiZap } from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import { useDialogEscape } from "../use-dialog-escape";

type CompressionSuggestionDialogProps = {
  open: boolean;
  weakNetwork: boolean;
  labels: ShareRoomLabels;
  onContinue(): void;
  onCompress(): void | Promise<void>;
  onCancel(): void;
};

export default function CompressionSuggestionDialog({
  open,
  weakNetwork,
  labels,
  onContinue,
  onCompress,
  onCancel,
}: CompressionSuggestionDialogProps) {
  useDialogEscape(open, onCancel);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
          <FiZap className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-slate-900">{labels.compressionSuggested}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {weakNetwork ? labels.weakNetworkSuggestion : labels.largeImageSuggestion}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-md px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100">{labels.cancel}</button>
          <button type="button" onClick={onContinue} className="h-9 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{labels.continueOriginal}</button>
          <button type="button" onClick={() => void onCompress()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2457bd]">
            {labels.goCompress}
            <FiArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
