"use client";

import { FiTrash2 } from "react-icons/fi";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";
import { useDialogEscape } from "../use-dialog-escape";

type ReviewClearCommentsDialogProps = {
  open: boolean;
  count: number;
  labels: WorkspaceEditorLabels;
  onCancel(): void;
  onConfirm(): void;
};

export default function ReviewClearCommentsDialog({
  open,
  count,
  labels,
  onCancel,
  onConfirm,
}: ReviewClearCommentsDialogProps) {
  useDialogEscape(open, onCancel);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="review-clear-comments-title"
        aria-describedby="review-clear-comments-description"
        className="w-full max-w-md rounded-md bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
            <FiTrash2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id="review-clear-comments-title" className="text-base font-semibold text-slate-900">
              {labels.anchorClearTitle}
            </h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{count}</p>
          </div>
        </div>
        <p id="review-clear-comments-description" className="mt-5 text-sm leading-6 text-slate-600">
          {labels.anchorClearDescription}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {labels.cancel}
          </button>
          <button type="button" onClick={onConfirm} className="h-9 rounded-md bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700">
            {labels.anchorClearConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
