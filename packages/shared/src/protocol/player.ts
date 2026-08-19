import { emojiToSvg } from "../utils/emoji";
import type {
  MipEffectInstruction,
  MipInstruction,
  MipMotionFrame,
  MipMotionPathInstruction,
  MipMotionSegment,
  MipTiming,
  MipTimeline,
  MotionIntentDocument,
} from "../types/mip";

type LayerName =
  | "path"
  | "translate"
  | "rotate"
  | "scale"
  | "skew"
  | "pulse"
  | "shake"
  | "blur"
  | "glow"
  | "opacity";

const EASINGS: Record<NonNullable<MipTiming["easing"]>, string> = {
  linear: "linear",
  ease: "ease",
  easeIn: "cubic-bezier(0.42, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.58, 1)",
  bounce: "cubic-bezier(0.34, 1.72, 0.64, 1)",
  elastic: "cubic-bezier(0.22, 1.8, 0.36, 1)",
};

function animationOptions(
  timing: MipTiming,
  fill: NonNullable<KeyframeAnimationOptions["fill"]> = "both",
): KeyframeAnimationOptions {
  return {
    duration: Math.max(0, timing.duration),
    delay: Math.max(0, timing.delay ?? 0),
    iterations: timing.loop ? Infinity : Math.max(1, (timing.repeat ?? 0) + 1),
    easing: EASINGS[timing.easing ?? "ease"],
    fill,
  };
}

function point(point: { x: number; y: number }) {
  return `${point.x} ${point.y}`;
}

function motionPath(instruction: MipMotionPathInstruction, scale = 1) {
  if (instruction.type === "line") {
    return `path("M ${point({ x: instruction.from.x * scale, y: instruction.from.y * scale })} L ${point({ x: instruction.to.x * scale, y: instruction.to.y * scale })}")`;
  }
  if (instruction.type === "bezier") {
    const scaled = (value: { x: number; y: number }) => ({
      x: value.x * scale,
      y: value.y * scale,
    });
    return `path("M ${point(scaled(instruction.from))} C ${point(scaled(instruction.control1))}, ${point(scaled(instruction.control2))}, ${point(scaled(instruction.to))}")`;
  }
  const radius = Math.max(1, instruction.radius * scale);
  const angle = ((instruction.startAngle ?? -90) * Math.PI) / 180;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const oppositeX = -x;
  const oppositeY = -y;
  return `path("M ${x} ${y} A ${radius} ${radius} 0 1 1 ${oppositeX} ${oppositeY} A ${radius} ${radius} 0 1 1 ${x} ${y}")`;
}

function cubicPoint(
  start: { x: number; y: number },
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  end: { x: number; y: number },
  progress: number,
) {
  const inverse = 1 - progress;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * progress * control1.x +
      3 * inverse * progress ** 2 * control2.x +
      progress ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * progress * control1.y +
      3 * inverse * progress ** 2 * control2.y +
      progress ** 3 * end.y,
  };
}

export type MipPlayerOptions = {
  assetSize?: number;
  className?: string;
};

export class MipPlayer {
  private readonly container: HTMLElement;
  private readonly options: MipPlayerOptions;
  private layers = new Map<LayerName, HTMLDivElement>();
  private animations: Animation[] = [];
  private particleElements: HTMLElement[] = [];
  private document: MotionIntentDocument | null = null;
  private spatialScale = 1;
  private renderedAssetSize = 104;

  constructor(container: HTMLElement, options: MipPlayerOptions = {}) {
    this.container = container;
    this.options = options;
  }

