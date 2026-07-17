"use client";

import { FiGlobe, FiLoader } from "react-icons/fi";
import type { ShareRoomLabels } from "./share-room-labels";
import { useDialogEscape } from "./use-dialog-escape";

type ExitRoomDialogProps = {
  open: boolean;
  pending: boolean;
  labels: ShareRoomLabels;
  onCancel(): void;
  onConfirm(): void | Promise<void>;
};

export default function ExitRoomDialog({
  open,
  pending,
  labels,
  onCancel,
  onConfirm,
}: ExitRoomDialogProps) {
  useDialogEscape(open, onCancel, !pending);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (!pending && event.currentTarget === event.target) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-room-dialog-title"
        aria-describedby="exit-room-dialog-description"
        className="w-full max-w-[560px] rounded-lg bg-[#444450] px-6 py-7 text-white shadow-2xl sm:px-8 sm:py-8"
      >
        <div id="exit-room-dialog-title" className="flex items-center gap-2 text-lg font-semibold">
          <FiGlobe className="h-5 w-5" aria-hidden="true" />
          <span>picbind.com</span>
        </div>
        <p
          id="exit-room-dialog-description"
          className="mt-8 max-w-[470px] text-lg leading-7 text-white sm:text-xl"
        >
          {labels.confirmLeaveRoom}
        </p>
        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-12 min-w-24 rounded-md bg-[#5a5a68] px-5 text-base font-semibold text-white transition hover:bg-[#666675] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={pending}
            className="inline-flex h-12 min-w-24 items-center justify-center gap-2 rounded-md bg-cyan-400 px-5 text-base font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? (
              <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {labels.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
