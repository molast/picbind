"use client";

import type { RealtimeMessageChannel } from "./weak-network-socket";

export type ReviewTool =
  | "select"
  | "hand"
  | "magnifier"
  | "arrow"
  | "line"
  | "rectangle"
  | "circle"
  | "pen"
  | "text"
  | "emoji";

export type ReviewMode = "present" | "follow" | null;
export type ReviewStrokeStyle = "solid" | "dashed" | "dotted";

export type ReviewAnnotation = {
  id: string;
  type: Exclude<ReviewTool, "select" | "hand" | "magnifier">;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  points?: number[];
  text?: string;
  emoji?: string;
  stroke: string;
  fill?: string | null;
  strokeWidth: number;
  strokeStyle?: ReviewStrokeStyle;
  createdBy: string;
};

export type ReviewOperation = {
  id: string;
  actorId: string;
  kind: "create" | "update" | "delete";
  annotationId: string;
  before: ReviewAnnotation | null;
  after: ReviewAnnotation | null;
  createdAt: number;
};

type ReviewMessageBase = {
  imageId: string;
  actorId: string;
};

export type ReviewGeometryContext = {
  imageWidth: number;
  imageHeight: number;
  canvasWidth: number;
  canvasHeight: number;
};

export type ReviewCollaborationMessage =
  | (ReviewMessageBase & {
      type: "REVIEW_PRESENCE";
      active: boolean;
      request: boolean;
    })
  | (ReviewMessageBase & {
      type: "REVIEW_MODE";
      mode: ReviewMode;
    })
  | (ReviewMessageBase & {
      type: "REVIEW_OPERATION";
      operation: ReviewOperation;
    } & ReviewGeometryContext)
  | (ReviewMessageBase & {
      type: "REVIEW_CURSOR";
      cursor: number;
    })
  | (ReviewMessageBase & { type: "REVIEW_STATE_REQUEST" })
  | (ReviewMessageBase & {
      type: "REVIEW_STATE_BEGIN";
      transferId: string;
      total: number;
      cursor: number;
    } & ReviewGeometryContext)
  | (ReviewMessageBase & {
      type: "REVIEW_STATE_OPERATION";
      transferId: string;
      index: number;
      operation: ReviewOperation;
    })
  | (ReviewMessageBase & {
      type: "REVIEW_STATE_END";
      transferId: string;
    })
  | (ReviewMessageBase & {
      type: "REVIEW_VIEWPORT";
      scale: number;
      offsetX: number;
      offsetY: number;
      imageWidth: number;
      imageHeight: number;
      canvasWidth: number;
      canvasHeight: number;
    });

const REVIEW_MESSAGE_TYPES = new Set([
  "REVIEW_PRESENCE",
  "REVIEW_MODE",
  "REVIEW_OPERATION",
  "REVIEW_CURSOR",
  "REVIEW_STATE_REQUEST",
  "REVIEW_STATE_BEGIN",
  "REVIEW_STATE_OPERATION",
  "REVIEW_STATE_END",
  "REVIEW_VIEWPORT",
]);

