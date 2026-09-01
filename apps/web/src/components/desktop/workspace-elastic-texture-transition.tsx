"use client";

import React from "react";
import { snapdom } from "@zumer/snapdom";

export type WorkspaceElasticTransitionPhase = "out" | "in";

type TransitionImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

type WorkspaceElasticTextureTransitionProps = {
  bitmap: TransitionImage;
  phase: WorkspaceElasticTransitionPhase;
  onComplete(): void;
};

const OUT_DURATION = 520;
const IN_DURATION = 560;

type Rectangle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOut(value: number) {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function transitionProgress(value: number) {
  return easeOut(value);
}

function transitionImageSize(image: TransitionImage) {
  return image instanceof HTMLImageElement
    ? { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
    : { width: image.width, height: image.height };
}

function getDockRectangle(width: number, height: number, density: number): Rectangle {
  const cssWidth = width / density;
  const cssHeight = height / density;
  const dock = document.querySelector<HTMLElement>("[data-picbind-workspace-dock='true']");
  if (dock) {
    const rect = dock.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return {
        left: rect.left * density,
        top: rect.top * density,
        right: rect.right * density,
        bottom: rect.bottom * density,
      };
    }
  }

  const horizontalPadding = cssWidth >= 640 ? 24 : 16;
  const dockWidth = Math.min(360, Math.max(240, cssWidth - horizontalPadding * 2));
  const dockHeight = 88;
  const left = cssWidth - horizontalPadding - dockWidth;
  const top = cssHeight - horizontalPadding - dockHeight;
  return {
    left: left * density,
    top: top * density,
    right: (left + dockWidth) * density,
    bottom: (top + dockHeight) * density,
  };
}

function interpolateRectangle(start: Rectangle, end: Rectangle, progress: number): Rectangle {
  const lerp = (from: number, to: number) => from + (to - from) * progress;
  return {
    left: lerp(start.left, end.left),
    top: lerp(start.top, end.top),
    right: lerp(start.right, end.right),
    bottom: lerp(start.bottom, end.bottom),
  };
}

function fitRectangle(rectangle: Rectangle, aspectRatio: number): Rectangle {
  const width = Math.max(1, rectangle.right - rectangle.left);
  const height = Math.max(1, rectangle.bottom - rectangle.top);
  const containerRatio = width / height;
  const fittedWidth = containerRatio > aspectRatio ? height * aspectRatio : width;
  const fittedHeight = fittedWidth / aspectRatio;
  const left = rectangle.left + (width - fittedWidth) / 2;
  const top = rectangle.top + (height - fittedHeight) / 2;
  return {
    left,
    top,
    right: left + fittedWidth,
    bottom: top + fittedHeight,
  };
}

function animateRectangle(
  canvas: HTMLCanvasElement,
  image: TransitionImage,
  phase: WorkspaceElasticTransitionPhase,
  onComplete: () => void,
) {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    onComplete();
    return () => undefined;
  }

  let frame = 0;
  let disposed = false;
  const startedAt = performance.now();
  const duration = phase === "out" ? OUT_DURATION : IN_DURATION;
  const source = transitionImageSize(image);

  const resize = () => {
    const density = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(window.innerWidth * density));
    const height = Math.max(1, Math.round(window.innerHeight * density));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    }
    return { width, height, density };
  };

  const render = (now: number) => {
    if (disposed) return;
    const elapsed = clamp((now - startedAt) / duration);
    const viewport = resize();
    const sourceAspectRatio = source.width / Math.max(1, source.height);
    const dock = fitRectangle(
      getDockRectangle(viewport.width, viewport.height, viewport.density),
      sourceAspectRatio,
    );
    const fullScreen = fitRectangle(
      { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
      sourceAspectRatio,
    );
    const progress = transitionProgress(elapsed);
    const rectangle = phase === "out"
      ? interpolateRectangle(fullScreen, dock, progress)
      : interpolateRectangle(dock, fullScreen, progress);
    const alpha = phase === "out"
      ? 1 - clamp((elapsed - 0.84) / 0.16)
      : clamp(elapsed / 0.12);
    const destinationWidth = Math.max(1, rectangle.right - rectangle.left);
    const destinationHeight = Math.max(1, rectangle.bottom - rectangle.top);

    context.clearRect(0, 0, viewport.width, viewport.height);
    context.globalAlpha = alpha;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    try {
      context.drawImage(
        image,
        0,
        0,
        source.width,
        source.height,
        rectangle.left,
        rectangle.top,
        destinationWidth,
        destinationHeight,
      );
    } catch {
      onComplete();
      return;
    } finally {
      context.globalAlpha = 1;
    }

    if (elapsed >= 1) {
      onComplete();
      return;
    }
    frame = window.requestAnimationFrame(render);
  };

  frame = window.requestAnimationFrame(render);
  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", onResize);
  };
}

export function WorkspaceElasticTextureTransition({
  bitmap,
  phase,
  onComplete,
}: WorkspaceElasticTextureTransitionProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const completeRef = React.useRef(onComplete);
  completeRef.current = onComplete;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return animateRectangle(canvas, bitmap, phase, () => completeRef.current());
  }, [bitmap, phase]);

  return <canvas
    ref={canvasRef}
    aria-hidden="true"
    className="pointer-events-none fixed inset-0 z-[220] block"
  />;
}

export async function captureWorkspaceBitmap(element: HTMLElement, scale = 1) {
  const normalizedScale = Math.min(1, Math.max(0.25, scale));
  try {
    return await snapdom.toCanvas(element, {
      scale: normalizedScale,
      dpr: Math.min(2, window.devicePixelRatio || 1),
      fast: true,
      compress: false,
    });
  } catch {
    // A failed snapshot must not leave a misleading blank transition surface.
  }
  return null;
}
