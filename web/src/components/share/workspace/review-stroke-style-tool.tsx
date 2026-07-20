"use client";

import React from "react";
import type { IconType } from "react-icons";
import type { ReviewStrokeStyle } from "@/utils/review-collaboration";
import ReviewToolbarPopover from "./review-toolbar-popover";

type ReviewStrokeStyleToolProps = {
  icon: IconType;
  label: string;
  tool: "arrow" | "line";
  style: ReviewStrokeStyle;
  active: boolean;
  panelOpen: boolean;
  disabled: boolean;
  styleLabels: Record<ReviewStrokeStyle, string>;
  onActivate(): void;
  onTogglePanel(): void;
  onStyleChange(style: ReviewStrokeStyle): void;
};

const STYLES: ReviewStrokeStyle[] = ["solid", "dashed", "dotted"];

function StrokePreview({
  style,
  arrow,
}: {
  style: ReviewStrokeStyle;
  arrow: boolean;
}) {
  return (
    <span className="relative block h-4 w-24" aria-hidden="true">
      <span
        className="absolute left-0 right-1 top-1/2 border-t-2 border-current"
        style={{ borderTopStyle: style }}
      />
      {arrow ? (
        <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-current" />
      ) : null}
    </span>
  );
}

export default function ReviewStrokeStyleTool({
  icon: Icon,
  label,
  tool,
  style,
  active,
  panelOpen,
  disabled,
  styleLabels,
  onActivate,
  onTogglePanel,
  onStyleChange,
}: ReviewStrokeStyleToolProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          onActivate();
          onTogglePanel();
        }}
        className={`flex h-9 w-9 items-center justify-center rounded-md transition ${
          active || panelOpen
            ? "bg-blue-50 text-[#2f65cf]"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        } disabled:cursor-not-allowed disabled:opacity-35`}
        aria-label={label}
        title={label}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <ReviewToolbarPopover anchorRef={buttonRef} open={panelOpen} width={144}>
        <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
          {STYLES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onStyleChange(item)}
              className={`flex h-9 items-center justify-center rounded px-3 transition hover:bg-slate-100 ${
                style === item
                  ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
                  : "text-slate-700"
              }`}
              aria-label={`${label} - ${styleLabels[item]}`}
              title={styleLabels[item]}
            >
              <StrokePreview style={item} arrow={tool === "arrow"} />
            </button>
          ))}
        </div>
      </ReviewToolbarPopover>
    </div>
  );
}
