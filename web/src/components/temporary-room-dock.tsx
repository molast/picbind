"use client";

import React from "react";
import { FiMaximize2, FiRadio } from "react-icons/fi";
import type { Lang } from "@/locales";
import { getRealtimeRoomStatus, RealtimeRoomRequestError } from "@/utils/realtime-room";
import {
  clearTemporaryShareRoom,
  getTemporaryShareRoom,
  type ShareRoom,
} from "@/utils/share-room";

export default function TemporaryRoomDock({ lang }: { lang: Lang }) {
  const [room, setRoom] = React.useState<ShareRoom | null>(null);

  React.useEffect(() => {
    const temporaryRoom = getTemporaryShareRoom();
    setRoom(temporaryRoom);
    if (!temporaryRoom) {
      return;
    }

    const checkRoom = async () => {
      try {
        await getRealtimeRoomStatus(temporaryRoom.roomId);
      } catch (error) {
        if (error instanceof RealtimeRoomRequestError && error.status === 404) {
          clearTemporaryShareRoom(temporaryRoom.roomId);
          setRoom(null);
        }
      }
    };
    void checkRoom();
    const timer = window.setInterval(() => void checkRoom(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!room) {
    return null;
  }

  const title = lang === "zh" ? "临时离开的房间" : "Paused share room";
  const enter = lang === "zh" ? "重新进入" : "Re-enter";

  return (
    <aside className="fixed bottom-4 right-4 z-50 w-[min(320px,calc(100vw-32px))] rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.2)]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
          <FiRadio className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 truncate font-mono text-xs text-slate-500">
            {room.roomId}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const target = new URL(room.shareUrl);
            window.location.assign(
              `${target.pathname}${target.search}${target.hash}`,
            );
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white transition hover:bg-[#2457bd]"
          aria-label={enter}
          title={enter}
        >
          <FiMaximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
