"use client";

import React from "react";

const escapeStack: symbol[] = [];

export function useDialogEscape(
  open: boolean,
  onClose: () => void,
  enabled = true,
) {
  const idRef = React.useRef(Symbol("dialog-escape"));
  const onCloseRef = React.useRef(onClose);
  const enabledRef = React.useRef(enabled);
  onCloseRef.current = onClose;
  enabledRef.current = enabled;

  React.useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    escapeStack.push(id);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        escapeStack[escapeStack.length - 1] !== id
      ) {
        return;
      }
      event.preventDefault();
      if (enabledRef.current) onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const index = escapeStack.lastIndexOf(id);
      if (index !== -1) escapeStack.splice(index, 1);
    };
  }, [open]);
}
