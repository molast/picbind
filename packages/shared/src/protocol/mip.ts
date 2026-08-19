import { firstGrapheme } from "../utils/emoji";
import {
  MIP_VERSION,
  type MipAnimationMode,
  type MipInstruction,
  type MipTimeline,
  type MipViewport,
  type MotionIntentDocument,
} from "../types/mip";

export function createMotionIntent(
  emoji: string,
  instructions: MipInstruction[],
  timeline?: MipTimeline,
  animationMode: MipAnimationMode = "synchronized",
  viewport?: MipViewport,
): MotionIntentDocument {
  return {
    protocol: "MIP",
    version: MIP_VERSION,
    asset: { kind: "emoji", value: firstGrapheme(emoji) },
    animationMode,
    ...(viewport ? { viewport } : {}),
    instructions,
    ...(timeline ? { timeline } : {}),
  };
}

export function validateMotionIntent(value: unknown): value is MotionIntentDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<MotionIntentDocument>;
  return (
    document.protocol === "MIP" &&
    document.version === MIP_VERSION &&
    document.asset?.kind === "emoji" &&
    typeof document.asset.value === "string" &&
    (!document.animationMode ||
      document.animationMode === "synchronized" ||
      document.animationMode === "perSegment") &&
    (!document.viewport ||
      (Number.isFinite(document.viewport.width) &&
        document.viewport.width > 0 &&
        Number.isFinite(document.viewport.height) &&
        document.viewport.height > 0)) &&
    Array.isArray(document.instructions) &&
    document.instructions.every(
      (instruction) =>
        instruction &&
        typeof instruction.id === "string" &&
        typeof instruction.category === "string" &&
        typeof instruction.type === "string" &&
        Number.isFinite(instruction.timing?.duration) &&
        instruction.timing.duration >= 0,
    ) &&
    (!document.timeline ||
      (Array.isArray(document.timeline.frames) &&
        document.timeline.frames.length >= 2 &&
        Array.isArray(document.timeline.segments) &&
        document.timeline.segments.every(
          (segment) =>
            !segment.instructions ||
            (Array.isArray(segment.instructions) &&
              segment.instructions.every(
                (instruction) =>
                  instruction &&
                  typeof instruction.id === "string" &&
                  typeof instruction.category === "string" &&
                  typeof instruction.type === "string" &&
                  Number.isFinite(instruction.timing?.duration) &&
                  instruction.timing.duration >= 0,
              )),
        )))
  );
}

export function serializeMotionIntent(document: MotionIntentDocument) {
  return JSON.stringify(document, null, 2);
}

export function parseMotionIntent(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!validateMotionIntent(parsed)) {
    throw new Error("Invalid Motion Intent Protocol document");
  }
  return parsed;
}
