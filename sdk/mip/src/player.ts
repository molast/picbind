import { emojiToSvg } from "./emoji";
import type {
  MipEffectInstruction,
  MipInstruction,
  MipMotionFrame,
  MipMotionPathInstruction,
  MipMotionSegment,
  MipTiming,
  MipTimeline,
  MotionIntentDocument,
} from "./types";

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

function animationOptions(timing: MipTiming): KeyframeAnimationOptions {
  return {
    duration: Math.max(0, timing.duration),
    delay: Math.max(0, timing.delay ?? 0),
    iterations: timing.loop ? Infinity : Math.max(1, (timing.repeat ?? 0) + 1),
    easing: EASINGS[timing.easing ?? "ease"],
    fill: "both",
  };
}

function point(point: { x: number; y: number }) {
  return `${point.x} ${point.y}`;
}

function motionPath(instruction: MipMotionPathInstruction) {
  if (instruction.type === "line") {
    return `path("M ${point(instruction.from)} L ${point(instruction.to)}")`;
  }
  if (instruction.type === "bezier") {
    return `path("M ${point(instruction.from)} C ${point(instruction.control1)}, ${point(instruction.control2)}, ${point(instruction.to)}")`;
  }
  const radius = Math.max(1, instruction.radius);
  const angle = ((instruction.startAngle ?? -90) * Math.PI) / 180;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const oppositeX = -x;
  const oppositeY = -y;
  return `path("M ${x} ${y} A ${radius} ${radius} 0 1 1 ${oppositeX} ${oppositeY} A ${radius} ${radius} 0 1 1 ${x} ${y}")`;
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(right.x - left.x, right.y - left.y);
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

function segmentLength(
  segment: MipMotionSegment,
  start: MipMotionFrame,
  end: MipMotionFrame,
) {
  if (segment.motion === "line" || !segment.control1 || !segment.control2) {
    return distance(start.position, end.position);
  }
  let length = 0;
  let previous = start.position;
  for (let step = 1; step <= 16; step += 1) {
    const current = cubicPoint(
      start.position,
      segment.control1,
      segment.control2,
      end.position,
      step / 16,
    );
    length += distance(previous, current);
    previous = current;
  }
  return length;
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

  constructor(container: HTMLElement, options: MipPlayerOptions = {}) {
    this.container = container;
    this.options = options;
  }

  load(intent: MotionIntentDocument) {
    this.stop();
    this.document = intent;
    this.layers = new Map();
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
      size: this.options.assetSize ?? 104,
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

  private animateInstruction(instruction: MipInstruction): Animation[] {
    const options = animationOptions(instruction.timing);
    if (instruction.category === "transform") {
      if (instruction.type === "translate") {
        return [
          this.layer("translate").animate(
            [
              { transform: `translate(${instruction.from.x}px, ${instruction.from.y}px)` },
              { transform: `translate(${instruction.to.x}px, ${instruction.to.y}px)` },
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
      layer.style.offsetPath = motionPath(instruction);
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
    const lengths = segments.map((entry) =>
      Math.max(0.001, segmentLength(entry.segment, entry.start, entry.end)),
    );
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    let path = `M ${point(segments[0].start.position)}`;
    segments.forEach(({ segment, end }) => {
      if (segment.motion === "bezier" && segment.control1 && segment.control2) {
        path += ` C ${point(segment.control1)}, ${point(segment.control2)}, ${point(end.position)}`;
      } else {
        path += ` L ${point(end.position)}`;
      }
    });

    const pathLayer = this.layer("path");
    pathLayer.style.offsetPath = `path("${path}")`;
    pathLayer.style.offsetRotate = "0deg";
    let elapsed = 0;
    let traversed = 0;
    const pathFrames: Keyframe[] = [
      {
        offset: 0,
        offsetDistance: "0%",
        easing: EASINGS[segments[0].segment.easing ?? "ease"],
      },
    ];
    const timelineFrames: Array<{ frame: MipMotionFrame; offset: number }> = [
      { frame: segments[0].start, offset: 0 },
    ];
    segments.forEach((entry, index) => {
      elapsed += Math.max(1, entry.segment.duration);
      traversed += lengths[index];
      pathFrames.push({
        offset: elapsed / totalDuration,
        offsetDistance: `${(traversed / totalLength) * 100}%`,
        easing:
          index + 1 < segments.length
            ? EASINGS[segments[index + 1].segment.easing ?? "ease"]
            : "linear",
      });
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
      const intensity = instruction.intensity ?? 12;
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
      const radius = instruction.radius ?? 10;
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
      const radius = instruction.radius ?? 18;
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
    const spread = Math.max(10, instruction.spread ?? 110);
    const animations: Animation[] = [];
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("span");
      particle.className = "mip-particle";
      particle.style.position = "absolute";
      particle.style.left = "50%";
      particle.style.top = "50%";
      particle.style.width = `${3 + (index % 4)}px`;
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
