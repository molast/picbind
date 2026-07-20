"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { RoomImage } from "../share-room-types";
import type {
  ReviewAnnotation,
  ReviewStrokeStyle,
  ReviewTool,
} from "@/utils/review-collaboration";
import ReviewMagnifierLens from "./review-magnifier-lens";

const ReviewAnnotationLayer = dynamic(
  () => import("./review-annotation-layer"),
  { ssr: false },
);

const WHEEL_ZOOM_SENSITIVITY = 0.0015;

function estimateTextWidth(text: string, fontSize: number) {
  const units = Array.from(text || " ").reduce((total, character) => {
    if (/\s/.test(character)) return total + 0.34;
    if (/[\u2e80-\u9fff\uf900-\ufaff]/.test(character)) return total + 1;
    return total + 0.58;
  }, 0);
  return units * fontSize + fontSize * 0.45;
}

export type ReviewViewportOffset = { x: number; y: number };
export type ReviewMagnifierPoint = { x: number; y: number };
export type ReviewRemoteMagnifier = ReviewMagnifierPoint & { highlight: boolean };
type MagnifierPosition = {
  pointerX: number;
  pointerY: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

type ReviewCanvasProps = {
  image: RoomImage;
  scale: number;
  offset: ReviewViewportOffset;
  activeTool: ReviewTool;
  annotations: ReviewAnnotation[];
  selectedIds: string[];
  actorId: string;
  defaultColor: string;
  defaultFill: string | null;
  defaultStrokeRatio: number;
  arrowStyle: ReviewStrokeStyle;
  lineStyle: ReviewStrokeStyle;
  interactionDisabled: boolean;
  remoteMagnifier: ReviewRemoteMagnifier | null;
  onScaleChange(scale: number): void;
  onOffsetChange(offset: ReviewViewportOffset): void;
  onDimensionsChange(dimensions: { width: number; height: number }): void;
  onCanvasSizeChange(dimensions: { width: number; height: number }): void;
  onSelect(ids: string[]): void;
  onCreate(annotation: ReviewAnnotation): void;
  onUpdate(before: ReviewAnnotation, after: ReviewAnnotation): void;
  onMagnifierChange(position: ReviewMagnifierPoint | null): void;
};

export default function ReviewCanvas({
  image,
  scale,
  offset,
  activeTool,
  annotations,
  selectedIds,
  actorId,
  defaultColor,
  defaultFill,
  defaultStrokeRatio,
  arrowStyle,
  lineStyle,
  interactionDisabled,
  remoteMagnifier,
  onScaleChange,
  onOffsetChange,
  onDimensionsChange,
  onCanvasSizeChange,
  onSelect,
  onCreate,
  onUpdate,
  onMagnifierChange,
}: ReviewCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const imageSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const magnifierPointerRef = React.useRef<{
    pointerId: number;
    position: MagnifierPosition;
  } | null>(null);
  const magnifierTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const magnifierVisibleRef = React.useRef(false);
  const [magnifierPosition, setMagnifierPosition] =
    React.useState<MagnifierPosition | null>(null);
  const [remoteMagnifierPosition, setRemoteMagnifierPosition] =
    React.useState<MagnifierPosition | null>(null);
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const [annotationSnapshot, setAnnotationSnapshot] = React.useState<string | null>(
    null,
  );
  const [textEditor, setTextEditor] = React.useState<{
    sessionId: string;
    x: number;
    y: number;
    strokeWidth: number;
    value: string;
    color: string;
    width?: number;
    height?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    before?: ReviewAnnotation;
  } | null>(null);
  const textInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const textCaretRef = React.useRef(0);
  const textEditorRef = React.useRef(textEditor);
  textEditorRef.current = textEditor;
  const textEditorSessionId = textEditor?.sessionId;
  const fitRatio =
    containerSize.width && containerSize.height && imageSize.width && imageSize.height
      ? Math.min(
          Math.max(1, containerSize.width - 32) / imageSize.width,
          Math.max(1, containerSize.height - 32) / imageSize.height,
        )
      : 0;
  const renderedSize = {
    width: Math.max(1, Math.round(imageSize.width * fitRatio)),
    height: Math.max(1, Math.round(imageSize.height * fitRatio)),
  };
  const textEditorFontSize = textEditor
    ? Math.max(
        14,
        (textEditor.height
          ? textEditor.height * 0.8 * (textEditor.scaleY || 1)
          : textEditor.strokeWidth * 5) *
          (renderedSize.height / Math.max(1, imageSize.height)),
      )
    : 14;
  const textEditorLeft = textEditor
    ? (textEditor.x / Math.max(1, imageSize.width)) * renderedSize.width
    : 0;
  const textEditorWidth = textEditor
    ? Math.max(
        64,
        Math.min(
          Math.max(64, renderedSize.width - textEditorLeft - 8),
          estimateTextWidth(textEditor.value, textEditorFontSize) *
            ((textEditor.scaleX || 1) / (textEditor.scaleY || 1)) +
            16,
        ),
      )
    : 64;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const next = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      setContainerSize(next);
      onCanvasSizeChange(next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [onCanvasSizeChange]);

  React.useEffect(() => {
    setImageSize({ width: 0, height: 0 });
    setAnnotationSnapshot(null);
    setTextEditor(null);
  }, [image.id]);

  React.useEffect(() => {
    if (!textEditorSessionId) return;
    const frame = window.requestAnimationFrame(() => {
      const input = textInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(textCaretRef.current, textCaretRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [textEditorSessionId]);

  const stopMagnifier = React.useCallback(() => {
    if (magnifierTimerRef.current) clearTimeout(magnifierTimerRef.current);
    magnifierTimerRef.current = null;
    magnifierPointerRef.current = null;
    magnifierVisibleRef.current = false;
    setMagnifierPosition(null);
    onMagnifierChange(null);
  }, [onMagnifierChange]);

  React.useEffect(() => {
    if (activeTool !== "magnifier") stopMagnifier();
    return stopMagnifier;
  }, [activeTool, stopMagnifier]);

  const getMagnifierPosition = React.useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    const surface = imageSurfaceRef.current;
    if (!container || !surface) return null;
    const containerRect = container.getBoundingClientRect();
    const imageRect = surface.getBoundingClientRect();
    if (
      clientX < imageRect.left ||
      clientX > imageRect.right ||
      clientY < imageRect.top ||
      clientY > imageRect.bottom
    ) {
      return null;
    }
    return {
      pointerX: clientX - containerRect.left,
      pointerY: clientY - containerRect.top,
      sourceX: clientX - imageRect.left,
      sourceY: clientY - imageRect.top,
      sourceWidth: imageRect.width,
      sourceHeight: imageRect.height,
    };
  }, []);

  React.useEffect(() => {
    if (!remoteMagnifier) {
      setRemoteMagnifierPosition(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const surface = imageSurfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      setRemoteMagnifierPosition(
        getMagnifierPosition(
          rect.left + remoteMagnifier.x * rect.width,
          rect.top + remoteMagnifier.y * rect.height,
        ),
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    containerSize,
    getMagnifierPosition,
    offset,
    remoteMagnifier,
    renderedSize.height,
    renderedSize.width,
    scale,
  ]);

  const publishMagnifierPosition = React.useCallback(
    (position: MagnifierPosition) => {
      onMagnifierChange({
        x: Math.max(0, Math.min(1, position.sourceX / position.sourceWidth)),
        y: Math.max(0, Math.min(1, position.sourceY / position.sourceHeight)),
      });
    },
    [onMagnifierChange],
  );

  const finishTextEditing = React.useCallback(
    (commit: boolean) => {
      const current = textEditorRef.current;
      textEditorRef.current = null;
      setTextEditor(null);
      const value = current?.value.trim();
      if (!commit || !current || !value) return;
      if (current.before) {
        const fontSize = Math.max(12, current.before.height * 0.8);
        onUpdate(current.before, {
          ...current.before,
          text: value,
          width: Math.max(fontSize * 1.5, estimateTextWidth(value, fontSize)),
        });
        return;
      }
      const fontSize = Math.max(12, current.strokeWidth * 5);
      onCreate({
        id: crypto.randomUUID().replace(/-/g, ""),
        type: "text",
        x: current.x,
        y: current.y,
        width: Math.max(fontSize * 1.5, estimateTextWidth(value, fontSize)),
        height: fontSize * 1.35,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        text: value,
        stroke: current.color,
        strokeWidth: current.strokeWidth,
        createdBy: actorId,
      });
    },
    [actorId, onCreate, onUpdate],
  );

  return (
    <div
      ref={containerRef}
      className={`relative min-h-0 min-w-0 w-full flex-1 touch-none overflow-hidden bg-[#dfe5ec] [background-image:linear-gradient(45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,.28)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,.28)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px] ${
        interactionDisabled
          ? "cursor-default"
          : activeTool === "select"
            ? "cursor-default"
            : activeTool === "hand"
              ? "cursor-grab active:cursor-grabbing"
              : activeTool === "magnifier"
                ? "cursor-zoom-in"
            : activeTool === "text"
              ? "cursor-text"
            : "cursor-crosshair"
      }`}
      onWheel={(event) => {
        if (interactionDisabled) return;
        if (activeTool === "magnifier") {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const normalizedDelta = Math.max(-80, Math.min(80, event.deltaY));
        const zoomFactor = Math.exp(-normalizedDelta * WHEEL_ZOOM_SENSITIVITY);
        onScaleChange(Math.min(4, Math.max(0.25, scale * zoomFactor)));
      }}
      onPointerDown={(event) => {
        if (
          activeTool === "magnifier" &&
          !interactionDisabled &&
          event.button === 0
        ) {
          const position = getMagnifierPosition(event.clientX, event.clientY);
          if (!position) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          magnifierPointerRef.current = { pointerId: event.pointerId, position };
          if (magnifierTimerRef.current) clearTimeout(magnifierTimerRef.current);
          magnifierTimerRef.current = setTimeout(() => {
            const current = magnifierPointerRef.current;
            if (!current) return;
            magnifierVisibleRef.current = true;
            setMagnifierPosition(current.position);
            publishMagnifierPosition(current.position);
          }, 180);
          return;
        }
        if (
          activeTool !== "hand" ||
          interactionDisabled ||
          event.button !== 0
        ) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          originX: offset.x,
          originY: offset.y,
        };
      }}
      onPointerMove={(event) => {
        const magnifier = magnifierPointerRef.current;
        if (magnifier?.pointerId === event.pointerId) {
          const position = getMagnifierPosition(event.clientX, event.clientY);
          if (position) {
            magnifier.position = position;
            if (magnifierVisibleRef.current) {
              setMagnifierPosition(position);
              publishMagnifierPosition(position);
            }
          }
          return;
        }
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onOffsetChange({
          x: drag.originX + event.clientX - drag.x,
          y: drag.originY + event.clientY - drag.y,
        });
      }}
      onPointerUp={(event) => {
        if (magnifierPointerRef.current?.pointerId === event.pointerId) {
          stopMagnifier();
          return;
        }
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
      onPointerCancel={() => {
        stopMagnifier();
        dragRef.current = null;
      }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center will-change-transform"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
        }}
      >
        <div
          ref={imageSurfaceRef}
          className="relative shadow-2xl"
          style={{
            width: renderedSize.width,
            height: renderedSize.height,
            visibility: fitRatio ? "visible" : "hidden",
          }}
        >
          {/* Blob URLs are local browser assets and cannot use the Next image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.name}
            draggable={false}
            onLoad={(event) => {
              const dimensions = {
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              };
              setImageSize(dimensions);
              onDimensionsChange(dimensions);
            }}
            className="block h-full w-full select-none object-contain"
          />
          {fitRatio ? (
            <div
              className={`absolute inset-0 ${interactionDisabled ? "pointer-events-none" : ""}`}
              data-layer="annotations"
            >
              <ReviewAnnotationLayer
                width={renderedSize.width}
                height={renderedSize.height}
                viewportScale={scale}
                imageWidth={imageSize.width}
                imageHeight={imageSize.height}
                annotations={annotations}
                activeTool={activeTool}
                selectedIds={selectedIds}
                actorId={actorId}
                defaultColor={defaultColor}
                defaultFill={defaultFill}
                defaultStrokeRatio={defaultStrokeRatio}
                arrowStyle={arrowStyle}
                lineStyle={lineStyle}
                onSelect={onSelect}
                onTextRequest={({ x, y, strokeWidth }) => {
                  textCaretRef.current = 0;
                  setTextEditor({
                    sessionId: crypto.randomUUID(),
                    x,
                    y,
                    strokeWidth,
                    value: "",
                    color: defaultColor,
                  });
                }}
                onTextEditRequest={(annotation, caretIndex) => {
                  textCaretRef.current = caretIndex;
                  setTextEditor({
                    sessionId: crypto.randomUUID(),
                    x: annotation.x,
                    y: annotation.y,
                    strokeWidth: annotation.strokeWidth,
                    value: annotation.text || "",
                    color: annotation.stroke,
                    width: annotation.width,
                    height: annotation.height,
                    scaleX: annotation.scaleX,
                    scaleY: annotation.scaleY,
                    rotation: annotation.rotation,
                    before: annotation,
                  });
                }}
                onSnapshotChange={setAnnotationSnapshot}
                onCreate={onCreate}
                onUpdate={onUpdate}
              />
            </div>
          ) : null}
          {textEditor && fitRatio ? (
            <textarea
              ref={textInputRef}
              value={textEditor.value}
              rows={1}
              aria-label="Text annotation"
              className="absolute z-20 min-h-8 resize-none overflow-hidden border-0 bg-white/90 px-1.5 py-1 text-slate-950 shadow-lg outline-none ring-2 ring-blue-500"
              style={{
                left: `${(textEditor.x / Math.max(1, imageSize.width)) * 100}%`,
                top: `${(textEditor.y / Math.max(1, imageSize.height)) * 100}%`,
                width: textEditorWidth,
                height: textEditor.height
                  ? Math.max(
                      32,
                      textEditor.height *
                        (textEditor.scaleY || 1) *
                        (renderedSize.height / Math.max(1, imageSize.height)),
                    )
                  : undefined,
                fontSize: textEditorFontSize,
                color: textEditor.color,
                transform: `rotate(${textEditor.rotation || 0}deg)`,
                transformOrigin: "top left",
              }}
              onChange={(event) =>
                setTextEditor((current) =>
                  current ? { ...current, value: event.target.value } : null,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  finishTextEditing(false);
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  finishTextEditing(true);
                }
              }}
              onBlur={() => finishTextEditing(true)}
            />
          ) : null}
          <div className="pointer-events-none absolute inset-0" data-layer="pointers" />
        </div>
      </div>
      {magnifierPosition || remoteMagnifierPosition ? (
        <ReviewMagnifierLens
          imageUrl={image.url}
          annotationSnapshot={annotationSnapshot}
          position={(magnifierPosition || remoteMagnifierPosition)!}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          dimBackground={Boolean(
            remoteMagnifierPosition &&
              remoteMagnifier?.highlight &&
              !magnifierPosition,
          )}
        />
      ) : null}
    </div>
  );
}
