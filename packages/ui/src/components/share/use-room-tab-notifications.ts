"use client";

import React from "react";

const MAX_PREVIEW_LENGTH = 24;

function notificationPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3)}...`;
}

export function useRoomTabNotifications() {
  const baseTitleRef = React.useRef<string | null>(null);
  const notificationTitleRef = React.useRef<string | null>(null);
  const unreadCountRef = React.useRef(0);

  const clear = React.useCallback(() => {
    if (
      baseTitleRef.current !== null &&
      document.title === notificationTitleRef.current
    ) {
      document.title = baseTitleRef.current;
    }
    baseTitleRef.current = null;
    notificationTitleRef.current = null;
    unreadCountRef.current = 0;
  }, []);

  React.useEffect(() => {
    const clearWhenActive = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        clear();
      }
    };
    document.addEventListener("visibilitychange", clearWhenActive);
    window.addEventListener("focus", clearWhenActive);
    return () => {
      document.removeEventListener("visibilitychange", clearWhenActive);
      window.removeEventListener("focus", clearWhenActive);
      clear();
    };
  }, [clear]);

  return React.useCallback((label: string) => {
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    if (unreadCountRef.current === 0) {
      baseTitleRef.current = document.title;
    }
    unreadCountRef.current += 1;
    const preview = notificationPreview(label);
    const title = `(${unreadCountRef.current}) ${preview} · ${baseTitleRef.current || "PicBind"}`;
    notificationTitleRef.current = title;
    document.title = title;
  }, []);
}