function validId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function validFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function validAnnotation(value: unknown): value is ReviewAnnotation {
  if (!value || typeof value !== "object") return false;
  const annotation = value as Partial<ReviewAnnotation>;
  return (
    validId(annotation.id) &&
    ["arrow", "line", "rectangle", "circle", "pen", "text", "emoji"].includes(
      annotation.type || "",
    ) &&
    validFinite(annotation.x) &&
    validFinite(annotation.y) &&
    validFinite(annotation.width) &&
    validFinite(annotation.height) &&
    validFinite(annotation.scaleX) &&
    validFinite(annotation.scaleY) &&
    validFinite(annotation.rotation) &&
    typeof annotation.stroke === "string" &&
    /^#[0-9a-f]{6}$/i.test(annotation.stroke) &&
    (annotation.fill === undefined ||
      annotation.fill === null ||
      (typeof annotation.fill === "string" &&
        /^#[0-9a-f]{6}$/i.test(annotation.fill))) &&
    validFinite(annotation.strokeWidth) &&
    (!annotation.strokeStyle ||
      ["solid", "dashed", "dotted"].includes(annotation.strokeStyle)) &&
    validId(annotation.createdBy) &&
    (!annotation.points ||
      (annotation.points.length <= 512 && annotation.points.every(validFinite))) &&
    (!annotation.text || annotation.text.length <= 500) &&
    (!annotation.emoji || annotation.emoji.length <= 16)
  );
}

function validOperation(value: unknown): value is ReviewOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<ReviewOperation>;
  return (
    validId(operation.id) &&
    validId(operation.actorId) &&
    ["create", "update", "delete"].includes(operation.kind || "") &&
    validId(operation.annotationId) &&
    (operation.before === null || validAnnotation(operation.before)) &&
    (operation.after === null || validAnnotation(operation.after)) &&
    validFinite(operation.createdAt)
  );
}

function validGeometryContext(message: Record<string, unknown>) {
  return (
    validFinite(message.imageWidth) &&
    Number(message.imageWidth) > 0 &&
    validFinite(message.imageHeight) &&
    Number(message.imageHeight) > 0 &&
    validFinite(message.canvasWidth) &&
    Number(message.canvasWidth) > 0 &&
    validFinite(message.canvasHeight) &&
    Number(message.canvasHeight) > 0
  );
}

export function parseReviewCollaborationMessage(
  data: string,
): ReviewCollaborationMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as Record<string, unknown>;
  if (
    message.type === "REVIEW_PRESENCE" &&
    (typeof message.active !== "boolean" || typeof message.request !== "boolean")
  ) {
    return null;
  }
  if (
    typeof message.type !== "string" ||
    !REVIEW_MESSAGE_TYPES.has(message.type) ||
    !validId(message.imageId) ||
    !validId(message.actorId)
  ) {
    return null;
  }
  if (
    message.type === "REVIEW_MODE" &&
    message.mode !== null &&
    message.mode !== "present" &&
    message.mode !== "follow"
  ) {
    return null;
  }
  if (
    message.type === "REVIEW_CURSOR" &&
    (!Number.isInteger(message.cursor) ||
      Number(message.cursor) < 0 ||
      Number(message.cursor) > 5000)
  ) {
    return null;
  }
  if (
    message.type === "REVIEW_STATE_BEGIN" &&
    (!validId(message.transferId) ||
      !Number.isInteger(message.total) ||
      Number(message.total) < 0 ||
      Number(message.total) > 5000 ||
      !Number.isInteger(message.cursor) ||
      Number(message.cursor) < 0 ||
      Number(message.cursor) > Number(message.total))
  ) {
    return null;
  }
  if (
    message.type === "REVIEW_STATE_OPERATION" &&
    (!validId(message.transferId) ||
      !Number.isInteger(message.index) ||
      Number(message.index) < 0 ||
      Number(message.index) >= 5000)
  ) {
    return null;
  }
  if (
    message.type === "REVIEW_STATE_END" &&
    !validId(message.transferId)
  ) {
    return null;
  }
  if (
    message.type === "REVIEW_VIEWPORT" &&
    (!validFinite(message.scale) ||
      Number(message.scale) < 0.1 ||
      Number(message.scale) > 10 ||
      !validFinite(message.offsetX) ||
      !validFinite(message.offsetY) ||
      !validFinite(message.imageWidth) ||
      Number(message.imageWidth) <= 0 ||
      !validFinite(message.imageHeight) ||
      Number(message.imageHeight) <= 0 ||
      !validFinite(message.canvasWidth) ||
      Number(message.canvasWidth) <= 0 ||
      !validFinite(message.canvasHeight) ||
      Number(message.canvasHeight) <= 0)
  ) {
    return null;
  }
  if (
    (message.type === "REVIEW_OPERATION" ||
      message.type === "REVIEW_STATE_OPERATION") &&
    !validOperation(message.operation)
  ) {
    return null;
  }
  if (
    (message.type === "REVIEW_OPERATION" ||
      message.type === "REVIEW_STATE_BEGIN") &&
    !validGeometryContext(message)
  ) {
    return null;
  }
  return message as unknown as ReviewCollaborationMessage;
}

export function sendReviewCollaborationMessage(
  channel: RealtimeMessageChannel | null,
  message: ReviewCollaborationMessage,
) {
  if (channel?.readyState !== "open") return false;
  const payload = JSON.stringify(message);
  if (new TextEncoder().encode(payload).byteLength > 15 * 1024) return false;
  channel.send(payload);
  return true;
}

export function reviewAnnotationsAtCursor(
  operations: ReviewOperation[],
  cursor: number,
) {
  const annotations = new Map<string, ReviewAnnotation>();
  for (const operation of operations.slice(0, cursor)) {
    if (operation.after) annotations.set(operation.annotationId, operation.after);
    else annotations.delete(operation.annotationId);
  }
  return [...annotations.values()];
}
