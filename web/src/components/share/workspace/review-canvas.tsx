"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { RoomImage } from "../share-room-types";
import type {
  ReviewAnnotation,
  ReviewTool,
} from "@/utils/review-collaboration";

const ReviewAnnotationLayer = dynamic(
  () => import("./review-annotation-layer"),
  { ssr: false },
);

export type ReviewViewportOffset = { x: number; y: number };

type ReviewCanvasProps = {
  image: RoomImage;
  scale: number;
  offset: ReviewViewportOffset;
  activeTool: ReviewTool;
  annotations: ReviewAnnotation[];
  selectedId: string | null;
  actorId: string;
  onScaleChange(scale: number): void;
  onOffsetChange(offset: ReviewViewportOffset): void;
  onDimensionsChange(dimensions: { width: number; height: number }): void;
  onCanvasSizeChange(dimensions: { width: number; height: number }): void;
  onSelect(id: string | null): void;
  onCreate(annotation: ReviewAnnotation): void;
  onUpdate(before: ReviewAnnotation, after: ReviewAnnotation): void;
};

export default function ReviewCanvas({
  image,
  scale,
  offset,
  activeTool,
  annotations,
  selectedId,
  actorId,
  onScaleChange,
  onOffsetChange,
  onDimensionsChange,
  onCanvasSizeChange,
  onSelect,
  onCreate,
  onUpdate,
}: ReviewCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [containerSize, setContainerSize] = React.useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const fitRatio =
    containerSize.width && containerSize.height && imageSize.width && imageSize.height
      ? Math.min(
          (containerSize.width * 0.88) / imageSize.width,
          (containerSize.height * 0.88) / imageSize.height,
        )
      : 0;
  const renderedSize = {
    width: Math.max(1, Math.round(imageSize.width * fitRatio)),
    height: Math.max(1, Math.round(imageSize.height * fitRatio)),
  };

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
  }, [image.id]);

  return (
    <div
      ref={containerRef}
      className={`relative min-h-0 flex-1 touch-none overflow-hidden bg-[#dfe5ec] [background-image:linear-gradient(45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,.28)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,.28)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px] ${
        activeTool === "select" ? "cursor-grab" : "cursor-crosshair"
      }`}
      onWheel={(event) => {
        event.preventDefault();
        const direction = event.deltaY > 0 ? -0.1 : 0.1;
        onScaleChange(Math.min(4, Math.max(0.25, scale + direction)));
      }}
      onPointerDown={(event) => {
        if (
          activeTool !== "select" ||
          event.button !== 0 ||
          event.target instanceof HTMLCanvasElement
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
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onOffsetChange({
          x: drag.originX + event.clientX - drag.x,
          y: drag.originY + event.clientY - drag.y,
        });
      }}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
      onPointerCancel={() => {
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
            <div className="absolute inset-0" data-layer="annotations">
              <ReviewAnnotationLayer
                width={renderedSize.width}
                height={renderedSize.height}
                imageWidth={imageSize.width}
                imageHeight={imageSize.height}
                annotations={annotations}
                activeTool={activeTool}
                selectedId={selectedId}
                actorId={actorId}
                onSelect={onSelect}
                onCreate={onCreate}
                onUpdate={onUpdate}
              />
            </div>
          ) : null}
          <div className="pointer-events-none absolute inset-0" data-layer="pointers" />
        </div>
      </div>
    </div>
  );
}
