"use client";

import React from "react";
import type { IconType } from "react-icons";
import {
  FiArrowLeft,
  FiArrowUpRight,
  FiCircle,
  FiCornerUpLeft,
  FiCornerUpRight,
  FiEdit3,
  FiMaximize,
  FiMousePointer,
  FiRadio,
  FiRotateCcw,
  FiSmile,
  FiSquare,
  FiType,
  FiUserCheck,
  FiZoomIn,
  FiZoomOut,
} from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import { middleEllipsisFileName } from "../share-room-formatters";
import type { ReviewMode, ReviewTool } from "@/utils/review-collaboration";
import { TEST_EMOJIS } from "@/utils/realtime-peer-messages";

const ANNOTATION_COLORS = [
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

type ReviewToolbarProps = {
  imageName: string;
  zoomPercent: number;
  labels: ShareRoomLabels;
  activeTool: ReviewTool;
  canUndo: boolean;
  canRedo: boolean;
  localMode: ReviewMode;
  remoteMode: ReviewMode;
  remoteReviewActive: boolean;
  workspaceLocked: boolean;
  annotationColor: string;
  onBack(): void;
  onToolChange(tool: ReviewTool): void;
  onUndo(): void;
  onRedo(): void;
  onModeChange(mode: ReviewMode): void;
  onColorChange(color: string): void;
  onInsertEmoji(emoji: string): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  onReset(): void;
};

type ToolButtonProps = {
  icon: IconType;
  label: string;
  active?: boolean;
  remoteActive?: boolean;
  disabled?: boolean;
  onClick?(): void;
};

function ToolButton({
  icon: Icon,
  label,
  active = false,
  remoteActive = false,
  disabled = false,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition ${
        remoteActive
          ? "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-300"
          : active
          ? "bg-blue-50 text-[#2f65cf]"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      } disabled:cursor-not-allowed disabled:opacity-35 ${
        remoteActive ? "disabled:opacity-100" : ""
      }`}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export default function ReviewToolbar({
  imageName,
  zoomPercent,
  labels,
  activeTool,
  canUndo,
  canRedo,
  localMode,
  remoteMode,
  remoteReviewActive,
  workspaceLocked,
  annotationColor,
  onBack,
  onToolChange,
  onUndo,
  onRedo,
  onModeChange,
  onColorChange,
  onInsertEmoji,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: ReviewToolbarProps) {
  const [openPanel, setOpenPanel] = React.useState<"emoji" | "color" | null>(null);
  const panelsRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!panelsRef.current?.contains(event.target as Node)) setOpenPanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const annotationTools: ToolButtonProps[] = [
    { icon: FiMousePointer, label: labels.selectTool, onClick: () => onToolChange("select"), active: activeTool === "select", disabled: workspaceLocked },
    { icon: FiArrowUpRight, label: labels.arrowTool, onClick: () => onToolChange("arrow"), active: activeTool === "arrow", disabled: workspaceLocked },
    { icon: FiSquare, label: labels.rectangleTool, onClick: () => onToolChange("rectangle"), active: activeTool === "rectangle", disabled: workspaceLocked },
    { icon: FiCircle, label: labels.circleTool, onClick: () => onToolChange("circle"), active: activeTool === "circle", disabled: workspaceLocked },
    { icon: FiEdit3, label: labels.penTool, onClick: () => onToolChange("pen"), active: activeTool === "pen", disabled: workspaceLocked },
    { icon: FiType, label: labels.textTool, onClick: () => onToolChange("text"), active: activeTool === "text", disabled: workspaceLocked },
  ];

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex h-12 items-center gap-2 border-b border-slate-100 px-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          aria-label={labels.backToGallery}
          title={labels.backToGallery}
        >
          <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800" title={imageName}>
          {middleEllipsisFileName(imageName, 42)}
        </div>
        <div className="shrink-0 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-600">
          {zoomPercent}%
        </div>
      </div>

      <div ref={panelsRef} className="relative flex h-12 items-center gap-1 overflow-visible px-3 sm:px-4">
        {annotationTools.map((tool) => (
          <ToolButton key={tool.label} {...tool} />
        ))}
        <div className="relative shrink-0">
          <ToolButton
            icon={FiSmile}
            label={labels.emojiTool}
            active={openPanel === "emoji"}
            disabled={workspaceLocked}
            onClick={() => setOpenPanel((current) => current === "emoji" ? null : "emoji")}
          />
          {openPanel === "emoji" ? (
            <div className="absolute left-0 top-11 z-50 grid w-56 grid-cols-8 gap-1 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
              {TEST_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="flex h-8 w-6 items-center justify-center rounded text-lg transition hover:bg-slate-100"
                  onClick={() => {
                    onInsertEmoji(emoji);
                    setOpenPanel(null);
                  }}
                  aria-label={`${labels.emojiTool} ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            disabled={workspaceLocked}
            onClick={() => setOpenPanel((current) => current === "color" ? null : "color")}
            className={`flex h-9 w-9 items-center justify-center rounded-md transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 ${openPanel === "color" ? "bg-blue-50" : ""}`}
            aria-label={labels.annotationColor}
            title={labels.annotationColor}
          >
            <span
              className="h-5 w-5 rounded-full border border-slate-300 shadow-sm"
              style={{ backgroundColor: annotationColor }}
              aria-hidden="true"
            />
          </button>
          {openPanel === "color" ? (
            <div className="absolute left-0 top-11 z-50 grid w-44 grid-cols-5 gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-xl">
              {ANNOTATION_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`h-6 w-6 rounded-full border shadow-sm transition hover:scale-110 ${annotationColor === color ? "ring-2 ring-blue-500 ring-offset-2" : "border-slate-300"}`}
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    onColorChange(color);
                    setOpenPanel(null);
                  }}
                  aria-label={`${labels.annotationColor} ${color}`}
                />
              ))}
              <label className="relative flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-slate-400 bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" title={labels.annotationColor}>
                <input
                  type="color"
                  value={annotationColor}
                  onChange={(event) => onColorChange(event.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={labels.annotationColor}
                />
              </label>
            </div>
          ) : null}
        </div>
        <ToolButton icon={FiRadio} label={labels.laserTool} disabled />
        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
        <ToolButton icon={FiCornerUpLeft} label={labels.undo} onClick={onUndo} disabled={workspaceLocked || !canUndo} />
        <ToolButton icon={FiCornerUpRight} label={labels.redo} onClick={onRedo} disabled={workspaceLocked || !canRedo} />
        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
        <ToolButton icon={FiZoomOut} label={labels.zoomOut} onClick={onZoomOut} disabled={workspaceLocked} />
        <ToolButton icon={FiZoomIn} label={labels.zoomIn} onClick={onZoomIn} disabled={workspaceLocked} />
        <ToolButton icon={FiMaximize} label={labels.fitView} onClick={onFit} disabled={workspaceLocked} />
        <ToolButton icon={FiRotateCcw} label={labels.resetView} onClick={onReset} disabled={workspaceLocked} />
        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
        <ToolButton
          icon={FiUserCheck}
          label={labels.followPresenter}
          active={localMode === "follow"}
          remoteActive={remoteMode === "follow"}
          disabled={
            !remoteReviewActive ||
            localMode === "present" ||
            remoteMode === "follow"
          }
          onClick={() => onModeChange(localMode === "follow" ? null : "follow")}
        />
        <ToolButton
          icon={FiRadio}
          label={labels.present}
          active={localMode === "present"}
          remoteActive={remoteMode === "present"}
          disabled={
            !remoteReviewActive ||
            localMode === "follow" ||
            remoteMode === "present"
          }
          onClick={() => onModeChange(localMode === "present" ? null : "present")}
        />
      </div>
    </div>
  );
}
