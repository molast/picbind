"use client";

import React from "react";

export default function PageZoomLock() {
  React.useEffect(() => {
    const preventGesture = (event: Event) => event.preventDefault();
    const preventModifiedWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const preventZoomShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (["+", "-", "=", "0"].includes(event.key)) event.preventDefault();
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });
    window.addEventListener("wheel", preventModifiedWheel, { passive: false });
    window.addEventListener("keydown", preventZoomShortcut);

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      window.removeEventListener("wheel", preventModifiedWheel);
      window.removeEventListener("keydown", preventZoomShortcut);
    };
  }, []);

  return null;
}
