"use client";

import React from "react";
import Konva from "konva";
import type { NormalizedCrop } from "../../../utils/room-image-editing";

type KonvaCropEditorProps = {
  imageUrl: string;
  posterUrl?: string | null;
  editorBaseReady?: boolean;
  aspect: number | null;
  initialCrop?: NormalizedCrop;
  onCropChange(crop: NormalizedCrop): void;
};

const PADDING = 18;

export default function KonvaCropEditor({
  imageUrl,
  posterUrl,
  editorBaseReady = true,
  aspect,
  initialCrop,
  onCropChange,
}: KonvaCropEditorProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const onCropChangeRef = React.useRef(onCropChange);
  const [renderedImageUrl, setRenderedImageUrl] = React.useState("");
  onCropChangeRef.current = onCropChange;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let stage: Konva.Stage | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const image = new Image();

    const mount = () => {
      if (disposed || !image.naturalWidth || !image.naturalHeight) return;
      const rect = container.getBoundingClientRect();
      const stageWidth = Math.max(280, rect.width);
      const stageHeight = Math.max(280, rect.height);
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const availableWidth = stageWidth - PADDING * 2;
      const availableHeight = stageHeight - PADDING * 2;
      let displayWidth = availableWidth;
      let displayHeight = displayWidth / sourceRatio;
      if (displayHeight > availableHeight) {
        displayHeight = availableHeight;
        displayWidth = displayHeight * sourceRatio;
      }
      const imageX = (stageWidth - displayWidth) / 2;
      const imageY = (stageHeight - displayHeight) / 2;
      const selectedRatio = aspect ? aspect / sourceRatio : null;
      const initialWidth = initialCrop
        ? displayWidth * initialCrop.width
        : selectedRatio && selectedRatio < 1 ? displayWidth * 0.82 * selectedRatio : displayWidth * 0.82;
      const initialHeight = initialCrop
        ? displayHeight * initialCrop.height
        : selectedRatio && selectedRatio >= 1 ? displayHeight * 0.82 / selectedRatio : displayHeight * 0.82;

      stage?.destroy();
      container.replaceChildren();
      stage = new Konva.Stage({ container, width: stageWidth, height: stageHeight });
      const layer = new Konva.Layer();
      stage.add(layer);
      layer.add(new Konva.Image({ x: imageX, y: imageY, width: displayWidth, height: displayHeight, image }));

      const shades = Array.from({ length: 4 }, () => new Konva.Rect({ fill: "rgba(2, 6, 23, 0.62)", listening: false }));
      shades.forEach((shade) => layer.add(shade));
      const cropRect = new Konva.Rect({
        x: imageX + (initialCrop ? displayWidth * initialCrop.x : (displayWidth - initialWidth) / 2),
        y: imageY + (initialCrop ? displayHeight * initialCrop.y : (displayHeight - initialHeight) / 2),
        width: initialWidth,
        height: initialHeight,
        stroke: "#ffffff",
        strokeWidth: 2,
        draggable: true,
      });
      cropRect.dragBoundFunc((position) => ({
        x: Math.max(imageX, Math.min(imageX + displayWidth - cropRect.width(), position.x)),
        y: Math.max(imageY, Math.min(imageY + displayHeight - cropRect.height(), position.y)),
      }));
      layer.add(cropRect);
      const transformer = new Konva.Transformer({
        nodes: [cropRect],
        rotateEnabled: false,
        flipEnabled: false,
        ignoreStroke: true,
        keepRatio: Boolean(aspect),
        enabledAnchors: aspect
          ? ["top-left", "top-right", "bottom-left", "bottom-right"]
          : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"],
        anchorSize: 10,
        anchorCornerRadius: 2,
        anchorFill: "#ffffff",
        anchorStroke: "#2f65cf",
        anchorStrokeWidth: 2,
        borderStroke: "#ffffff",
        borderStrokeWidth: 1,
        boundBoxFunc(oldBox, nextBox) {
          if (nextBox.width < 24 || nextBox.height < 24) return oldBox;
          if (nextBox.x < imageX || nextBox.y < imageY || nextBox.x + nextBox.width > imageX + displayWidth || nextBox.y + nextBox.height > imageY + displayHeight) return oldBox;
          return nextBox;
        },
      });
      layer.add(transformer);

      const update = () => {
        const x = cropRect.x();
        const y = cropRect.y();
        const width = cropRect.width() * cropRect.scaleX();
        const height = cropRect.height() * cropRect.scaleY();
        shades[0].setAttrs({ x: imageX, y: imageY, width: displayWidth, height: Math.max(0, y - imageY) });
        shades[1].setAttrs({ x: imageX, y, width: Math.max(0, x - imageX), height });
        shades[2].setAttrs({ x: x + width, y, width: Math.max(0, imageX + displayWidth - x - width), height });
        shades[3].setAttrs({ x: imageX, y: y + height, width: displayWidth, height: Math.max(0, imageY + displayHeight - y - height) });
        onCropChangeRef.current({
          x: (x - imageX) / displayWidth,
          y: (y - imageY) / displayHeight,
          width: width / displayWidth,
          height: height / displayHeight,
        });
        layer.batchDraw();
      };
      cropRect.on("dragmove", update);
      cropRect.on("transform", update);
      cropRect.on("transformend", () => {
        const nextWidth = cropRect.width() * cropRect.scaleX();
        const nextHeight = cropRect.height() * cropRect.scaleY();
        cropRect.scale({ x: 1, y: 1 });
        cropRect.size({ width: nextWidth, height: nextHeight });
        update();
      });
      cropRect.on("dragend", update);
      update();
      setRenderedImageUrl(imageUrl);
    };

    image.onload = mount;
    image.src = imageUrl;
    resizeObserver = new ResizeObserver(mount);
    resizeObserver.observe(container);
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      stage?.destroy();
    };
  }, [aspect, imageUrl, initialCrop]);

  return <div className="relative h-[min(52vh,430px)] min-h-72 w-full overflow-hidden rounded-md bg-slate-900"><div ref={containerRef} className="h-full w-full" />{posterUrl && (!editorBaseReady || renderedImageUrl !== imageUrl) ? <img src={posterUrl} alt="" className="absolute inset-0 z-20 h-full w-full cursor-wait select-none object-contain" aria-hidden="true" /> : null}</div>;
}
