"use client";

import {
  ImageProcessingError,
  validateImageParameterDocument,
  type ImageMetadata,
  type ImageOperation,
  type ImageOutputFormat,
  type ImageParameterDocument,
} from "@picbind/shared";
import { generateSharePlaceholder } from "../utils/share-placeholder";
import { generateShareThumbnail } from "../utils/share-thumbnail";
import { compressRoomImageTask } from "../utils/room-image-compression-task";
import { convertRoomImageTask } from "../utils/room-image-conversion";
import { renderWorkspaceParameterPreview } from "../workspace/parameter-preview";
import { replayOperations } from "../workspace/utils/workspace-operation-replay";
import { dimensions } from "../workspace/utils/workspace-image-display";
import type { WorkspaceImage, WorkspaceOperation } from "../workspace/types";

function inputFormat(mimeType: string): ImageMetadata["format"] {
  const value = mimeType.toLowerCase();
  if (value === "image/jpeg" || value === "image/jpg") return "jpeg";
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  if (value === "image/avif") return "avif";
  if (value === "image/gif") return "gif";
  if (value === "image/bmp") return "bmp";
  if (value === "image/x-icon" || value === "image/vnd.microsoft.icon") return "ico";
  return "unknown";
}

function workspaceOperationType(operation: ImageOperation): WorkspaceOperation["type"] {
  if (operation.type === "crop" || operation.type === "resize" || operation.type === "rotate") {
    return operation.type;
  }
  if (operation.type === "color") {
    const legacy = operation.params.workspaceOperationType;
    return legacy === "brightness" || legacy === "contrast" || legacy === "saturation"
      ? legacy
      : "brightness";
  }
  return "other";
}

export function toWorkspaceOperations(document: ImageParameterDocument): WorkspaceOperation[] {
  validateImageParameterDocument(document);
  return document.operations.map((operation) => ({
    operationId: operation.id,
    imageId: "image-processing",
    authorId: operation.userId,
    baseCommitId: "source",
    type: workspaceOperationType(operation),
    parameters: operation.params,
    createdAt: operation.time,
  }));
}

export async function inspectWebImage(blob: Blob): Promise<ImageMetadata> {
  try {
    const size = await dimensions(blob);
    return {
      ...size,
      format: inputFormat(blob.type),
      mimeType: blob.type || "application/octet-stream",
      sizeBytes: blob.size,
      orientationApplied: true,
    };
  } catch (error) {
    throw new ImageProcessingError("decodeFailed", "The image could not be decoded", undefined, { cause: error });
  }
}

export async function renderWebImagePreview(input: {
  blob: Blob;
  metadata: Pick<ImageMetadata, "width" | "height">;
  document: ImageParameterDocument;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}) {
  try {
    return await renderWorkspaceParameterPreview(
      input.blob,
      input.metadata,
      toWorkspaceOperations(input.document),
      { maxWidth: input.maxWidth, maxHeight: input.maxHeight, quality: input.quality },
    );
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("renderFailed", "The image preview could not be rendered", undefined, { cause: error });
  }
}

export async function materializeWebImage(input: {
  blob: Blob;
  name: string;
  mimeType: string;
  metadata: Pick<ImageMetadata, "width" | "height">;
  document: ImageParameterDocument;
  quality?: number;
}) {
  if (input.document.operations.length === 0) {
    return {
      blob: input.blob,
      name: input.name,
      mimeType: input.mimeType,
      width: input.metadata.width,
      height: input.metadata.height,
      returnedOriginal: true,
    };
  }
  try {
    const image: WorkspaceImage = {
      imageId: "image-processing",
      workspaceId: "image-processing",
      name: input.name,
      mimeType: input.mimeType,
      size: input.blob.size,
      width: input.metadata.width,
      height: input.metadata.height,
      workspaceLocation: "working",
      state: "working",
      shared: false,
      currentCommitId: null,
      previewRevision: 0,
      createdAt: 0,
      updatedAt: 0,
      source: input.blob,
    };
    const result = await replayOperations(
      image,
      toWorkspaceOperations(input.document),
      input.quality === undefined
        ? undefined
        : { quality: input.quality, compressionGain: 1, forceEncode: true },
    );
    return { ...result, returnedOriginal: false };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("renderFailed", "The image could not be materialized", undefined, { cause: error });
  }
}

export async function compressWebImage(input: {
  blob: Blob;
  name: string;
  format: "auto" | ImageOutputFormat;
  signal: AbortSignal;
  dimensions?: { width: number; height: number };
  allowAlphaLoss?: boolean;
  quality?: number;
  compressionGain?: number;
  forceEncode?: boolean;
}) {
  if (input.format === "jxl") {
    throw new ImageProcessingError(
      "unsupportedOutputFormat",
      "JPEG XL encoding is only available in the Desktop Native engine",
    );
  }
  try {
    return await compressRoomImageTask(
      new File([input.blob], input.name, { type: input.blob.type }),
      input.format,
      input.signal,
      input.dimensions,
      input.allowAlphaLoss,
      {
        quality: input.quality,
        compressionGain: input.compressionGain,
        forceEncode: input.forceEncode,
      },
    );
  } catch (error) {
    if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ImageProcessingError("cancelled", "Image processing was cancelled", undefined, { cause: error });
    }
    throw new ImageProcessingError("encodeFailed", "The image could not be compressed", undefined, { cause: error });
  }
}

export async function convertWebImage(input: {
  blob: Blob;
  name: string;
  format: ImageOutputFormat;
  signal: AbortSignal;
  allowAlphaLoss?: boolean;
  quality?: number;
}) {
  if (input.format === "jxl") {
    throw new ImageProcessingError(
      "unsupportedOutputFormat",
      "JPEG XL encoding is only available in the Desktop Native engine",
    );
  }
  try {
    if (input.format === "jpeg" && !input.allowAlphaLoss) {
      return await compressWebImage({ ...input, signal: input.signal });
    }
    return await convertRoomImageTask(
      new File([input.blob], input.name, { type: input.blob.type }),
      input.format,
      input.signal,
      input.quality === undefined
        ? undefined
        : { quality: input.quality, compressionGain: 1, forceEncode: true },
    );
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new ImageProcessingError("cancelled", "Image processing was cancelled", undefined, { cause: error });
    }
    throw new ImageProcessingError("encodeFailed", "The image could not be converted", undefined, { cause: error });
  }
}

export async function createWebShareAssets(
  blob: Blob,
  container: { width: number; height: number },
) {
  const [placeholder, thumbnailBytes] = await Promise.all([
    generateSharePlaceholder(blob),
    generateShareThumbnail(blob, container.width, container.height),
  ]);
  const bytes = thumbnailBytes.buffer.slice(
    thumbnailBytes.byteOffset,
    thumbnailBytes.byteOffset + thumbnailBytes.byteLength,
  ) as ArrayBuffer;
  return {
    placeholder,
    thumbnail: new Blob([bytes], { type: "image/webp" }),
  };
}