  load(intent: MotionIntentDocument) {
    this.stop();
    this.document = intent;
    this.layers = new Map();
    const authoredWidth = intent.viewport?.width ?? this.container.clientWidth;
    const authoredHeight = intent.viewport?.height ?? this.container.clientHeight;
    const authoredScale = intent.viewport
      ? Math.min(authoredWidth / 440, authoredHeight / 320)
      : 1;
    const containerScale = intent.viewport
      ? Math.min(
          this.container.clientWidth / Math.max(1, intent.viewport.width),
          this.container.clientHeight / Math.max(1, intent.viewport.height),
        )
      : 1;
    this.spatialScale = Math.max(0.05, authoredScale * containerScale);
    const requestedAssetSize =
      (this.options.assetSize ?? 104) * Math.min(1, this.spatialScale);
    const viewportAssetLimit = Math.max(
      12,
      Math.min(this.container.clientWidth, this.container.clientHeight) * 0.34,
    );
    this.renderedAssetSize = Math.min(requestedAssetSize, viewportAssetLimit);
    const ownerDocument = this.container.ownerDocument;
    const root = ownerDocument.createElement("div");
    root.className = `mip-player-node ${this.options.className ?? ""}`.trim();
    root.style.position = "absolute";
    root.style.left = "50%";
    root.style.top = "50%";
    root.style.width = "0";
    root.style.height = "0";

    let parent: HTMLElement = root;
    const layerNames: LayerName[] = [
      "path",
      "translate",
      "rotate",
      "scale",
      "skew",
      "pulse",
      "shake",
      "blur",
      "glow",
      "opacity",
    ];
    for (const name of layerNames) {
      const layer = ownerDocument.createElement("div");
      layer.className = `mip-layer mip-layer-${name}`;
      layer.style.position = "absolute";
      layer.style.left = "0";
      layer.style.top = "0";
      layer.style.width = "0";
      layer.style.height = "0";
      layer.style.transformOrigin = "center";
      parent.appendChild(layer);
      parent = layer;
      this.layers.set(name, layer);
    }

    const asset = emojiToSvg(intent.asset.value, {
      size: this.renderedAssetSize,
      padding: 8,
    });
    const image = ownerDocument.createElement("img");
    image.className = "mip-emoji-asset";
    image.src = asset.dataUrl;
    image.alt = intent.asset.ariaLabel ?? asset.emoji;
    image.draggable = false;
    image.width = asset.width;
    image.height = asset.height;
    image.style.position = "absolute";
    image.style.left = `${-asset.width / 2}px`;
    image.style.top = `${-asset.height / 2}px`;
    image.style.width = `${asset.width}px`;
    image.style.height = `${asset.height}px`;
    image.style.userSelect = "none";
    image.style.pointerEvents = "none";
    parent.appendChild(image);
    this.container.replaceChildren(root);
    return asset;
  }

  play(intent: MotionIntentDocument = this.requireDocument()) {
    this.load(intent);
    if (intent.timeline) {
      this.animations.push(...this.animateTimeline(intent.timeline));
      if (intent.animationMode === "perSegment") {
        let elapsed = Math.max(0, intent.timeline.delay ?? 0);
        intent.timeline.segments.forEach((segment) => {
          segment.instructions?.forEach((instruction) => {
            this.animations.push(
              ...this.animateInstruction(
                {
                  ...instruction,
                  timing: {
                    ...instruction.timing,
                    delay: elapsed + Math.max(0, instruction.timing.delay ?? 0),
                  },
                },
                "forwards",
              ),
            );
          });
          elapsed += Math.max(1, segment.duration);
        });
      }
    }
    for (const instruction of intent.instructions) {
      this.animations.push(...this.animateInstruction(instruction));
    }
    return this.animations;
  }

  pause() {
    this.animations.forEach((animation) => animation.pause());
  }

  resume() {
    this.animations.forEach((animation) => animation.play());
  }

  stop() {
    this.animations.forEach((animation) => animation.cancel());
    this.animations = [];
    this.particleElements.forEach((element) => element.remove());
    this.particleElements = [];
  }

  private requireDocument() {
    if (!this.document) throw new Error("Load a Motion Intent document first");
    return this.document;
  }

  private layer(name: LayerName) {
    const layer = this.layers.get(name);
    if (!layer) throw new Error(`MIP layer is unavailable: ${name}`);
    return layer;
  }

  private animateInstruction(
    instruction: MipInstruction,
    fill: NonNullable<KeyframeAnimationOptions["fill"]> = "both",
  ): Animation[] {
    const options = animationOptions(instruction.timing, fill);
    if (instruction.category === "transform") {
      if (instruction.type === "translate") {
        return [
          this.layer("translate").animate(
            [
              { transform: `translate(${instruction.from.x * this.spatialScale}px, ${instruction.from.y * this.spatialScale}px)` },
              { transform: `translate(${instruction.to.x * this.spatialScale}px, ${instruction.to.y * this.spatialScale}px)` },
            ],
            options,
          ),
        ];
      }
      if (instruction.type === "scale") {
        return [
          this.layer("scale").animate(
            [
              { transform: `scale(${instruction.from})` },
              { transform: `scale(${instruction.to})` },
            ],
            options,
          ),
        ];
      }
      if (instruction.type === "rotate") {
        return [
          this.layer("rotate").animate(
            [
              { transform: `rotate(${instruction.from}deg)` },
              { transform: `rotate(${instruction.to}deg)` },
            ],
            options,
          ),
        ];
      }
      return [
        this.layer("skew").animate(
          [
            { transform: `skew(${instruction.from.x}deg, ${instruction.from.y}deg)` },
            { transform: `skew(${instruction.to.x}deg, ${instruction.to.y}deg)` },
          ],
          options,
        ),
      ];
    }

    if (instruction.category === "motionPath") {
      const layer = this.layer("path");
      layer.style.offsetPath = motionPath(instruction, this.spatialScale);
      layer.style.offsetRotate = "0deg";
      return [
        layer.animate(
          [{ offsetDistance: "0%" }, { offsetDistance: "100%" }],
          options,
        ),
      ];
    }

    if (instruction.category === "opacity") {
      const fadeIn = instruction.type === "fadeIn";
      return [
        this.layer("opacity").animate(
          [
            { opacity: instruction.from ?? (fadeIn ? 0 : 1) },
            { opacity: instruction.to ?? (fadeIn ? 1 : 0) },
          ],
          options,
        ),
      ];
    }

    return this.animateEffect(instruction, options);
  }

