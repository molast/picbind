"use client";

import React from "react";

type FullscreenEdgePanelProps = {
  side: "top" | "right";
  hideDelayMs?: number;
  children: React.ReactNode;
};

export default function FullscreenEdgePanel({
  side,
  hideDelayMs = 3000,
  children,
}: FullscreenEdgePanelProps) {
  const [visible, setVisible] = React.useState(false);
  const hideTimerRef = React.useRef<number | null>(null);

  const cancelHide = React.useCallback(() => {
    if (hideTimerRef.current === null) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const show = React.useCallback(() => {
    cancelHide();
    setVisible(true);
  }, [cancelHide]);

  const scheduleHide = React.useCallback(() => {
    cancelHide();
    if (hideDelayMs <= 0) {
      setVisible(false);
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisible(false);
    }, hideDelayMs);
  }, [cancelHide, hideDelayMs]);

  React.useEffect(() => cancelHide, [cancelHide]);

  const isTop = side === "top";

  return (
    <div
      className={
        isTop
          ? "pointer-events-none fixed inset-x-0 top-0 z-[135] h-16"
          : "pointer-events-none fixed bottom-0 right-0 top-0 z-[134] w-[clamp(320px,24vw,420px)] max-w-full"
      }
    >
      <div
        className={
          isTop
            ? "pointer-events-auto absolute inset-x-0 top-0 h-3"
            : "pointer-events-auto absolute bottom-0 right-0 top-0 w-3"
        }
        aria-hidden="true"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      />
      <div
        className={`${
          isTop
            ? `absolute inset-x-0 top-0 ${visible ? "translate-y-0" : "-translate-y-full"}`
            : `absolute inset-0 bg-white ${visible ? "translate-x-0" : "translate-x-full"} [&>aside]:h-full`
        } pointer-events-auto shadow-2xl transition-transform duration-200 ease-out`}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      >
        {children}
      </div>
    </div>
  );
}
