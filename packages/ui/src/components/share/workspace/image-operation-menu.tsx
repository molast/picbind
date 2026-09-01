"use client";

import React from "react";
import {
  FiCrop,
  FiMoreHorizontal,
  FiSliders,
} from "react-icons/fi";
import { TbArrowsExchange, TbArrowsMinimize, TbDimensions } from "react-icons/tb";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";

type ImageOperationMenuProps = {
  disabled: boolean;
  labels: WorkspaceEditorLabels;
  onConvert(): void;
  onCompress(): void;
  onCrop(): void;
  onResize(): void;
  onAdjust(): void;
};

const operations = [
  {
    icon: TbArrowsExchange,
    labelKey: "imageConvert",
    action: "convert",
    x: 36,
    y: 0,
    available: true,
  },
  {
    icon: TbArrowsMinimize,
    labelKey: "imageCompress",
    action: "compress",
    x: 36,
    y: 34,
    available: true,
  },
  {
    icon: FiCrop,
    labelKey: "imageCrop",
    action: "crop",
    x: 36,
    y: 68,
    available: true,
  },
  {
    icon: TbDimensions,
    labelKey: "imageResize",
    action: "resize",
    x: 36,
    y: 102,
    available: true,
  },
  {
    icon: FiSliders,
    labelKey: "imageAdjust",
    action: "adjust",
    x: 36,
    y: 136,
    available: true,
  },
] as const;

export default function ImageOperationMenu({
  disabled,
  labels,
  onConvert,
  onCompress,
  onCrop,
  onResize,
  onAdjust,
}: ImageOperationMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute right-2 top-2 z-30 h-7 w-7">
      {operations.map(({ icon: Icon, labelKey, action, x, y, ...operation }, index) => {
        const label = labels[labelKey];
        const available = "available" in operation && operation.available;
        return (
          <button
            key={labelKey}
            type="button"
            role="menuitem"
            disabled={!available || disabled}
            onClick={() => {
              if (!available) return;
              setOpen(false);
              if (action === "convert") onConvert();
              if (action === "compress") onCompress();
              if (action === "crop") onCrop();
              if (action === "resize") onResize();
              if (action === "adjust") onAdjust();
            }}
            className={`pointer-events-auto absolute flex h-7 w-7 items-center justify-center rounded-full shadow-lg backdrop-blur transition-all duration-200 ${
              open
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-50 opacity-0"
            } ${
              available
                ? "bg-[#2f65cf] text-white hover:bg-[#2457bd]"
                : "bg-white/95 text-slate-400"
            } disabled:cursor-not-allowed disabled:opacity-45`}
            style={{
              left: x,
              top: y,
              transform: open
                ? "translate(0, 0) scale(1)"
                : `translate(${-x}px, ${-y}px) scale(.45)`,
              transitionDelay: open ? `${index * 30}ms` : "0ms",
            }}
            title={
              available
                ? disabled
                  ? labels.imageRequiresOriginal
                  : label
                : labels.comingSoon(label)
            }
            aria-label={
              available ? label : labels.comingSoon(label)
            }
            tabIndex={open ? 0 : -1}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`pointer-events-auto absolute inset-0 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf] ${
          open ? "text-[#2f65cf] ring-2 ring-blue-200" : ""
        }`}
        title={labels.imageActions}
        aria-label={labels.imageActions}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FiMoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
