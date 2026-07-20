"use client";

import React from "react";
import Konva from "konva";
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

type ActiveTrail = {
  line: Konva.Line;
  points: number[];
  idleTimer?: ReturnType<typeof setTimeout>;
};

export default function ReviewLaserLayer({
  controllerRef,
}: ReviewLaserLayerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
      listening: false,
    });
    const layer = new Konva.Layer({ listening: false });
    stage.add(layer);
    const trails = new Map<ReviewLaserSource, ActiveTrail>();
    const fadeTimers = new Set<ReturnType<typeof setTimeout>>();

    const fadeTrail = (trail: ActiveTrail) => {
      if (trail.idleTimer) {
        clearTimeout(trail.idleTimer);
        fadeTimers.delete(trail.idleTimer);
        trail.idleTimer = undefined;
      }
      const timer = setTimeout(() => {
        fadeTimers.delete(timer);
        new Konva.Tween({
          node: trail.line,
          duration: 0.75,
          opacity: 0,
          easing: Konva.Easings.EaseOut,
          onFinish: () => trail.line.destroy(),
        }).play();
      }, 240);
      fadeTimers.add(timer);
    };

    const armIdleFade = (source: ReviewLaserSource, trail: ActiveTrail) => {
      if (trail.idleTimer) {
        clearTimeout(trail.idleTimer);
        fadeTimers.delete(trail.idleTimer);
      }
      trail.idleTimer = setTimeout(() => {
        if (trails.get(source) !== trail) return;
        trails.delete(source);
        fadeTrail(trail);
      }, 1400);
      fadeTimers.add(trail.idleTimer);
    };

    const ripple = (point: { x: number; y: number }, color: string) => {
      const circle = new Konva.Circle({
        x: point.x,
        y: point.y,
        radius: 3,
        stroke: color,
        strokeWidth: 3,
        opacity: 0.85,
        shadowColor: color,
        shadowBlur: 10,
        shadowOpacity: 0.7,
        listening: false,
      });
      layer.add(circle);
      new Konva.Tween({
        node: circle,
        duration: 0.65,
        radius: 30,
        opacity: 0,
        easing: Konva.Easings.EaseOut,
        onFinish: () => circle.destroy(),
      }).play();
    };

    controllerRef.current = {
      emit(source, event, point) {
        if (event.phase === "start") {
          const previous = trails.get(source);
          if (previous) fadeTrail(previous);
          ripple(point, event.color);
          const line = new Konva.Line({
            points: [point.x, point.y],
            stroke: event.color,
            strokeWidth: 18,
            opacity: 0.42,
            globalCompositeOperation: "multiply",
            lineCap: "round",
            lineJoin: "round",
            tension: 0.25,
            shadowColor: event.color,
            shadowBlur: 9,
            shadowOpacity: 0.55,
            listening: false,
          });
          layer.add(line);
          const trail = { line, points: [point.x, point.y] };
          trails.set(source, trail);
          armIdleFade(source, trail);
          layer.batchDraw();
          return;
        }

        const trail = trails.get(source);
        if (!trail) return;
        trail.points.push(point.x, point.y);
        trail.line.points(trail.points);
        layer.batchDraw();
        if (event.phase === "end") {
          trails.delete(source);
          fadeTrail(trail);
        } else {
          armIdleFade(source, trail);
        }
      },
    };

    const resize = () => {
      stage.size({ width: container.clientWidth, height: container.clientHeight });
      layer.batchDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => {
      controllerRef.current = null;
      observer.disconnect();
      fadeTimers.forEach(clearTimeout);
      stage.destroy();
    };
  }, [controllerRef]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-20 [mix-blend-mode:multiply]"
    />
  );
}
