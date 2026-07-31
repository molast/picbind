"use client";

import React from "react";
import {
  applyRoomColorAdjustments,
  type RoomColorAdjustments,
} from "../../../utils/room-color-adjustments";

export type ColorComparisonMode = "stacked" | "in-place" | "split";

type ColorAdjustmentPreviewProps = {
  imageUrl: string;
  adjustments: RoomColorAdjustments;
  mode: ColorComparisonMode;
  samplingEnabled: boolean;
  onSample(color: string): void;
};

function channelHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0");
}

export default function ColorAdjustmentPreview({ imageUrl, adjustments, mode, samplingEnabled, onSample }: ColorAdjustmentPreviewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const originalCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const editedCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sourceRef = React.useRef<ImageData | null>(null);
  const draggingRef = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [split, setSplit] = React.useState(50);

  React.useEffect(() => {
    setShowOriginal(false);
    setSplit(50);
  }, [mode]);

  React.useEffect(() => {
    const originalCanvas = originalCanvasRef.current;
    const editedCanvas = editedCanvasRef.current;
    if (!originalCanvas || !editedCanvas) return;
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      const scale = Math.min(1, 720 / image.naturalWidth, 420 / image.naturalHeight);
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      for (const canvas of [originalCanvas, editedCanvas]) {
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d", { willReadFrequently: true })?.drawImage(image, 0, 0, width, height);
      }
      const context = originalCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      sourceRef.current = context.getImageData(0, 0, width, height);
      setReady(true);
    };
    image.src = imageUrl;
    return () => { disposed = true; sourceRef.current = null; setReady(false); };
  }, [imageUrl, mode]);

  React.useEffect(() => {
    const canvas = editedCanvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source || !ready) return;
    const frame = requestAnimationFrame(() => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const pixels = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
      context.putImageData(applyRoomColorAdjustments(pixels, adjustments), 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [adjustments, mode, ready]);

  const sampleColor = (clientX: number, clientY: number) => {
    const canvas = originalCanvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
    const x = Math.max(0, Math.min(source.width - 1, Math.floor((clientX - rect.left) / rect.width * source.width)));
    const y = Math.max(0, Math.min(source.height - 1, Math.floor((clientY - rect.top) / rect.height * source.height)));
    const index = (y * source.width + x) * 4;
    onSample(`#${channelHex(source.data[index])}${channelHex(source.data[index + 1])}${channelHex(source.data[index + 2])}`);
  };

  const updateSplit = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.max(5, Math.min(95, (clientX - rect.left) / rect.width * 100)));
  };

  const canvasClass = "block max-h-full max-w-full select-none object-contain";
  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-72 w-full overflow-hidden rounded-md bg-slate-900 ${samplingEnabled ? "cursor-crosshair" : mode === "in-place" ? "cursor-pointer" : ""}`}
      title={samplingEnabled ? "取样替换颜色" : mode === "in-place" ? "切换原图与调整结果" : undefined}
      onClick={(event) => {
        if (samplingEnabled) sampleColor(event.clientX, event.clientY);
        else if (mode === "in-place") setShowOriginal((value) => !value);
      }}
      onPointerMove={(event) => {
        if (mode === "split" && draggingRef.current) updateSplit(event.clientX);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { draggingRef.current = false; }}
    >
      {mode === "stacked" ? (
        <div className="grid h-full grid-rows-2 gap-px bg-slate-700">
          <div className="flex min-h-0 items-center justify-center bg-slate-900 p-2"><canvas ref={originalCanvasRef} className={canvasClass} /></div>
          <div className="flex min-h-0 items-center justify-center bg-slate-900 p-2"><canvas ref={editedCanvasRef} className={canvasClass} /></div>
        </div>
      ) : (
        <>
          <div className="absolute inset-0 flex items-center justify-center p-3"><canvas ref={editedCanvasRef} className={`${canvasClass} ${mode === "in-place" && showOriginal ? "invisible" : ""}`} /></div>
          <div className={`absolute inset-0 flex items-center justify-center p-3 ${mode === "in-place" && !showOriginal ? "invisible" : ""}`} style={mode === "split" ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined}><canvas ref={originalCanvasRef} className={canvasClass} /></div>
          {mode === "split" ? (
            <button
              type="button"
              className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgba(15,23,42,.35)]"
              style={{ left: `${split}%` }}
              aria-label="拖动对比分割线"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation();
                draggingRef.current = true;
                event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
                updateSplit(event.clientX);
              }}
            >
              <span className="absolute left-1/2 top-1/2 flex h-9 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-slate-900/75 shadow"><span className="h-4 border-l border-r border-white/90 px-0.5" /></span>
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
