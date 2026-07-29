import { firstGrapheme } from "./emoji";
import {
  MIP_VERSION,
  type MipInstruction,
  type MipTimeline,
  type MotionIntentDocument,
} from "./types";

export function createMotionIntent(
  emoji: string,
  instructions: MipInstruction[],
  timeline?: MipTimeline,
): MotionIntentDocument {
  return {
    protocol: "MIP",
    version: MIP_VERSION,
    asset: { kind: "emoji", value: firstGrapheme(emoji) },
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
        Array.isArray(document.timeline.segments)))
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
