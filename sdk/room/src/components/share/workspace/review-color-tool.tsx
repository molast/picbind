"use client";

import React from "react";
import type { IconType } from "react-icons";
import ReviewToolbarPopover from "./review-toolbar-popover";

const COLORS = [
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ffffff",
] as const;

type ReviewColorToolProps = {
  label: string;
  clearLabel?: string;
  icon?: IconType;
  color: string | null;
  panelOpen: boolean;
  active?: boolean;
  disabled: boolean;
  onToggle(): void;
  onChange(color: string | null): void;
};

function ColorSwatch({ color }: { color: string | null }) {
  return (
    <span
      className="relative h-5 w-5 overflow-hidden rounded-full border border-slate-300 shadow-sm"
      style={
        color
          ? { backgroundColor: color }
          : {
              backgroundColor: "#ffffff",
              backgroundImage:
                "linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)",
              backgroundPosition: "0 0,0 4px,4px -4px,-4px 0",
              backgroundSize: "8px 8px",
            }
      }
      aria-hidden="true"
    >
      {!color ? (
        <span className="absolute left-[-2px] top-1/2 h-0.5 w-7 -translate-y-1/2 rotate-45 bg-red-500" />
      ) : null}
    </span>
  );
}

export default function ReviewColorTool({
  label,
  clearLabel,
  icon: Icon,
  color,
  panelOpen,
  active = false,
  disabled,
  onToggle,
  onChange,
}: ReviewColorToolProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-9 w-9 items-center justify-center rounded-md transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 ${
          panelOpen || active ? "bg-blue-50 text-blue-700" : ""
        }`}
        aria-label={label}
        title={label}
      >
        {Icon ? (
          <span className="relative flex h-6 w-6 items-center justify-center text-slate-600">
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            <span
              className="absolute bottom-0 h-1 w-5 rounded-full border border-slate-300"
              style={{ backgroundColor: color || "transparent" }}
              aria-hidden="true"
            />
          </span>
        ) : (
          <ColorSwatch color={color} />
        )}
      </button>
      <ReviewToolbarPopover anchorRef={buttonRef} open={panelOpen} width={176}>
        <div className="grid grid-cols-5 gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-xl">
          {clearLabel ? (
            <button
              type="button"
              className={`flex h-6 w-6 items-center justify-center rounded-full transition hover:scale-110 ${
                color === null ? "ring-2 ring-blue-500 ring-offset-2" : ""
              }`}
              onClick={() => onChange(null)}
              aria-label={clearLabel}
              title={clearLabel}
            >
              <ColorSwatch color={null} />
            </button>
          ) : null}
          {COLORS.map((item) => (
            <button
              key={item}
              type="button"
              className={`h-6 w-6 rounded-full border shadow-sm transition hover:scale-110 ${
                color === item
                  ? "ring-2 ring-blue-500 ring-offset-2"
                  : "border-slate-300"
              }`}
              style={{ backgroundColor: item }}
              onClick={() => onChange(item)}
              aria-label={`${label} ${item}`}
            />
          ))}
          <label
            className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-400 bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]"
            title={label}
          >
            <input
              type="color"
              value={color || "#000000"}
              onChange={(event) => onChange(event.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={label}
            />
          </label>
        </div>
      </ReviewToolbarPopover>
    </div>
  );
}
