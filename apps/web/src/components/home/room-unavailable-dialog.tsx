"use client";

import { FiAlertCircle, FiX } from "react-icons/fi";
import type { Lang } from "@/locales";

export type RoomUnavailableReason = "closed" | "kicked";

type RoomUnavailableDialogProps = {
  lang: Lang;
  reason: RoomUnavailableReason | null;
  onClose(): void;
};

export default function RoomUnavailableDialog({
  lang,
  reason,
  onClose,
}: RoomUnavailableDialogProps) {
  if (!reason) return null;

  const copy =
    lang === "zh"
      ? reason === "closed"
        ? {
            title: "房间已解散",
            message: "房主已退出并解散房间，你已返回首页。",
            close: "知道了",
          }
        : {
            title: "你已被移出房间",
            message: "房主已将你移出分享房间，你已返回首页。",
            close: "知道了",
          }
      : reason === "closed"
        ? {
            title: "Room closed",
            message: "The owner left and closed the room. You have returned home.",
            close: "Got it",
          }
        : {
            title: "Removed from room",
            message: "The owner removed you from the share room. You have returned home.",
            close: "Got it",
          };

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-unavailable-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
              <FiAlertCircle className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 id="room-unavailable-title" className="text-lg font-semibold">
              {copy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={copy.close}
            title={copy.close}
          >
            <FiX className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600">{copy.message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
        >
          {copy.close}
        </button>
      </div>
    </div>
  );
}
