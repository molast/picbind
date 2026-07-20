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
    const rippleAnimations = new Set<Konva.Animation>();

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

    const ripple = (point: { x: number; y: number }) => {
      let progress = 0;
      const wave = new Konva.Shape({
        x: point.x,
        y: point.y,
        listening: false,
        perfectDrawEnabled: false,
        sceneFunc(context) {
          const drawWave = (
            radius: number,
            waveIndex: number,
            offsetY: number,
            strokeStyle: string,
            lineWidth: number,
          ) => {
            context.beginPath();
            const steps = 72;
            for (let index = 0; index <= steps; index += 1) {
              const angle = (index / steps) * Math.PI * 2;
              const distortion =
                Math.sin(angle * 7 + progress * 13 + waveIndex * 1.7) *
                (0.8 + progress * 1.8);
              const localRadius = radius + distortion;
              const x = Math.cos(angle) * localRadius;
              const y = Math.sin(angle) * localRadius * 0.46 + offsetY;
              if (index === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            }
            context.closePath();
            context.strokeStyle = strokeStyle;
            context.lineWidth = lineWidth;
            context.lineCap = "round";
            context.lineJoin = "round";
            context.stroke();
          };

          for (let waveIndex = 0; waveIndex < 4; waveIndex += 1) {
            const localProgress = progress - waveIndex * 0.105;
            if (localProgress <= 0 || localProgress >= 1) continue;
            const radius = 5 + localProgress * 49;
            const alpha = Math.pow(1 - localProgress, 1.65) * (0.62 - waveIndex * 0.08);
            context.save();
            context.globalCompositeOperation = "screen";
            drawWave(
              radius,
              waveIndex,
              -0.8,
              `rgba(255,255,255,${alpha})`,
              1.8,
            );
            context.restore();
            context.save();
            context.globalCompositeOperation = "multiply";
            drawWave(
              radius,
              waveIndex,
              1.2,
              `rgba(20,70,95,${alpha * 0.46})`,
              1.35,
            );
            context.restore();
          }

          const centerAlpha = Math.max(0, 1 - progress * 2.4) * 0.18;
          if (centerAlpha > 0) {
            const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 16);
            gradient.addColorStop(0, `rgba(255,255,255,${centerAlpha})`);
            gradient.addColorStop(1, "rgba(255,255,255,0)");
            context.fillStyle = gradient;
            context.beginPath();
            context.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
            context.fill();
          }
        },
      });
      layer.add(wave);
      const animation = new Konva.Animation((frame) => {
        progress = Math.min(1, (frame?.time || 0) / 950);
        if (progress >= 1) {
          animation.stop();
          rippleAnimations.delete(animation);
          wave.destroy();
          layer.batchDraw();
        }
      }, layer);
      rippleAnimations.add(animation);
      animation.start();
    };

    controllerRef.current = {
      emit(source, event, point) {
        if (event.phase === "start") {
          const previous = trails.get(source);
          if (previous) fadeTrail(previous);
          ripple(point);
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
      rippleAnimations.forEach((animation) => animation.stop());
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
