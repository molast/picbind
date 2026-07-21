"use client";

import React from "react";
import { FiActivity, FiMessageCircle, FiUsers } from "react-icons/fi";
import { TbDevicesShare, TbWorldShare } from "react-icons/tb";
import type { ShareRoomLabels } from "../share-room-labels";
import type {
  ConnectionState,
  MessageTransportMode,
} from "../share-room-types";

type FullscreenSidebarRailProps = {
  connection: ConnectionState;
  messageTransportMode: MessageTransportMode;
  memberCount: number;
  activityCount: number;
  labels: ShareRoomLabels;
  children: React.ReactNode;
};

export default function FullscreenSidebarRail({
  connection,
  messageTransportMode,
  memberCount,
  activityCount,
  labels,
  children,
}: FullscreenSidebarRailProps) {
  const [expanded, setExpanded] = React.useState(false);
  const hideTimerRef = React.useRef<number | null>(null);
  const transportLabel =
    messageTransportMode === "relay" ? labels.relayMode : labels.p2pMode;
  const connectionLabel =
    connection === "connected"
      ? labels.connected
      : connection === "connecting"
        ? labels.connecting
        : connection === "error"
          ? labels.failed
          : labels.waiting;

  const cancelHide = React.useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const show = React.useCallback(() => {
    cancelHide();
    setExpanded(true);
  }, [cancelHide]);

  const scheduleHide = React.useCallback(() => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setExpanded(false);
    }, 1000);
  }, [cancelHide]);

  React.useEffect(() => cancelHide, [cancelHide]);

  const iconClass =
    "relative flex h-11 w-11 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900";

  return (
    <aside
      className="relative z-[130] flex min-h-0 w-[60px] flex-col items-center border-l border-slate-200 bg-white py-3 shadow-[-1px_0_0_rgba(15,23,42,0.02)]"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onTouchStart={show}
    >
      <span
        className={iconClass}
        aria-label={`${connectionLabel} · ${transportLabel}`}
        title={`${connectionLabel} · ${transportLabel}`}
        role="img"
      >
        {messageTransportMode === "relay" ? (
          <TbWorldShare className="h-5 w-5" aria-hidden="true" />
        ) : (
          <TbDevicesShare className="h-5 w-5" aria-hidden="true" />
        )}
        <span
          className={`absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-white ${
            connection === "connected"
              ? "bg-emerald-500"
              : connection === "error"
                ? "bg-red-500"
                : connection === "connecting"
                  ? "bg-amber-400"
                  : "bg-slate-300"
          }`}
          aria-hidden="true"
        />
      </span>

      <div className="my-2 h-px w-8 bg-slate-200" />

      <span
        className={iconClass}
        aria-label={labels.participants}
        title={labels.participants}
        role="img"
      >
        <FiUsers className="h-5 w-5" aria-hidden="true" />
        {memberCount > 0 ? (
          <span className="absolute right-1 top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#2f65cf] px-1 text-[9px] font-bold leading-none text-white">
            {Math.min(memberCount, 99)}
          </span>
        ) : null}
      </span>

      <span
        className={iconClass}
        aria-label={labels.testMessage}
        title={labels.testMessage}
        role="img"
      >
        <FiMessageCircle className="h-5 w-5" aria-hidden="true" />
      </span>

      <span
        className={iconClass}
        aria-label={labels.activity}
        title={labels.activity}
        role="img"
      >
        <FiActivity className="h-5 w-5" aria-hidden="true" />
        {activityCount > 0 ? (
          <span className="absolute right-1 top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-slate-700 px-1 text-[9px] font-bold leading-none text-white">
            {Math.min(activityCount, 99)}
          </span>
        ) : null}
      </span>

      <div
        className={`absolute bottom-0 right-full top-0 w-[clamp(320px,24vw,420px)] bg-white shadow-[-12px_0_28px_rgba(15,23,42,0.16)] transition duration-200 ease-out [&>aside]:h-full ${
          expanded
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none translate-x-4 opacity-0"
        }`}
        aria-hidden={!expanded}
      >
        {children}
      </div>
    </aside>
  );
}
