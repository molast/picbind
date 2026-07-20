"use client";

import React from "react";
import type { ReviewLaserEvent } from "@/utils/review-collaboration";

export type ReviewLaserSource = "local" | "remote";
export type ReviewLaserLayerController = {
  emit(
    source: ReviewLaserSource,
    event: ReviewLaserEvent,
    point: { x: number; y: number },
  ): void;
};

type ReviewLaserLayerProps = {
  controllerRef: React.MutableRefObject<ReviewLaserLayerController | null>;
};

type TrailPoint = {
  x: number;
  y: number;
  createdAt: number;
};

type TrailStroke = {
  source: ReviewLaserSource;
  color: string;
  points: TrailPoint[];
};

type PendingEvent = {
  source: ReviewLaserSource;
  event: ReviewLaserEvent;
  point: { x: number; y: number };
};

const POINT_LIFETIME_MS = 1050;
const POINT_SPACING_PX = 3;

function appendPoint(stroke: TrailStroke, point: { x: number; y: number }) {
  const createdAt = performance.now();
  const previous = stroke.points.at(-1);
  if (!previous) {
    stroke.points.push({ ...point, createdAt });
    return;
  }

  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  const steps = Math.min(32, Math.max(1, Math.ceil(distance / POINT_SPACING_PX)));
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    stroke.points.push({
      x: previous.x + (point.x - previous.x) * ratio,
      y: previous.y + (point.y - previous.y) * ratio,
      createdAt: previous.createdAt + (createdAt - previous.createdAt) * ratio,
    });
  }
}

function pointAlpha(point: TrailPoint, now: number) {
  const remaining = 1 - (now - point.createdAt) / POINT_LIFETIME_MS;
  return Math.max(0, Math.min(1, remaining)) ** 1.35;
}

export default function ReviewLaserLayer({
  controllerRef,
}: ReviewLaserLayerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const pendingEvents: PendingEvent[] = [];

    controllerRef.current = {
      emit(source, event, point) {
        pendingEvents.push({ source, event, point });
      },
    };

    const setup = async () => {
      const pixi = await import("pixi.js");
      if (disposed) return;

      const app = new pixi.Application();
      await app.init({
        resizeTo: container,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: "webgl",
        powerPreference: "high-performance",
      });
      if (disposed) {
        app.destroy(true);
        return;
      }

      app.canvas.className = "block h-full w-full";
      app.canvas.setAttribute("aria-hidden", "true");
      container.appendChild(app.canvas);

      const glow = new pixi.Graphics();
      const halo = new pixi.Graphics();
      const core = new pixi.Graphics();
      const glowBlur = new pixi.BlurFilter({
        strength: 7,
        quality: 2,
        kernelSize: 7,
        resolution: 0.75,
        padding: 16,
      });
      glow.filters = [glowBlur];
      glow.blendMode = "add";
      halo.blendMode = "add";
      core.blendMode = "add";
      app.stage.addChild(glow, halo, core);

      const strokes: TrailStroke[] = [];
      const activeStrokes = new Map<ReviewLaserSource, TrailStroke>();

      const emit = (
        source: ReviewLaserSource,
        event: ReviewLaserEvent,
        point: { x: number; y: number },
      ) => {
        if (event.phase === "start") {
          const stroke: TrailStroke = { source, color: event.color, points: [] };
          appendPoint(stroke, point);
          strokes.push(stroke);
          activeStrokes.set(source, stroke);
          return;
        }

        let stroke = activeStrokes.get(source);
        if (!stroke && event.phase !== "end") {
          stroke = { source, color: event.color, points: [] };
          strokes.push(stroke);
          activeStrokes.set(source, stroke);
        }
        if (!stroke) return;
        appendPoint(stroke, point);
        if (event.phase === "end") activeStrokes.delete(source);
      };

      controllerRef.current = { emit };
      pendingEvents.splice(0).forEach(({ source, event, point }) => {
        emit(source, event, point);
      });

      const drawSegment = (
        graphics: InstanceType<typeof pixi.Graphics>,
        start: TrailPoint,
        end: TrailPoint,
        color: string,
        width: number,
        alpha: number,
      ) => {
        graphics
          .moveTo(start.x, start.y)
          .lineTo(end.x, end.y)
          .stroke({ color, width, alpha, cap: "round", join: "round" });
      };

      app.ticker.add(() => {
        const now = performance.now();
        glow.clear();
        halo.clear();
        core.clear();

        for (let strokeIndex = strokes.length - 1; strokeIndex >= 0; strokeIndex -= 1) {
          const stroke = strokes[strokeIndex];
          while (
            stroke.points.length &&
            now - stroke.points[0].createdAt >= POINT_LIFETIME_MS
          ) {
            stroke.points.shift();
          }
          if (!stroke.points.length) {
            strokes.splice(strokeIndex, 1);
            if (activeStrokes.get(stroke.source) === stroke) {
              activeStrokes.delete(stroke.source);
            }
            continue;
          }

          if (stroke.points.length === 1) {
            const point = stroke.points[0];
            const alpha = pointAlpha(point, now);
            glow.circle(point.x, point.y, 6).fill({ color: stroke.color, alpha: alpha * 0.3 });
            halo.circle(point.x, point.y, 3.8).fill({ color: stroke.color, alpha: alpha * 0.45 });
            core.circle(point.x, point.y, 1.8).fill({ color: stroke.color, alpha });
            continue;
          }

          for (let index = 1; index < stroke.points.length; index += 1) {
            const start = stroke.points[index - 1];
            const end = stroke.points[index];
            const alpha = (pointAlpha(start, now) + pointAlpha(end, now)) / 2;
            drawSegment(glow, start, end, stroke.color, 13, alpha * 0.24);
            drawSegment(halo, start, end, stroke.color, 7, alpha * 0.34);
            drawSegment(core, start, end, stroke.color, 3.2, alpha * 0.92);
          }
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        app.renderer.resize(container.clientWidth, container.clientHeight);
      });
      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
        controllerRef.current = null;
        strokes.length = 0;
        activeStrokes.clear();
        glowBlur.destroy();
        app.destroy(true, { children: true });
      };
    };

    let cleanup: (() => void) | undefined;
    void setup().then((setupCleanup) => {
      if (disposed) setupCleanup?.();
      else cleanup = setupCleanup;
    });

    return () => {
      disposed = true;
      controllerRef.current = null;
      pendingEvents.length = 0;
      cleanup?.();
      container.querySelector("canvas")?.remove();
    };
  }, [controllerRef]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      aria-hidden="true"
    />
  );
}
