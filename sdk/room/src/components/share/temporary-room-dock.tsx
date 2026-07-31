"use client";

import {
  FiImage,
  FiMaximize2,
  FiMessageSquare,
  FiRadio,
} from "react-icons/fi";
import { createPortal } from "react-dom";
import type { Lang } from "../../locales";
import type {
  ConnectionState,
  RoomDockNotification,
} from "./share-room-types";

type TemporaryRoomDockProps = {
  lang: Lang;
  roomId: string;
  connection: ConnectionState;
  notifications: RoomDockNotification[];
  onRestore(): void;
};

function NotificationIcon({ item }: { item: RoomDockNotification }) {
  if (item.kind === "emoji") {
    return <span className="text-base leading-none">{item.label}</span>;
  }
  if (item.kind === "image") {
    return <FiImage className="h-4 w-4" aria-hidden="true" />;
  }
  return <FiMessageSquare className="h-4 w-4" aria-hidden="true" />;
}

export default function TemporaryRoomDock({
  lang,
  roomId,
  connection,
  notifications,
  onRestore,
}: TemporaryRoomDockProps) {
  const isConnected = connection === "connected";
  const title = lang === "zh" ? "分享房间仍在运行" : "Share room is active";
  const enter = lang === "zh" ? "恢复房间" : "Restore room";
  const unread = lang === "zh" ? "条新消息" : "new";
  const recent = notifications.slice(-3).reverse();

  if (typeof document === "undefined") return null;

  return createPortal(
    <aside className="fixed bottom-4 right-4 z-[2147483647] w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.2)]">
      <div className="flex items-center gap-3 p-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
          <FiRadio className="h-5 w-5" aria-hidden="true" />
          <span
            className={`absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-white ${isConnected ? "bg-emerald-500" : "bg-amber-400"}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
            {roomId}
          </div>
        </div>
        {notifications.length > 0 ? (
          <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white">
            {notifications.length} {unread}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onRestore}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white transition hover:bg-[#2457bd]"
          aria-label={enter}
          title={enter}
        >
          <FiMaximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {recent.length > 0 ? (
        <button
          type="button"
          onClick={onRestore}
          className="block w-full border-t border-slate-100 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
        >
          <span className="flex items-center gap-2 overflow-hidden">
            {recent.map((item) => (
              <span
                key={item.id}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-slate-600"
                title={item.label}
              >
                <span className="shrink-0 text-[#2f65cf]">
                  <NotificationIcon item={item} />
                </span>
                {item.kind === "emoji" ? null : (
                  <span className="truncate text-xs">{item.label}</span>
                )}
              </span>
            ))}
          </span>
        </button>
      ) : null}
    </aside>,
    document.body,
  );
}