  private animateTimeline(timeline: MipTimeline) {
    const frameMap = new Map(timeline.frames.map((frame) => [frame.id, frame]));
    const segments = timeline.segments
      .map((segment) => ({
        segment,
        start: frameMap.get(segment.from),
        end: frameMap.get(segment.to),
      }))
      .filter(
        (entry): entry is {
          segment: MipMotionSegment;
          start: MipMotionFrame;
          end: MipMotionFrame;
        } => Boolean(entry.start && entry.end),
      );
    if (!segments.length) return [];

    const totalDuration = segments.reduce(
      (sum, entry) => sum + Math.max(1, entry.segment.duration),
      0,
    );
    type PathCommand =
      | { type: "move"; to: { x: number; y: number } }
      | {
          type: "line";
          from: { x: number; y: number };
          to: { x: number; y: number };
        }
      | {
          type: "bezier";
          from: { x: number; y: number };
          control1: { x: number; y: number };
          control2: { x: number; y: number };
          to: { x: number; y: number };
        };
    const commands: PathCommand[] = [];
    const boundsPoints: Array<{ x: number; y: number }> = [];
    const smoothJoin = (
      previousIndex: number,
      nextIndex: number,
      join: { x: number; y: number },
    ) => {
      const previous = commands[previousIndex];
      const next = commands[nextIndex];
      if (!previous || !next || previous.type === "move" || next.type === "move") return;
      const previousReference =
        previous.type === "bezier" ? previous.control2 : previous.from;
      const nextReference = next.type === "bezier" ? next.control1 : next.to;
      let dx = nextReference.x - previousReference.x;
      let dy = nextReference.y - previousReference.y;
      let magnitude = Math.hypot(dx, dy);
      if (magnitude < 0.001) {
        dx = next.to.x - previous.from.x;
        dy = next.to.y - previous.from.y;
        magnitude = Math.hypot(dx, dy);
      }
      if (magnitude < 0.001) return;
      const direction = { x: dx / magnitude, y: dy / magnitude };
      const previousSpan = Math.hypot(join.x - previous.from.x, join.y - previous.from.y);
      const nextSpan = Math.hypot(next.to.x - join.x, next.to.y - join.y);
      const previousHandle = Math.min(48, previousSpan * 0.28);
      const nextHandle = Math.min(48, nextSpan * 0.28);
      commands[previousIndex] = {
        type: "bezier",
        from: previous.from,
        control1:
          previous.type === "bezier"
            ? previous.control1
            : {
                x: previous.from.x + (join.x - previous.from.x) / 3,
                y: previous.from.y + (join.y - previous.from.y) / 3,
              },
        control2: {
          x: join.x - direction.x * previousHandle,
          y: join.y - direction.y * previousHandle,
        },
        to: join,
      };
      commands[nextIndex] = {
        type: "bezier",
        from: join,
        control1: {
          x: join.x + direction.x * nextHandle,
          y: join.y + direction.y * nextHandle,
        },
        control2:
          next.type === "bezier"
            ? next.control2
            : {
                x: join.x + ((next.to.x - join.x) * 2) / 3,
                y: join.y + ((next.to.y - join.y) * 2) / 3,
              },
        to: next.to,
      };
    };
    let previousEnd: { x: number; y: number } | null = null;
    segments.forEach(({ segment, start, end }) => {
      const anchors =
        segment.anchors && segment.anchors.length >= 2
          ? segment.anchors
          : [
              {
                id: `${segment.id}-start`,
                label: "1",
                position: start.position,
                motionToNext: segment.motion,
                controlOut: segment.control1,
              },
              {
                id: `${segment.id}-end`,
                label: "2",
                position: end.position,
                controlIn: segment.control2,
              },
            ];
      const first = anchors[0].position;
      const offset = previousEnd
        ? { x: previousEnd.x - first.x, y: previousEnd.y - first.y }
        : { x: 0, y: 0 };
      const translated = (value: { x: number; y: number }) => ({
        x: value.x + offset.x,
        y: value.y + offset.y,
      });
      const translatedFirst = translated(first);
      if (!commands.length) commands.push({ type: "move", to: translatedFirst });
      const firstCommandIndex = commands.length;
      for (let index = 0; index < anchors.length - 1; index += 1) {
        const from = anchors[index];
        const to = anchors[index + 1];
        if (
          (from.motionToNext ?? segment.motion) === "bezier" &&
          from.controlOut &&
          to.controlIn
        ) {
          const translatedFrom = translated(from.position);
          const translatedControl1 = translated(from.controlOut);
          const translatedControl2 = translated(to.controlIn);
          const translatedTo = translated(to.position);
          commands.push({
            type: "bezier",
            from: translatedFrom,
            control1: translatedControl1,
            control2: translatedControl2,
            to: translatedTo,
          });
        } else {
          const translatedFrom = translated(from.position);
          const translatedTo = translated(to.position);
          commands.push({ type: "line", from: translatedFrom, to: translatedTo });
        }
      }
      if (previousEnd && firstCommandIndex < commands.length) {
        smoothJoin(firstCommandIndex - 1, firstCommandIndex, translatedFirst);
      }
      previousEnd = translated(anchors[anchors.length - 1].position);
    });

    commands.forEach((command) => {
      if (command.type === "move") {
        boundsPoints.push(command.to);
        return;
      }
      boundsPoints.push(command.from);
      if (command.type === "line") {
        boundsPoints.push(command.to);
        return;
      }
      for (let step = 1; step <= 24; step += 1) {
        boundsPoints.push(
          cubicPoint(
            command.from,
            command.control1,
            command.control2,
            command.to,
            step / 24,
          ),
        );
      }
    });

    const xs = boundsPoints.map((value) => value.x);
    const ys = boundsPoints.map((value) => value.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pathWidth = Math.max(0, maxX - minX);
    const pathHeight = Math.max(0, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const documentInstructions = [
      ...(this.document?.instructions ?? []),
      ...(this.document?.timeline?.segments.flatMap(
        (segment) => segment.instructions ?? [],
      ) ?? []),
    ];
    const instructionScale =
      documentInstructions.reduce((maximum, instruction) => {
        if (instruction.category !== "transform" || instruction.type !== "scale") return maximum;
        return Math.max(maximum, Math.abs(instruction.from), Math.abs(instruction.to));
      }, 1);
    const frameScale = timeline.frames.reduce(
      (maximum, frame) => Math.max(maximum, Math.abs(frame.scale ?? 1)),
      1,
    );
    const assetFootprint =
      this.renderedAssetSize * Math.max(instructionScale, frameScale) * Math.SQRT2;
    const safePadding = 16;
    const availableWidth = Math.max(1, this.container.clientWidth - assetFootprint - safePadding * 2);
    const availableHeight = Math.max(1, this.container.clientHeight - assetFootprint - safePadding * 2);
    const widthScale = pathWidth > 0 ? availableWidth / pathWidth : Number.POSITIVE_INFINITY;
    const heightScale = pathHeight > 0 ? availableHeight / pathHeight : Number.POSITIVE_INFINITY;
    const availableScale = Math.min(widthScale, heightScale);
    const fitScale = Number.isFinite(availableScale)
      ? Math.max(0.01, availableScale)
      : 1;
    const fitPoint = (value: { x: number; y: number }) => ({
      x: (value.x - centerX) * fitScale,
      y: (value.y - centerY) * fitScale,
    });
    const path = commands
      .map((command) => {
        if (command.type === "move") return `M ${point(fitPoint(command.to))}`;
        if (command.type === "line") return `L ${point(fitPoint(command.to))}`;
        return `C ${point(fitPoint(command.control1))}, ${point(fitPoint(command.control2))}, ${point(fitPoint(command.to))}`;
      })
      .join(" ");

    const pathLayer = this.layer("path");
    pathLayer.style.offsetPath = `path("${path}")`;
    pathLayer.style.offsetRotate = "0deg";
    let elapsed = 0;
    const pathFrames: Keyframe[] = [
      { offset: 0, offsetDistance: "0%" },
      { offset: 1, offsetDistance: "100%" },
    ];
    const timelineFrames: Array<{ frame: MipMotionFrame; offset: number }> = [
      { frame: segments[0].start, offset: 0 },
    ];
    segments.forEach((entry) => {
      elapsed += Math.max(1, entry.segment.duration);
      timelineFrames.push({ frame: entry.end, offset: elapsed / totalDuration });
    });

    const options: KeyframeAnimationOptions = {
      duration: totalDuration,
      delay: Math.max(0, timeline.delay ?? 0),
      iterations: timeline.loop ? Infinity : 1,
      easing: "linear",
      fill: "both",
    };
    const animations = [pathLayer.animate(pathFrames, options)];
    const animateFrameProperty = (
      layer: LayerName,
      property: "scale" | "rotation" | "opacity",
      render: (value: number) => Keyframe,
      fallback: number,
    ) => {
      if (!timelineFrames.some(({ frame }) => frame[property] !== undefined)) return;
      let current = fallback;
      animations.push(
        this.layer(layer).animate(
          timelineFrames.map(({ frame, offset }) => {
            current = frame[property] ?? current;
            return { ...render(current), offset };
          }),
          options,
        ),
      );
    };
    animateFrameProperty("scale", "scale", (value) => ({ transform: `scale(${value})` }), 1);
    animateFrameProperty("rotate", "rotation", (value) => ({ transform: `rotate(${value}deg)` }), 0);
    animateFrameProperty("opacity", "opacity", (value) => ({ opacity: value }), 1);
    return animations;
  }

  private animateEffect(
    instruction: MipEffectInstruction,
    options: KeyframeAnimationOptions,
  ) {
    if (instruction.type === "shake") {
      const intensity = (instruction.intensity ?? 12) * this.spatialScale;
      return [
        this.layer("shake").animate(
          [0, -1, 1, -0.75, 0.75, 0].map((factor) => ({
            transform: `translateX(${factor * intensity}px)`,
          })),
          options,
        ),
      ];
    }
    if (instruction.type === "pulse") {
      const scale = instruction.scale ?? 1.24;
      return [
        this.layer("pulse").animate(
          [
            { transform: "scale(1)" },
            { transform: `scale(${scale})` },
            { transform: "scale(1)" },
          ],
          options,
        ),
      ];
    }
    if (instruction.type === "blur") {
      const radius = (instruction.radius ?? 10) * this.spatialScale;
      return [
        this.layer("blur").animate(
          [
            { filter: "blur(0px)" },
            { filter: `blur(${radius}px)` },
            { filter: "blur(0px)" },
          ],
          options,
        ),
      ];
    }
    if (instruction.type === "glow") {
      const color = instruction.color ?? "#22d3ee";
      const radius = (instruction.radius ?? 18) * this.spatialScale;
      return [
        this.layer("glow").animate(
          [
            { filter: `drop-shadow(0 0 0 ${color})` },
            { filter: `drop-shadow(0 0 ${radius}px ${color})` },
            { filter: `drop-shadow(0 0 2px ${color})` },
          ],
          options,
        ),
      ];
    }
    return this.animateParticles(instruction, options);
  }

  private animateParticles(
    instruction: Extract<MipEffectInstruction, { type: "particle" }>,
    options: KeyframeAnimationOptions,
  ) {
    const count = Math.min(60, Math.max(1, instruction.count ?? 18));
    const spread = Math.max(4, (instruction.spread ?? 110) * this.spatialScale);
    const animations: Animation[] = [];
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("span");
      particle.className = "mip-particle";
      particle.style.position = "absolute";
      particle.style.left = "50%";
      particle.style.top = "50%";
      particle.style.width = `${Math.max(2, (3 + (index % 4)) * this.spatialScale)}px`;
      particle.style.height = particle.style.width;
      particle.style.borderRadius = "50%";
      particle.style.background = instruction.color ?? "#fbbf24";
      particle.style.pointerEvents = "none";
      this.container.appendChild(particle);
      this.particleElements.push(particle);
      const angle = (Math.PI * 2 * index) / count + (index % 3) * 0.16;
      const distance = spread * (0.45 + ((index * 37) % 55) / 100);
      animations.push(
        particle.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.4)", opacity: 0 },
            { offset: 0.16, opacity: 1 },
            {
              transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0)`,
              opacity: 0,
            },
          ],
          {
            ...options,
            delay: Number(options.delay ?? 0) + (index % 6) * 24,
            iterations: 1,
          },
        ),
      );
    }
    return animations;
  }
}
