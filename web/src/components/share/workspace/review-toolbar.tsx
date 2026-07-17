"use client";

import React from "react";
import type { IconType } from "react-icons";
import {
  FiArrowLeft,
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
import {
  LuMinus,
  LuMoveUpRight,
  LuPaintBucket,
  LuSearch,
  LuUsersRound,
} from "react-icons/lu";
import { PiHandPalmBold } from "react-icons/pi";
import type { ShareRoomLabels } from "../share-room-labels";
import { middleEllipsisFileName } from "../share-room-formatters";
import type {
  ReviewMode,
  ReviewStrokeStyle,
  ReviewTool,
} from "@/utils/review-collaboration";
import { TEST_EMOJIS } from "@/utils/realtime-peer-messages";
import ReviewStrokeStyleTool from "./review-stroke-style-tool";
import ReviewColorTool from "./review-color-tool";

const LINE_THICKNESSES = [0.0015, 0.003, 0.005, 0.008] as const;

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
  fillColor: string | null;
  lineThickness: number;
  lineThicknessDisabled: boolean;
  arrowStyle: ReviewStrokeStyle;
  lineStyle: ReviewStrokeStyle;
  hasSelection: boolean;
  onBack(): void;
  onToolChange(tool: ReviewTool): void;
  onUndo(): void;
  onRedo(): void;
  onModeChange(mode: ReviewMode): void;
  onColorChange(color: string): void;
  onFillColorChange(color: string | null): void;
  onLineThicknessChange(value: number): void;
  onArrowStyleChange(style: ReviewStrokeStyle): void;
  onLineStyleChange(style: ReviewStrokeStyle): void;
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
  fillColor,
  lineThickness,
  lineThicknessDisabled,
  arrowStyle,
  lineStyle,
  hasSelection,
  onBack,
  onToolChange,
  onUndo,
  onRedo,
  onModeChange,
  onColorChange,
  onFillColorChange,
  onLineThicknessChange,
  onArrowStyleChange,
  onLineStyleChange,
  onInsertEmoji,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: ReviewToolbarProps) {
  const [openPanel, setOpenPanel] = React.useState<
    | "emoji"
    | "color"
    | "fill"
    | "line"
    | "arrowStyle"
    | "lineStyle"
    | null
  >(null);
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

  const navigationTools: ToolButtonProps[] = [
    { icon: FiMousePointer, label: labels.selectTool, onClick: () => onToolChange("select"), active: activeTool === "select", disabled: workspaceLocked },
    { icon: PiHandPalmBold, label: labels.handTool, onClick: () => onToolChange("hand"), active: activeTool === "hand", disabled: workspaceLocked },
    { icon: LuSearch, label: labels.magnifierTool, onClick: () => onToolChange("magnifier"), active: activeTool === "magnifier", disabled: workspaceLocked },
  ];
  const annotationTools: ToolButtonProps[] = [
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
        {navigationTools.map((tool) => (
          <ToolButton key={tool.label} {...tool} />
        ))}
        <ReviewStrokeStyleTool
          icon={LuMoveUpRight}
          label={labels.arrowTool}
          tool="arrow"
          style={arrowStyle}
          active={activeTool === "arrow"}
          panelOpen={openPanel === "arrowStyle"}
          disabled={workspaceLocked}
          styleLabels={{
            solid: labels.solidLine,
            dashed: labels.dashedLine,
            dotted: labels.dottedLine,
          }}
          onActivate={() => {
            if (!(hasSelection && activeTool === "arrow")) onToolChange("arrow");
          }}
          onTogglePanel={() =>
            setOpenPanel((current) => current === "arrowStyle" ? null : "arrowStyle")
          }
          onStyleChange={(style) => {
            onArrowStyleChange(style);
            setOpenPanel(null);
          }}
        />
        <ReviewStrokeStyleTool
          icon={LuMinus}
          label={labels.lineTool}
          tool="line"
          style={lineStyle}
          active={activeTool === "line"}
          panelOpen={openPanel === "lineStyle"}
          disabled={workspaceLocked}
          styleLabels={{
            solid: labels.solidLine,
            dashed: labels.dashedLine,
            dotted: labels.dottedLine,
          }}
          onActivate={() => {
            if (!(hasSelection && activeTool === "line")) onToolChange("line");
          }}
          onTogglePanel={() =>
            setOpenPanel((current) => current === "lineStyle" ? null : "lineStyle")
          }
          onStyleChange={(style) => {
            onLineStyleChange(style);
            setOpenPanel(null);
          }}
        />
        {annotationTools.map((tool) => (
          <ToolButton key={tool.label} {...tool} />
        ))}
        <div className="relative shrink-0">
          <ToolButton
            icon={FiSmile}
            label={labels.emojiTool}
            active={activeTool === "emoji" || openPanel === "emoji"}
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
            disabled={workspaceLocked || lineThicknessDisabled}
            onClick={() => setOpenPanel((current) => current === "line" ? null : "line")}
            className={`flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35 ${openPanel === "line" ? "bg-blue-50 text-blue-700" : ""}`}
            aria-label={labels.lineThickness}
            title={labels.lineThickness}
          >
            <span
              className="block w-5 rounded-full bg-current"
              style={{ height: Math.max(1, Math.min(6, lineThickness * 750)) }}
              aria-hidden="true"
            />
          </button>
          {openPanel === "line" ? (
            <div className="absolute left-0 top-11 z-50 flex w-40 flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
              {LINE_THICKNESSES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`flex h-8 items-center justify-center rounded transition hover:bg-slate-100 ${Math.abs(lineThickness - value) < 0.0001 ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200" : "text-slate-700"}`}
                  onClick={() => {
                    onLineThicknessChange(value);
                    setOpenPanel(null);
                  }}
                  aria-label={labels.lineThickness}
                >
                  <span
                    className="block w-24 rounded-full bg-current"
                    style={{ height: Math.max(1, value * 750) }}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <ReviewColorTool
          label={labels.annotationColor}
          color={annotationColor}
          panelOpen={openPanel === "color"}
          disabled={workspaceLocked}
          onToggle={() =>
            setOpenPanel((current) => current === "color" ? null : "color")
          }
          onChange={(color) => {
            if (color) onColorChange(color);
            setOpenPanel(null);
          }}
        />
        <ReviewColorTool
          label={labels.annotationFill}
          clearLabel={labels.noFill}
          icon={LuPaintBucket}
          color={fillColor}
          panelOpen={openPanel === "fill"}
          disabled={workspaceLocked}
          onToggle={() =>
            setOpenPanel((current) => current === "fill" ? null : "fill")
          }
          onChange={(color) => {
            onFillColorChange(color);
            setOpenPanel(null);
          }}
        />
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
        <div
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            remoteReviewActive ? "text-emerald-600" : "text-slate-400"
          }`}
          role="status"
          aria-label={remoteReviewActive ? labels.reviewLive : labels.reviewWaiting}
          title={remoteReviewActive ? labels.reviewLive : labels.reviewWaiting}
        >
          <LuUsersRound className="h-[18px] w-[18px]" aria-hidden="true" />
          <span
            className={`absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full border-2 border-white ${
              remoteReviewActive ? "bg-emerald-500" : "bg-slate-300"
            }`}
            aria-hidden="true"
          />
        </div>
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
