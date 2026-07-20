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
  group: Konva.Group;
  lines: Konva.Line[];
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
          node: trail.group,
          duration: 0.75,
          opacity: 0,
          easing: Konva.Easings.EaseOut,
          onFinish: () => trail.group.destroy(),
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

    controllerRef.current = {
      emit(source, event, point) {
        if (event.phase === "start") {
          const previous = trails.get(source);
          if (previous) fadeTrail(previous);
          const group = new Konva.Group({ listening: false });
          const lineConfigs = [
            { width: 15, opacity: 0.09, blur: 15, shadowOpacity: 0.48 },
            { width: 9, opacity: 0.2, blur: 7, shadowOpacity: 0.38 },
            { width: 4.5, opacity: 0.4, blur: 2, shadowOpacity: 0.22 },
          ];
          const lines = lineConfigs.map(
            (config) =>
              new Konva.Line({
                points: [point.x, point.y],
                stroke: event.color,
                strokeWidth: config.width,
                opacity: config.opacity,
                globalCompositeOperation: "multiply",
                lineCap: "round",
                lineJoin: "round",
                tension: 0.22,
                shadowColor: event.color,
                shadowBlur: config.blur,
                shadowOpacity: config.shadowOpacity,
                listening: false,
              }),
          );
          lines.forEach((line) => group.add(line));
          layer.add(group);
          const trail = { group, lines, points: [point.x, point.y] };
          trails.set(source, trail);
          armIdleFade(source, trail);
          layer.batchDraw();
          return;
        }

        const trail = trails.get(source);
        if (!trail) return;
        trail.points.push(point.x, point.y);
        trail.lines.forEach((line) => line.points(trail.points));
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
