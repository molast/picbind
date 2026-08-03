"use client";

import React from "react";
import { FiAlertCircle, FiLoader, FiShare2, FiX } from "react-icons/fi";
import { createShareRoom, type ShareRoom } from "../../utils/share-room";
import { getShareRoomLabels, type Lang } from "../../locales";

type CreateRoomButtonProps = {
  lang: Lang;
  mobile?: boolean;
  hasActiveRoom?: boolean;
  onRoomCreated?(room: ShareRoom): void;
  onRestoreActiveRoom?(): void;
};

export default function CreateRoomButton({
  lang,
  mobile = false,
  hasActiveRoom = false,
  onRoomCreated,
  onRestoreActiveRoom,
}: CreateRoomButtonProps) {
  const [dialog, setDialog] = React.useState<"error" | "active-room" | null>(
    null,
  );
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const copy = getShareRoomLabels(lang);
  const labels = {
    trigger: copy.createRoom,
    failedTitle: copy.createRoomFailed,
    activeRoomTitle: copy.activeRoomTitle,
    activeRoomMessage: copy.activeRoomMessage,
    restoreRoom: copy.restoreRoom,
    creating: copy.creatingRoom,
    retry: copy.retry,
    close: copy.closeDialog,
  };

  React.useEffect(() => {
    if (!dialog) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDialog(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog]);

  const handleCreate = async () => {
    if (isCreating) return;
    if (hasActiveRoom) {
      setDialog("active-room");
      return;
    }
    setIsCreating(true);
    setError(null);
    setDialog(null);
    try {
      const createdRoom = await createShareRoom();
      if (onRoomCreated) {
        onRoomCreated(createdRoom);
      } else {
        const target = new URL(createdRoom.shareUrl);
        window.location.assign(target.toString());
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : copy.createRoomFailed,
      );
      setDialog("error");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={isCreating}
        className={
          mobile
            ? "relative inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition hover:bg-white/35 sm:px-3"
            : "relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition hover:bg-white/35"
        }
      >
        <FiShare2 className="h-4 w-4" aria-hidden="true" />
        <span>{labels.trigger}</span>
        <span
          className="pointer-events-none absolute -right-2 -top-2 rounded bg-[#2f65cf] px-1.5 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm"
          aria-hidden="true"
        >
          BETA
        </span>
      </button>

      {isCreating ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-white/55 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label={labels.creating}
        >
          <div className="flex flex-col items-center gap-3 text-[#2f65cf]">
            <FiLoader className="h-9 w-9 animate-spin" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700">
              {labels.creating}
            </span>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-room-dialog-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setDialog(null);
            }
          }}
        >
          <div className="w-full max-w-[460px] rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 id="share-room-dialog-title" className="text-lg font-semibold">
                {dialog === "active-room"
                  ? labels.activeRoomTitle
                  : labels.failedTitle}
              </h2>
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label={labels.close}
                title={labels.close}
              >
                <FiX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-6">
              <div
                className={`flex gap-3 rounded-md px-3 py-3 text-sm ${
                  dialog === "active-room"
                    ? "bg-amber-50 text-amber-800"
                    : "bg-red-50 text-red-700"
                }`}
              >
                <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="break-words">
                  {dialog === "active-room" ? labels.activeRoomMessage : error}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (dialog === "active-room") {
                    setDialog(null);
                    onRestoreActiveRoom?.();
                  } else {
                    void handleCreate();
                  }
                }}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
              >
                <FiShare2 className="h-4 w-4" aria-hidden="true" />
                <span>
                  {dialog === "active-room" ? labels.restoreRoom : labels.retry}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
