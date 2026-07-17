"use client";

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

type ReviewToolbarProps = {
  imageName: string;
  zoomPercent: number;
  labels: ShareRoomLabels;
  activeTool: ReviewTool;
  canUndo: boolean;
  canRedo: boolean;
  localMode: ReviewMode;
  remoteMode: ReviewMode;
  onBack(): void;
  onToolChange(tool: ReviewTool): void;
  onUndo(): void;
  onRedo(): void;
  onModeChange(mode: ReviewMode): void;
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
  onBack,
  onToolChange,
  onUndo,
  onRedo,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: ReviewToolbarProps) {
  const annotationTools: ToolButtonProps[] = [
    { icon: FiMousePointer, label: labels.selectTool, onClick: () => onToolChange("select"), active: activeTool === "select" },
    { icon: FiArrowUpRight, label: labels.arrowTool, onClick: () => onToolChange("arrow"), active: activeTool === "arrow" },
    { icon: FiSquare, label: labels.rectangleTool, onClick: () => onToolChange("rectangle"), active: activeTool === "rectangle" },
    { icon: FiCircle, label: labels.circleTool, onClick: () => onToolChange("circle"), active: activeTool === "circle" },
    { icon: FiEdit3, label: labels.penTool, onClick: () => onToolChange("pen"), active: activeTool === "pen" },
    { icon: FiType, label: labels.textTool, onClick: () => onToolChange("text"), active: activeTool === "text" },
    { icon: FiSmile, label: labels.emojiTool, onClick: () => onToolChange("emoji"), active: activeTool === "emoji" },
    { icon: FiRadio, label: labels.laserTool, disabled: true },
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

      <div className="flex h-12 items-center gap-1 overflow-x-auto px-3 sm:px-4">
        {annotationTools.map((tool) => (
          <ToolButton key={tool.label} {...tool} />
        ))}
        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
        <ToolButton icon={FiCornerUpLeft} label={labels.undo} onClick={onUndo} disabled={!canUndo} />
        <ToolButton icon={FiCornerUpRight} label={labels.redo} onClick={onRedo} disabled={!canRedo} />
        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
        <ToolButton icon={FiZoomOut} label={labels.zoomOut} onClick={onZoomOut} />
        <ToolButton icon={FiZoomIn} label={labels.zoomIn} onClick={onZoomIn} />
        <ToolButton icon={FiMaximize} label={labels.fitView} onClick={onFit} />
        <ToolButton icon={FiRotateCcw} label={labels.resetView} onClick={onReset} />
        <div className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
        <ToolButton
          icon={FiUserCheck}
          label={labels.followPresenter}
          active={localMode === "follow"}
          remoteActive={remoteMode === "follow"}
          disabled={localMode === "present" || remoteMode === "follow"}
          onClick={() => onModeChange(localMode === "follow" ? null : "follow")}
        />
        <ToolButton
          icon={FiRadio}
          label={labels.present}
          active={localMode === "present"}
          remoteActive={remoteMode === "present"}
          disabled={localMode === "follow" || remoteMode === "present"}
          onClick={() => onModeChange(localMode === "present" ? null : "present")}
        />
      </div>
    </div>
  );
}
