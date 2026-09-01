"use client";

import React from "react";
import Konva from "konva";
import {
  type WorkspaceColorAdjustments,
} from "../../../utils/workspace-color-adjustments";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";
import {
  createColorPreviewRenderer,
  type ColorPreviewRenderer,
} from "./color-preview-renderer";

export type ColorComparisonMode = "stacked" | "in-place" | "split";

type ColorAdjustmentPreviewProps = {
  imageUrl: string;
  adjustments: WorkspaceColorAdjustments;
  labels: WorkspaceEditorLabels;
  mode: ColorComparisonMode;
  posterUrl?: string | null;
  editorBaseReady?: boolean;
  interacting?: boolean;
  samplingEnabled: boolean;
  onSample(color: string): void;
};

type ImageBounds = { x: number; y: number; width: number; height: number };
type SplitGuide = { left: number; top: number; height: number };

const PREVIEW_MAX_WIDTH = 720;
const PREVIEW_MAX_HEIGHT = 420;
const PADDING = 12;

function channelHex(value: number) {
  return Math.round(value).toString(16).padStart(2, "0");
}

function fitBounds(
  sourceWidth: number,
  sourceHeight: number,
  viewport: ImageBounds,
): ImageBounds {
  const scale = Math.min(
    viewport.width / Math.max(1, sourceWidth),
    viewport.height / Math.max(1, sourceHeight),
  );
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height,
  };
}

