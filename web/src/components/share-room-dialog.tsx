"use client";

import React from "react";
import { FiCheck, FiCopy, FiLoader, FiShare2, FiX } from "react-icons/fi";
import { createShareRoom, type ShareRoom } from "@/utils/share-room";
import type { Lang } from "@/locales";

type ShareRoomDialogProps = {
  lang: Lang;
  mobile?: boolean;
};

export default function ShareRoomDialog({
  lang,
  mobile = false,
}: ShareRoomDialogProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [room, setRoom] = React.useState<ShareRoom | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const labels =
    lang === "zh"
      ? {
          trigger: "分享图片",
          title: "创建分享房间",
          create: "创建房间",
          creating: "正在创建",
          roomId: "房间 ID",
          link: "分享链接",
          copy: "复制链接",
          copied: "已复制",
          expires: "房间将在 30 分钟后过期",
          retry: "重试",
          close: "关闭",
        }
      : {
          trigger: "Share Images",
          title: "Create share room",
          create: "Create room",
          creating: "Creating",
          roomId: "Room ID",
          link: "Share link",
          copy: "Copy link",
          copied: "Copied",
          expires: "This room expires in 30 minutes",
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
    setIsCreating(true);
    setError(null);
    setCopied(false);
    try {
      setRoom(await createShareRoom());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to create share room",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!room) {
      return;
    }
    await navigator.clipboard.writeText(room.shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          if (!room && !isCreating) {
            void handleCreate();
          }
        }}
        className={
          mobile
            ? "inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition hover:bg-white/35 sm:px-3"
            : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition hover:bg-white/35"
        }
      >
        <FiShare2 className="h-4 w-4" aria-hidden="true" />
        <span>{labels.trigger}</span>
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-room-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsOpen(false);
            }
          }}
        >
          <div className="w-full max-w-[460px] rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 id="share-room-title" className="text-lg font-semibold">
                {labels.title}
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

            {room ? (
              <div className="mt-5 space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    {labels.roomId}
                  </div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                    {room.roomId}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="share-room-link"
                    className="text-xs font-semibold uppercase text-slate-500"
                  >
                    {labels.link}
                  </label>
                  <div className="mt-1 flex min-w-0 gap-2">
                    <input
                      id="share-room-link"
                      readOnly
                      value={room.shareUrl}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
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
            ) : (
              <div className="mt-6">
                {error ? (
                  <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd] disabled:cursor-wait disabled:opacity-70"
                >
                  {isCreating ? (
                    <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FiShare2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {isCreating
                      ? labels.creating
                      : error
                        ? labels.retry
                        : labels.create}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
