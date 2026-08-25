"use client";

import React from "react";
import { FiFolder, FiLoader, FiTrash2, FiX } from "react-icons/fi";
import type { RoomImage } from "../share-room-types";
import { middleEllipsisFileName } from "../share-room-formatters";
import type { ShareRoomLabels } from "../share-room-labels";

type ImageDeleteConfirmDialogProps = {
  image: RoomImage | null;
  labels: ShareRoomLabels;
  onCancel(): void;
  onConfirm(image: RoomImage): void | Promise<void>;
  onMoveToLibrary(image: RoomImage): void | Promise<void>;
  onReturnToLibrary(image: RoomImage): void | Promise<void>;
};

export default function ImageDeleteConfirmDialog({
  image,
  labels,
  onCancel,
  onConfirm,
  onMoveToLibrary,
  onReturnToLibrary,
}: ImageDeleteConfirmDialogProps) {
  const [pendingAction, setPendingAction] = React.useState<"delete" | "move" | null>(null);

  React.useEffect(() => setPendingAction(null), [image]);
  React.useEffect(() => {
    if (!image) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingAction) onCancel();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [image, onCancel, pendingAction]);

  if (!image) return null;
  const returnToLibraryOnly = image.outboxOrigin === "library";
  const isEditing = Boolean(image.reviewOperationCount);
  const run = async (action: "delete" | "move") => {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      if (action === "delete") await onConfirm(image);
      else if (returnToLibraryOnly) await onReturnToLibrary(image);
      else await onMoveToLibrary(image);
      onCancel();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4">
      <section
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-label={labels.deleteImage}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
              <FiTrash2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="min-w-0 text-base font-semibold text-slate-900">
              {isEditing ? labels.editingImageTitle : labels.removeImageTitle}
            </h2>
          </div>
          <button
            type="button"
            disabled={Boolean(pendingAction)}
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-35"
            aria-label={labels.closeDialog}
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {isEditing
            ? returnToLibraryOnly
              ? labels.editingReturnDescription
              : labels.editingRemoveDescription
            : labels.removeImageDescription}
        </p>
        <p className="mt-3 truncate rounded-md bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700" title={image.name}>
          {middleEllipsisFileName(image.name, 44)}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={Boolean(pendingAction)}
            onClick={onCancel}
            className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-35"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            disabled={Boolean(pendingAction)}
            onClick={() => void run("move")}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2f65cf] px-4 text-xs font-semibold text-[#2f65cf] hover:bg-blue-50 disabled:opacity-50"
          >
            {pendingAction === "move" ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FiFolder className="h-3.5 w-3.5" aria-hidden="true" />}
            {labels.moveToLibrary}
          </button>
          {!returnToLibraryOnly ? <button
            type="button"
            disabled={Boolean(pendingAction)}
            onClick={() => void run("delete")}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pendingAction === "delete" ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {labels.deleteAction}
          </button> : null}
        </div>
      </section>
    </div>
  );
}