export default function ColorAdjustmentPreview({ imageUrl, adjustments, labels, mode, posterUrl, editorBaseReady = true, interacting = false, samplingEnabled, onSample }: ColorAdjustmentPreviewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<Konva.Stage | null>(null);
  const layerRef = React.useRef<Konva.Layer | null>(null);
  const originalNodeRef = React.useRef<Konva.Image | null>(null);
  const editedNodeRef = React.useRef<Konva.Image | null>(null);
  const originalGroupRef = React.useRef<Konva.Group | null>(null);
  const rendererRef = React.useRef<ColorPreviewRenderer | null>(null);
  const sourceRef = React.useRef<ImageData | null>(null);
  const editedRenderSizeRef = React.useRef({ width: 1, height: 1 });
  const imageBoundsRef = React.useRef<ImageBounds | null>(null);
  const adjustmentsRef = React.useRef(adjustments);
  const interactingRef = React.useRef(interacting);
  const modeRef = React.useRef(mode);
  const presentationRef = React.useRef<(immediate?: boolean) => void>(() => undefined);
  const renderPreviewRef = React.useRef<() => void>(() => undefined);
  const draggingRef = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [renderedImageUrl, setRenderedImageUrl] = React.useState("");
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [split, setSplit] = React.useState(50);
  const [splitGuide, setSplitGuide] = React.useState<SplitGuide | null>(null);
  const showOriginalRef = React.useRef(showOriginal);
  const splitRef = React.useRef(split);
  adjustmentsRef.current = adjustments;
  interactingRef.current = interacting;
  modeRef.current = mode;
  showOriginalRef.current = showOriginal;
  splitRef.current = split;

  React.useEffect(() => {
    setShowOriginal(false);
    setSplit(50);
  }, [mode]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const image = new Image();

    image.onload = () => {
      if (disposed || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.min(
        1,
        PREVIEW_MAX_WIDTH / image.naturalWidth,
        PREVIEW_MAX_HEIGHT / image.naturalHeight,
      );
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const originalSurface = document.createElement("canvas");
      originalSurface.width = width;
      originalSurface.height = height;
      const originalContext = originalSurface.getContext("2d", { willReadFrequently: true });
      if (!originalContext) return;
      originalContext.drawImage(image, 0, 0, width, height);
      const source = originalContext.getImageData(0, 0, width, height);
      const renderer = createColorPreviewRenderer(originalSurface);
      const initialRender = renderer.render(
        adjustmentsRef.current,
        interactingRef.current ? "interactive" : "settled",
      );
      editedRenderSizeRef.current = initialRender;

      container.replaceChildren();
      const stage = new Konva.Stage({ container, width: 1, height: 1 });
      const layer = new Konva.Layer();
      const editedNode = new Konva.Image({
        image: renderer.canvas,
        width: initialRender.width,
        height: initialRender.height,
        listening: false,
      });
      const originalNode = new Konva.Image({
        image: originalSurface,
        width,
        height,
        listening: false,
      });
      const originalGroup = new Konva.Group({ listening: false });
      originalGroup.add(originalNode);
      layer.add(editedNode);
      layer.add(originalGroup);
      stage.add(layer);
      stageRef.current = stage;
      layerRef.current = layer;
      editedNodeRef.current = editedNode;
      originalNodeRef.current = originalNode;
      originalGroupRef.current = originalGroup;
      rendererRef.current = renderer;
      sourceRef.current = source;

      const updatePresentation = (immediate = false) => {
        if (disposed) return;
        const rect = container.getBoundingClientRect();
        const stageWidth = Math.max(280, rect.width);
        const stageHeight = Math.max(280, rect.height);
        stage.size({ width: stageWidth, height: stageHeight });
        const currentMode = modeRef.current;
        const editedSize = editedRenderSizeRef.current;
        if (currentMode === "stacked") {
          const gap = 1;
          const paneHeight = (stageHeight - gap) / 2;
          const originalBounds = fitBounds(width, height, {
            x: PADDING,
            y: PADDING,
            width: stageWidth - PADDING * 2,
            height: paneHeight - PADDING * 2,
          });
          const editedBounds = fitBounds(width, height, {
            x: PADDING,
            y: paneHeight + gap + PADDING,
            width: stageWidth - PADDING * 2,
            height: paneHeight - PADDING * 2,
          });
          originalNode.setAttrs({
            x: originalBounds.x,
            y: originalBounds.y,
            scaleX: originalBounds.width / width,
            scaleY: originalBounds.height / height,
          });
          editedNode.setAttrs({
            x: editedBounds.x,
            y: editedBounds.y,
            width: editedSize.width,
            height: editedSize.height,
            scaleX: editedBounds.width / editedSize.width,
            scaleY: editedBounds.height / editedSize.height,
          });
          originalGroup.visible(true);
          originalGroup.clip({ x: 0, y: 0, width: stageWidth, height: stageHeight });
          imageBoundsRef.current = originalBounds;
          setSplitGuide(null);
        } else {
          const bounds = fitBounds(width, height, {
            x: PADDING,
            y: PADDING,
            width: stageWidth - PADDING * 2,
            height: stageHeight - PADDING * 2,
          });
          const imageAttrs = {
            x: bounds.x,
            y: bounds.y,
            scaleX: bounds.width / width,
            scaleY: bounds.height / height,
          };
          originalNode.setAttrs(imageAttrs);
          editedNode.setAttrs({
            x: imageAttrs.x,
            y: imageAttrs.y,
            width: editedSize.width,
            height: editedSize.height,
            scaleX: bounds.width / editedSize.width,
            scaleY: bounds.height / editedSize.height,
          });
          originalGroup.visible(currentMode === "split" || showOriginalRef.current);
          originalGroup.clip(currentMode === "split"
            ? { x: bounds.x, y: bounds.y, width: bounds.width * splitRef.current / 100, height: bounds.height }
            : { x: 0, y: 0, width: stageWidth, height: stageHeight });
          imageBoundsRef.current = bounds;
          setSplitGuide(currentMode === "split" ? {
            left: bounds.x + bounds.width * splitRef.current / 100,
            top: bounds.y,
            height: bounds.height,
          } : null);
        }
        if (immediate) layer.draw();
        else layer.batchDraw();
      };
      presentationRef.current = updatePresentation;
      renderPreviewRef.current = () => {
        const currentRenderer = rendererRef.current;
        if (!currentRenderer || disposed) return;
        const result = currentRenderer.render(
          adjustmentsRef.current,
          interactingRef.current ? "interactive" : "settled",
        );
        editedRenderSizeRef.current = result;
        if (result.resized) updatePresentation(true);
        else layer.draw();
      };
      updatePresentation(true);
      resizeObserver = new ResizeObserver(() => updatePresentation());
      resizeObserver.observe(container);
      setReady(true);
      setRenderedImageUrl(imageUrl);
    };
    image.src = imageUrl;
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      stageRef.current?.destroy();
      rendererRef.current?.dispose();
      stageRef.current = null;
      layerRef.current = null;
      originalNodeRef.current = null;
      editedNodeRef.current = null;
      originalGroupRef.current = null;
      rendererRef.current = null;
      sourceRef.current = null;
      imageBoundsRef.current = null;
      presentationRef.current = () => undefined;
      renderPreviewRef.current = () => undefined;
      setReady(false);
    };
  }, [imageUrl]);

  React.useLayoutEffect(() => {
    presentationRef.current();
  }, [mode, ready, showOriginal, split]);

  React.useLayoutEffect(() => {
    if (ready) renderPreviewRef.current();
  }, [adjustments, interacting, ready]);

  const sampleColor = (clientX: number, clientY: number) => {
    const source = sourceRef.current;
    const bounds = imageBoundsRef.current;
    const container = containerRef.current;
    if (!source || !bounds || !container) return;
    const rect = container.getBoundingClientRect();
    const xInStage = clientX - rect.left;
    const yInStage = clientY - rect.top;
    if (xInStage < bounds.x || xInStage > bounds.x + bounds.width || yInStage < bounds.y || yInStage > bounds.y + bounds.height) return;
    const x = Math.max(0, Math.min(source.width - 1, Math.floor((xInStage - bounds.x) / bounds.width * source.width)));
    const y = Math.max(0, Math.min(source.height - 1, Math.floor((yInStage - bounds.y) / bounds.height * source.height)));
    const index = (y * source.width + x) * 4;
    onSample(`#${channelHex(source.data[index])}${channelHex(source.data[index + 1])}${channelHex(source.data[index + 2])}`);
  };

  const updateSplit = (clientX: number) => {
    const container = containerRef.current;
    const bounds = imageBoundsRef.current;
    if (!container || !bounds) return;
    const rect = container.getBoundingClientRect();
    const xInStage = clientX - rect.left;
    setSplit(Math.max(5, Math.min(95, (xInStage - bounds.x) / bounds.width * 100)));
  };

  return (
    <div
      className={`relative h-full min-h-72 w-full overflow-hidden rounded-md bg-slate-900 ${samplingEnabled ? "cursor-crosshair" : mode === "in-place" ? "cursor-pointer" : ""}`}
      title={samplingEnabled ? labels.colorTools.sampleReplacement : mode === "in-place" ? labels.colorTools.toggleOriginal : undefined}
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
      <div ref={containerRef} className="h-full w-full" />
      {mode === "split" && splitGuide ? (
        <button
          type="button"
          className="absolute z-10 w-0.5 -translate-x-1/2 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgba(15,23,42,.35)]"
          style={{ left: splitGuide.left, top: splitGuide.top, height: splitGuide.height }}
          aria-label={labels.colorTools.dragDivider}
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
      {posterUrl && (!editorBaseReady || !ready || renderedImageUrl !== imageUrl) ? <img src={posterUrl} alt="" className="pointer-events-none absolute inset-0 z-20 h-full w-full select-none object-contain p-3" aria-hidden="true" /> : null}
    </div>
  );
}
