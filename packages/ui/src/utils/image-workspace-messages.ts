"use client";

import type { ImageObjectMetadata } from "./image-object";
import type { ImagePlaceholderMetadata } from "./share-placeholder";
import type { RealtimeMessageChannel } from "./weak-network-socket";

export type ImageShareDescriptor = ImageObjectMetadata & {
  imageId: string;
  name: string;
  type: string;
  size: number;
};

export type ImageShareRequest = {
  type: "IMAGE_SHARE_REQUEST";
  payload: {
    requestId: string;
    sourceImageId: string;
    image: ImageShareDescriptor;
    placeholder?: ImagePlaceholderMetadata;
  };
};

export type ImageShareResponse = {
  type: "IMAGE_SHARE_RESPONSE";
  payload: {
    requestId: string;
    imageId: string;
    decision: "accept" | "reject";
  };
};

export type ImageReactionBatch = {
  type: "IMAGE_REACTION_BATCH";
  payload: {
    events: Array<{ imageId: string; count: number }>;
  };
};

export type ImageWanted = {
  type: "IMAGE_WANTED";
  payload: {
    imageId: string;
    wanted: boolean;
  };
};

export type ImageWorkspaceMessage =
  | ImageShareRequest
  | ImageShareResponse
  | ImageReactionBatch
  | ImageWanted;

function validId(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function parseImageWorkspaceMessage(value: string) {
  let message: unknown;
  try {
    message = JSON.parse(value);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") return null;
  const candidate = message as Partial<ImageWorkspaceMessage> & {
    payload?: Record<string, unknown>;
  };
  const payload = candidate.payload;
  if (!payload) {
    return null;
  }
  if (candidate.type === "IMAGE_REACTION_BATCH") {
    const events = payload.events;
    return Array.isArray(events) &&
      events.length > 0 &&
      events.length <= 12 &&
      events.every((event) => {
        if (!event || typeof event !== "object") return false;
        const item = event as Record<string, unknown>;
        return validId(item.imageId) &&
          Number.isSafeInteger(item.count) &&
          Number(item.count) >= 1 &&
          Number(item.count) <= 100;
      })
      ? (candidate as ImageReactionBatch)
      : null;
  }
  if (candidate.type === "IMAGE_WANTED") {
    return validId(payload.imageId) && typeof payload.wanted === "boolean"
      ? (candidate as ImageWanted)
      : null;
  }
  if (!validId(payload.requestId) || !validId(payload.imageId ?? payload.sourceImageId)) {
    return null;
  }
  if (candidate.type === "IMAGE_SHARE_RESPONSE") {
    return validId(payload.imageId) &&
      (payload.decision === "accept" || payload.decision === "reject")
      ? (candidate as ImageShareResponse)
      : null;
  }
  if (candidate.type !== "IMAGE_SHARE_REQUEST" || !validId(payload.sourceImageId)) {
    return null;
  }
  const image = payload.image as Partial<ImageShareDescriptor> | undefined;
  const placeholder = payload.placeholder as Partial<ImagePlaceholderMetadata> | undefined;
  const validPlaceholder =
    placeholder === undefined ||
    (Number.isSafeInteger(placeholder.width) &&
      Number(placeholder.width) > 0 &&
      Number.isSafeInteger(placeholder.height) &&
      Number(placeholder.height) > 0 &&
      typeof placeholder.dominantColor === "string" &&
      /^#[0-9a-f]{6}$/i.test(placeholder.dominantColor) &&
      typeof placeholder.blurHash === "string" &&
      placeholder.blurHash.length >= 6);
  return image &&
    validPlaceholder &&
    validId(image.imageId) &&
    validId(image.rootImageId) &&
    (image.parentImageId === null || validId(image.parentImageId)) &&
    typeof image.name === "string" &&
    image.name.length > 0 &&
    image.name.length <= 255 &&
    typeof image.type === "string" &&
    image.type.startsWith("image/") &&
    Number.isSafeInteger(image.size) &&
    Number(image.size) >= 0 &&
    Number.isSafeInteger(image.version) &&
    Number(image.version) >= 1 &&
    (image.createdAt === undefined ||
      (Number.isSafeInteger(image.createdAt) && Number(image.createdAt) > 0)) &&
    (image.updatedAt === undefined ||
      (Number.isSafeInteger(image.updatedAt) && Number(image.updatedAt) > 0)) &&
    (image.likeCount === undefined ||
      (Number.isSafeInteger(image.likeCount) && Number(image.likeCount) >= 0))
    ? (candidate as ImageShareRequest)
    : null;
}

export function sendImageWorkspaceMessage(
  channel: RealtimeMessageChannel | null,
  message: ImageWorkspaceMessage,
) {
  if (channel?.readyState !== "open") return false;
  const serialized = JSON.stringify(message);
  if (new TextEncoder().encode(serialized).byteLength > 1200) {
    throw new Error("Image workspace instruction exceeds 1200 bytes");
  }
  channel.send(serialized);
  return true;
}
