"use client";

import React from "react";
import { FiAlertCircle, FiLoader, FiShare2, FiX } from "react-icons/fi";
import {
  createShareRoom,
  transferShareRoomSession,
} from "@/utils/share-room";
import type { Lang } from "@/locales";

type CreateRoomButtonProps = {
  lang: Lang;
  mobile?: boolean;
};

export default function CreateRoomButton({
  lang,
  mobile = false,
}: CreateRoomButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const labels =
    lang === "zh"
      ? {
          trigger: "分享图片",
          failedTitle: "房间创建失败",
          creating: "正在创建",
          retry: "重试",
          close: "关闭",
        }
      : {
          trigger: "Share Images",
          failedTitle: "Could not create room",
          creating: "Creating",
          retry: "Try again",
          close: "Close",
        };

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleCreate = async () => {
    if (isCreating) return;
    const roomTab = window.open("", "_blank");
    if (!roomTab) {
      setError(
        lang === "zh"
          ? "浏览器阻止了新标签页，请允许本站打开弹出式窗口。"
          : "The browser blocked the new tab. Allow pop-ups for this site.",
      );
      setIsOpen(true);
      return;
    }
    setIsCreating(true);
    setError(null);
    setIsOpen(false);
    try {
      const createdRoom = await createShareRoom();
      if (roomTab.closed) {
        throw new Error(
          lang === "zh" ? "新标签页已关闭" : "The new room tab was closed",
        );
      }
      const target = new URL(createdRoom.shareUrl);
      transferShareRoomSession(createdRoom.roomId, roomTab.sessionStorage);
      roomTab.location.replace(
        `${target.pathname}${target.search}${target.hash}`,
      );
      roomTab.opener = null;
      roomTab.focus();
    } catch (caught) {
      if (!roomTab.closed) roomTab.close();
      setError(
        caught instanceof Error ? caught.message : "Failed to create share room",
      );
      setIsOpen(true);
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

      {isOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-room-error-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsOpen(false);
            }
          }}
        >
          <div className="w-full max-w-[460px] rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 id="share-room-error-title" className="text-lg font-semibold">
                {labels.failedTitle}
              </h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label={labels.close}
                title={labels.close}
              >
                <FiX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-6">
              <div className="flex gap-3 rounded-md bg-red-50 px-3 py-3 text-sm text-red-700">
                <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="break-words">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
              >
                <FiShare2 className="h-4 w-4" aria-hidden="true" />
                <span>{labels.retry}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
