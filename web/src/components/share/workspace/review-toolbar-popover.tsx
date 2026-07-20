"use client";

import React from "react";
import { createPortal } from "react-dom";

type ReviewToolbarPopoverProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  width: number;
  children: React.ReactNode;
};

export default function ReviewToolbarPopover({
  anchorRef,
  open,
  width,
  children,
}: ReviewToolbarPopoverProps) {
  const [position, setPosition] = React.useState({ left: 8, top: 8 });

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 8,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, width]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      data-review-toolbar-popover="true"
      className="fixed z-[100]"
      style={{ left: position.left, top: position.top, width }}
    >
      {children}
    </div>,
    document.body,
  );
}
