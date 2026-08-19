"use client";

import React from "react";
import type { ReviewLaserEvent } from "../../../utils/review-collaboration";

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
const RIPPLE_FILTER_PADDING = 2;
const RIPPLE_FILTER_RESOLUTION = 1;

function nextPowerOfTwo(value: number) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function getFilterGeometry(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const frameWidth = width + RIPPLE_FILTER_PADDING * 2;
  const frameHeight = height + RIPPLE_FILTER_PADDING * 2;
  const textureWidth =
    nextPowerOfTwo(Math.ceil(frameWidth * RIPPLE_FILTER_RESOLUTION - 1e-6)) /
    RIPPLE_FILTER_RESOLUTION;
  const textureHeight =
    nextPowerOfTwo(Math.ceil(frameHeight * RIPPLE_FILTER_RESOLUTION - 1e-6)) /
    RIPPLE_FILTER_RESOLUTION;
  return {
    center: [
      (RIPPLE_FILTER_PADDING + x * width) / textureWidth,
      (RIPPLE_FILTER_PADDING + y * height) / textureHeight,
    ],
    textureSize: [textureWidth, textureHeight],
  };
}

const RIPPLE_FRAGMENT_SHADER = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform vec2 uTextureSize;
uniform float uProgress;

float rippleWave(float distancePx, float radiusPx, float widthPx) {
  float position = (distancePx - radiusPx) / widthPx;
  return sin(position * 2.35) * exp(-position * position);
}

float rippleEnvelope(float distancePx, float radiusPx, float widthPx) {
  float position = (distancePx - radiusPx) / widthPx;
  return exp(-position * position);
}

void main() {
  vec2 deltaPx = (vTextureCoord - uCenter) * uTextureSize;
  float distancePx = length(deltaPx);
  vec2 direction = distancePx > 0.0001
    ? deltaPx / distancePx
    : vec2(0.0);

  float maximumRadius = min(72.0, min(uSize.x, uSize.y) * 0.12);
  float frontRadius = mix(3.0, maximumRadius, uProgress);
  float waveWidth = mix(6.4, 4.2, uProgress);
  float spacing = 10.0;

  float active1 = smoothstep(spacing, spacing + 3.0, frontRadius);
  float active2 = smoothstep(spacing * 2.0, spacing * 2.0 + 3.0, frontRadius);
  float active3 = smoothstep(spacing * 3.0, spacing * 3.0 + 3.0, frontRadius);
  float wave0 = rippleWave(distancePx, frontRadius, waveWidth);
  float wave1 = rippleWave(distancePx, frontRadius - spacing, waveWidth) * active1;
  float wave2 = rippleWave(distancePx, frontRadius - spacing * 2.0, waveWidth) * active2;
  float wave3 = rippleWave(distancePx, frontRadius - spacing * 3.0, waveWidth) * active3;
  float envelope0 = rippleEnvelope(distancePx, frontRadius, waveWidth);
  float envelope1 = rippleEnvelope(distancePx, frontRadius - spacing, waveWidth) * active1;
  float envelope2 = rippleEnvelope(distancePx, frontRadius - spacing * 2.0, waveWidth) * active2;
  float envelope3 = rippleEnvelope(distancePx, frontRadius - spacing * 3.0, waveWidth) * active3;

  float wave = wave0 + wave1 * 0.68 + wave2 * 0.44 + wave3 * 0.28;
  float envelope = envelope0 + envelope1 * 0.68 + envelope2 * 0.44 + envelope3 * 0.28;
  float life = 1.0 - smoothstep(0.72, 1.0, uProgress);
  float displacementPx = wave * mix(5.0, 1.6, uProgress) * life;

  vec2 refractedUv = clamp(
    vTextureCoord - direction * displacementPx / uTextureSize,
    vec2(0.001),
    vec2(0.999)
  );
  vec4 refracted = texture(uTexture, refractedUv);

  float highlight = wave * life;
  refracted.rgb += max(highlight, 0.0) * vec3(0.14, 0.18, 0.22);
  refracted.rgb -= max(-highlight, 0.0) * vec3(0.09, 0.12, 0.14);

  float centerPulse = exp(-distancePx * 0.24) * (1.0 - smoothstep(0.0, 0.22, uProgress));
  float effectMask = clamp(envelope * life + centerPulse, 0.0, 1.0);
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
          const geometry = getFilterGeometry(event.x, event.y, width, height);
          const filter = pixi.Filter.from({
            gl: {
              vertex: pixi.defaultFilterVert,
              fragment: RIPPLE_FRAGMENT_SHADER,
            },
            resources: {
              rippleUniforms: {
                uCenter: {
                  value: new Float32Array(geometry.center),
                  type: "vec2<f32>",
                },
                uSize: {
                  value: new Float32Array([width, height]),
                  type: "vec2<f32>",
                },
                uTextureSize: {
                  value: new Float32Array(geometry.textureSize),
                  type: "vec2<f32>",
                },
                uProgress: { value: 0, type: "f32" },
              },
            },
            antialias: "on",
            padding: RIPPLE_FILTER_PADDING,
            resolution: RIPPLE_FILTER_RESOLUTION,
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
