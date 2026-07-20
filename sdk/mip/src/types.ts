export const MIP_VERSION = "1.0" as const;

export type MipEasing =
  | "linear"
  | "ease"
  | "easeIn"
  | "easeOut"
  | "bounce"
  | "elastic";

export type MipTiming = {
  duration: number;
  delay?: number;
  repeat?: number;
  loop?: boolean;
  easing?: MipEasing;
};

export type MipPoint = { x: number; y: number };

export type MipMotionFrame = {
  id: string;
  label: string;
  position: MipPoint;
  scale?: number;
  rotation?: number;
  opacity?: number;
};

export type MipMotionSegment = {
  id: string;
  from: string;
  to: string;
  motion: "line" | "bezier";
  duration: number;
  easing?: MipEasing;
  control1?: MipPoint;
  control2?: MipPoint;
};

export type MipTimeline = {
  frames: MipMotionFrame[];
  segments: MipMotionSegment[];
  delay?: number;
  loop?: boolean;
};

type MipInstructionBase = {
  id: string;
  timing: MipTiming;
};

export type MipTransformInstruction = MipInstructionBase &
  (
    | {
        category: "transform";
        type: "translate";
        from: MipPoint;
        to: MipPoint;
      }
    | {
        category: "transform";
        type: "scale";
        from: number;
        to: number;
      }
    | {
        category: "transform";
        type: "rotate";
        from: number;
        to: number;
      }
    | {
        category: "transform";
        type: "skew";
        from: MipPoint;
        to: MipPoint;
      }
  );

export type MipMotionPathInstruction = MipInstructionBase &
  (
    | {
        category: "motionPath";
        type: "line";
        from: MipPoint;
        to: MipPoint;
      }
    | {
        category: "motionPath";
        type: "bezier";
        from: MipPoint;
        control1: MipPoint;
        control2: MipPoint;
        to: MipPoint;
      }
    | {
        category: "motionPath";
        type: "orbit";
        radius: number;
        startAngle?: number;
        turns?: number;
      }
  );

export type MipOpacityInstruction = MipInstructionBase & {
  category: "opacity";
  type: "fadeIn" | "fadeOut";
  from?: number;
  to?: number;
};

export type MipEffectInstruction = MipInstructionBase &
  (
    | { category: "effect"; type: "shake"; intensity?: number }
    | { category: "effect"; type: "pulse"; scale?: number }
    | { category: "effect"; type: "blur"; radius?: number }
    | {
        category: "effect";
        type: "glow";
        color?: string;
        radius?: number;
      }
    | {
        category: "effect";
        type: "particle";
        count?: number;
        color?: string;
        spread?: number;
      }
  );

export type MipInstruction =
  | MipTransformInstruction
  | MipMotionPathInstruction
  | MipOpacityInstruction
  | MipEffectInstruction;

export type MotionIntentDocument = {
  protocol: "MIP";
  version: typeof MIP_VERSION;
  asset: {
    kind: "emoji";
    value: string;
    ariaLabel?: string;
  };
  instructions: MipInstruction[];
  timeline?: MipTimeline;
};

export type EmojiSvgAsset = {
  emoji: string;
  svg: string;
  dataUrl: string;
  width: number;
  height: number;
};
