"use client";

import { FiCheck, FiCopy, FiX } from "react-icons/fi";
import type { ShareRoomLabels } from "./share-room-labels";

type CreatedRoomDialogProps = {
  open: boolean;
  roomId: string | null;
  shareUrl: string;
  copied: boolean;
  labels: ShareRoomLabels;
  onClose(): void;
  onCopy(): void | Promise<void>;
};

export default function CreatedRoomDialog({
  open,
  roomId,
  shareUrl,
  copied,
  labels,
  onClose,
  onCopy,
}: CreatedRoomDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="created-share-room-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="w-full max-w-[460px] rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 id="created-share-room-title" className="text-lg font-semibold">
            {labels.shareCreatedTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={labels.closeDialog}
            title={labels.closeDialog}
          >
            <FiX className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">
              {labels.room}
            </div>
            <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
              {roomId}
            </div>
          </div>
          <div>
            <label
              htmlFor="created-share-room-link"
              className="text-xs font-semibold uppercase text-slate-500"
            >
              {labels.shareLink}
            </label>
            <div className="mt-1 flex min-w-0 gap-2">
              <input
                id="created-share-room-link"
                readOnly
                value={shareUrl}
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                onClick={() => void onCopy()}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-3 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
              >
                {copied ? (
                  <FiCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FiCopy className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{copied ? labels.copied : labels.copy}</span>
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-500">{labels.expires}</p>
        </div>
      </div>
    </div>
  );
}
