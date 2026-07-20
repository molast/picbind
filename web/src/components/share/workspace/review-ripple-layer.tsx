"use client";

import React from "react";
import type { ReviewLaserEvent } from "@/utils/review-collaboration";

export type ReviewRippleLayerController = {
  emit(event: ReviewLaserEvent): void;
};

type ReviewRippleLayerProps = {
  imageUrl: string;
  annotationSnapshot: string | null;
  controllerRef: React.MutableRefObject<ReviewRippleLayerController | null>;
};

const RIPPLE_DURATION_MS = 1050;
const MAX_ACTIVE_RIPPLES = 5;

const RIPPLE_FRAGMENT_SHADER = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uProgress;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;

void main() {
  vec2 textureScale = uOutputFrame.zw * uInputSize.zw;
  vec2 imageCoord = vTextureCoord / textureScale;
  vec2 delta = imageCoord - uCenter;
  float aspect = uSize.x / max(1.0, uSize.y);
  vec2 metricDelta = vec2(delta.x * aspect, delta.y);
  float distanceFromCenter = length(metricDelta);
  vec2 direction = distanceFromCenter > 0.0001
    ? metricDelta / distanceFromCenter
    : vec2(0.0);

  float radius = mix(0.015, 0.235, uProgress);
  float packetWidth = mix(0.032, 0.014, uProgress);
  float packet = exp(-pow((distanceFromCenter - radius) / packetWidth, 2.0));
  float innerPacket = exp(-pow((distanceFromCenter - radius * 0.72) / (packetWidth * 1.35), 2.0));
  float phase = (distanceFromCenter - radius) * 210.0;
  float wave = sin(phase) * packet + sin(phase * 0.72 - 1.4) * innerPacket * 0.28;
  float life = smoothstep(1.0, 0.72, uProgress);
  float displacement = wave * mix(0.013, 0.003, uProgress) * life;

  vec2 uvDirection = vec2(direction.x / max(0.0001, aspect), direction.y);
  vec2 refractedImageCoord = clamp(
    imageCoord - uvDirection * displacement,
    vec2(0.001),
    vec2(0.999)
  );
  vec4 refracted = texture(uTexture, refractedImageCoord * textureScale);

  float highlight = cos(phase) * packet * life;
  refracted.rgb += max(highlight, 0.0) * vec3(0.14, 0.18, 0.22);
  refracted.rgb -= max(-highlight, 0.0) * vec3(0.09, 0.12, 0.14);

  float centerPulse = exp(-distanceFromCenter * 72.0) * smoothstep(0.22, 0.0, uProgress);
  float effectMask = clamp((packet + innerPacket * 0.25) * life + centerPulse, 0.0, 1.0);
  finalColor = vec4(refracted.rgb * effectMask, refracted.a * effectMask);
}
`;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ripple texture: ${url}`));
    image.src = url;
  });
}

export default function ReviewRippleLayer({
  imageUrl,
  annotationSnapshot,
  controllerRef,
}: ReviewRippleLayerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const sourceRef = React.useRef({ imageUrl, annotationSnapshot });
  const refreshRef = React.useRef<(() => void) | null>(null);
  sourceRef.current = { imageUrl, annotationSnapshot };

  React.useEffect(() => {
    refreshRef.current?.();
  }, [imageUrl, annotationSnapshot]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let refreshSequence = 0;

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

      let texture: InstanceType<typeof pixi.Texture> | null = null;
      const activeRipples: Array<{
        sprite: InstanceType<typeof pixi.Sprite>;
        filter: InstanceType<typeof pixi.Filter>;
        startedAt: number;
      }> = [];

      const refreshTexture = async () => {
        const sequence = ++refreshSequence;
        const width = Math.max(1, Math.round(container.clientWidth));
        const height = Math.max(1, Math.round(container.clientHeight));
        const source = sourceRef.current;
        try {
          const [image, annotations] = await Promise.all([
            loadImage(source.imageUrl),
            source.annotationSnapshot
              ? loadImage(source.annotationSnapshot)
              : Promise.resolve(null),
          ]);
          if (disposed || sequence !== refreshSequence) return;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(image, 0, 0, width, height);
          if (annotations) context.drawImage(annotations, 0, 0, width, height);
          const nextTexture = pixi.Texture.from(canvas);
          const previousTexture = texture;
          texture = nextTexture;
          activeRipples.forEach(({ sprite }) => {
            sprite.texture = nextTexture;
            sprite.width = width;
            sprite.height = height;
          });
          previousTexture?.destroy(true);
        } catch {
          // A transient snapshot failure should not affect the annotation canvas.
        }
      };
      refreshRef.current = () => void refreshTexture();
      await refreshTexture();

      controllerRef.current = {
        emit(event) {
          if (event.phase !== "start" || !texture) return;
          const width = Math.max(1, container.clientWidth);
          const height = Math.max(1, container.clientHeight);
          const filter = pixi.Filter.from({
            gl: {
              vertex: pixi.defaultFilterVert,
              fragment: RIPPLE_FRAGMENT_SHADER,
            },
            resources: {
              rippleUniforms: {
                uCenter: {
                  value: new Float32Array([event.x, event.y]),
                  type: "vec2<f32>",
                },
                uSize: {
                  value: new Float32Array([width, height]),
                  type: "vec2<f32>",
                },
                uProgress: { value: 0, type: "f32" },
              },
            },
            antialias: "on",
            padding: 0,
          });
          const sprite = new pixi.Sprite(texture);
          sprite.width = width;
          sprite.height = height;
          sprite.filters = [filter];
          app.stage.addChild(sprite);
          activeRipples.push({ sprite, filter, startedAt: performance.now() });
          while (activeRipples.length > MAX_ACTIVE_RIPPLES) {
            const oldest = activeRipples.shift();
            oldest?.sprite.destroy();
            oldest?.filter.destroy();
          }
        },
      };

      app.ticker.add(() => {
        const now = performance.now();
        for (let index = activeRipples.length - 1; index >= 0; index -= 1) {
          const ripple = activeRipples[index];
          const progress = (now - ripple.startedAt) / RIPPLE_DURATION_MS;
          if (progress >= 1) {
            activeRipples.splice(index, 1);
            ripple.sprite.destroy();
            ripple.filter.destroy();
            continue;
          }
          const uniforms = ripple.filter.resources.rippleUniforms.uniforms as {
            uProgress: number;
          };
          uniforms.uProgress = progress;
        }
      });

      const resizeObserver = new ResizeObserver(() => void refreshTexture());
      resizeObserver.observe(container);
      return () => {
        resizeObserver.disconnect();
        activeRipples.forEach(({ sprite, filter }) => {
          sprite.destroy();
          filter.destroy();
        });
        activeRipples.length = 0;
        texture?.destroy(true);
        app.destroy(true);
      };
    };

    let cleanupResize: (() => void) | undefined;
    void setup().then((cleanup) => {
      if (disposed) cleanup?.();
      else cleanupResize = cleanup;
    });

    return () => {
      disposed = true;
      refreshSequence += 1;
      controllerRef.current = null;
      refreshRef.current = null;
      cleanupResize?.();
      const canvas = container.querySelector("canvas");
      canvas?.remove();
    };
  }, [controllerRef]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      aria-hidden="true"
    />
  );
}
