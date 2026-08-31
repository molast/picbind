"use client";

import React from "react";
import Konva from "konva";

type KonvaResizePreviewProps = {
  imageUrl: string;
  posterUrl?: string | null;
  editorBaseReady?: boolean;
  targetWidth: number;
  targetHeight: number;
};

const PADDING = 10;

export default function KonvaResizePreview({ imageUrl, posterUrl, editorBaseReady = true, targetWidth, targetHeight }: KonvaResizePreviewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const imageNodeRef = React.useRef<Konva.Image | null>(null);
  const layerRef = React.useRef<Konva.Layer | null>(null);
  const targetRef = React.useRef({ width: targetWidth, height: targetHeight });
  const layoutRef = React.useRef<() => void>(() => undefined);
  const [renderedImageUrl, setRenderedImageUrl] = React.useState("");
  targetRef.current = { width: targetWidth, height: targetHeight };

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const image = new Image();

    image.onload = () => {
      if (disposed || !image.naturalWidth || !image.naturalHeight) return;
      container.replaceChildren();
      const stage = new Konva.Stage({ container, width: 1, height: 1 });
      const layer = new Konva.Layer();
      const imageNode = new Konva.Image({ image, listening: false });
      layer.add(imageNode);
      stage.add(layer);
      imageNodeRef.current = imageNode;
      layerRef.current = layer;

      const layout = () => {
        if (disposed) return;
        const rect = container.getBoundingClientRect();
        const width = Math.max(240, rect.width);
        const height = Math.max(144, rect.height);
        stage.size({ width, height });
        const target = targetRef.current;
        const ratio = Number.isFinite(target.width) && Number.isFinite(target.height)
          && target.width > 0 && target.height > 0
          ? target.width / target.height
          : image.naturalWidth / image.naturalHeight;
        const availableWidth = width - PADDING * 2;
        const availableHeight = height - PADDING * 2;
        let displayWidth = availableWidth;
        let displayHeight = displayWidth / ratio;
        if (displayHeight > availableHeight) {
          displayHeight = availableHeight;
          displayWidth = displayHeight * ratio;
        }
        imageNode.setAttrs({
          x: (width - displayWidth) / 2,
          y: (height - displayHeight) / 2,
          width: displayWidth,
          height: displayHeight,
        });
        layer.batchDraw();
      };
      layoutRef.current = layout;
      layout();
      observer = new ResizeObserver(layout);
      observer.observe(container);
      setRenderedImageUrl(imageUrl);
    };
    image.src = imageUrl;
    return () => {
      disposed = true;
      observer?.disconnect();
      imageNodeRef.current?.getStage()?.destroy();
      imageNodeRef.current = null;
      layerRef.current = null;
      layoutRef.current = () => undefined;
    };
  }, [imageUrl]);

  React.useEffect(() => {
    layoutRef.current();
  }, [targetHeight, targetWidth]);

  return (
    <div className="relative h-36 overflow-hidden rounded-md bg-slate-100">
      <div ref={containerRef} className="h-full w-full" />
      {posterUrl && (!editorBaseReady || renderedImageUrl !== imageUrl) ? <img src={posterUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" aria-hidden="true" /> : null}
    </div>
  );
}
