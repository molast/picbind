"use client";

import React from "react";
import { createPortal } from "react-dom";
import { FiClock } from "react-icons/fi";
import type { RoomImage } from "../share-room-types";
import { formatBytes } from "../share-room-formatters";
import type { ShareRoomLabels } from "../share-room-labels";

type ImageVersionMenuProps = {
  versions: RoomImage[];
  labels: ShareRoomLabels;
  selectedId: string;
  onSelect(imageId: string): void;
};

const MENU_WIDTH = 192;

export default function ImageVersionMenu({
  versions,
  labels,
  selectedId,
  onSelect,
}: ImageVersionMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0, maxHeight: 224 });
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, rect.left));
      const top = rect.bottom + 6;
      setPosition({
        left,
        top,
        maxHeight: Math.max(96, Math.min(224, window.innerHeight - top - 12)),
      });
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (versions.length < 2) return null;
  const currentVersion = versions.find((item) => item.id === selectedId)?.version || 1;

  return (
    <div className="absolute bottom-2 left-2 z-20">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-6 items-center gap-1 rounded-md bg-white/95 px-1.5 text-[9px] font-semibold text-slate-700 shadow-sm"
        title={labels.imageVersion}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FiClock className="h-3 w-3" aria-hidden="true" />
        v{currentVersion} · {versions.length}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              className="fixed z-[110] w-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-xl"
              style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
            >
              {[...versions]
                .sort((a, b) => b.version - a.version)
                .map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    role="option"
                    aria-selected={selectedId === version.id}
                    onClick={() => {
                      onSelect(version.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                      selectedId === version.id
                        ? "bg-blue-50 text-[#2f65cf]"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      <strong>v{version.version}</strong> · {version.operation}
                    </span>
                    <span className="shrink-0 text-[10px] opacity-75">
                      {formatBytes(version.size)}
                    </span>
                  </button>
                ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
