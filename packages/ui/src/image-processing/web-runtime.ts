"use client";

import {
  ImageProcessingError,
  validateImageParameterDocument,
  type ImageMetadata,
  type ImageOutputFormat,
  type ImageParameterDocument,
} from "@picbind/shared";
import { generateSharePlaceholder } from "../utils/share-placeholder";
import { generateShareThumbnail } from "../utils/share-thumbnail";
import { compressWorkspaceImageTask } from "../utils/workspace-image-compression-task";
import { convertWorkspaceImageTask } from "../utils/workspace-image-conversion";
import { encodeWorkspaceImageData, type WorkspaceCompressionFormat } from "../utils/workspace-image-compression";
import { initWasm } from "../utils/wasm-runtime";

type WasmImageMetadata = {
  width: number;
  height: number;
  format: ImageMetadata["format"];
};

type MaterializedPixelsHandle = {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  free(): void;
};

function mimeTypeForFormat(format: ImageMetadata["format"], fallback: string) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (format === "avif") return "image/avif";
  if (format === "gif") return "image/gif";
  if (format === "bmp") return "image/bmp";
  if (format === "ico") return "image/x-icon";
  return fallback || "application/octet-stream";
}

function imageDataFromHandle(handle: MaterializedPixelsHandle) {
  try {
    return new ImageData(
      new Uint8ClampedArray(handle.bytes),
      handle.width,
      handle.height,
    );
  } finally {
    handle.free();
  }
}

export async function inspectWebImage(blob: Blob): Promise<ImageMetadata> {
  try {
    const mod = await initWasm();
    const metadata = mod.read_image_metadata(
      new Uint8Array(await blob.arrayBuffer()),
    ) as WasmImageMetadata;
    if (!Number.isInteger(metadata.width) || metadata.width < 1
      || !Number.isInteger(metadata.height) || metadata.height < 1) {
      throw new Error("WASM returned invalid image dimensions");
    }
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      mimeType: mimeTypeForFormat(metadata.format, blob.type),
      sizeBytes: blob.size,
      orientationApplied: true,
    };
  } catch (error) {
    throw new ImageProcessingError("decodeFailed", "The image could not be decoded", undefined, { cause: error });
  }
}

export async function renderWebImagePreview(input: {
  blob: Blob;
  document: ImageParameterDocument;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}) {
  try {
    validateImageParameterDocument(input.document);
    const mod = await initWasm();
    const pixels = imageDataFromHandle(
      mod.render_image_operations_preview_to_rgba(
        new Uint8Array(await input.blob.arrayBuffer()),
        JSON.stringify(input.document),
        Math.round(input.maxWidth),
        Math.round(input.maxHeight),
      ) as MaterializedPixelsHandle,
    );
    const result = await encodeWorkspaceImageData(
      pixels,
      "webp",
      "preview.webp",
      input.blob.size,
      undefined,
      {
        quality: Math.max(1, Math.min(100, Math.round(input.quality * 100))),
        compressionGain: 1,
        forceEncode: true,
      },
    );
    return { blob: result.blob, width: pixels.width, height: pixels.height };
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
    const format = (() => {
      const mimeType = input.mimeType.toLowerCase();
      if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpeg";
      if (mimeType === "image/png") return "png";
      if (mimeType === "image/webp") return "webp";
      if (mimeType === "image/avif") return "avif";
      return null;
    })() satisfies Exclude<WorkspaceCompressionFormat, "auto"> | null;
    if (!format) throw new Error("The source format cannot be materialized");

    const mod = await initWasm();
    const documentJson = JSON.stringify(input.document);
    const pixels = imageDataFromHandle(
      mod.materialize_image_operations_to_rgba(
        new Uint8Array(await input.blob.arrayBuffer()),
        documentJson,
      ) as MaterializedPixelsHandle,
    );
    const defaults = format === "avif"
      ? { quality: 58, compressionGain: 1 }
      : format === "png"
        ? { quality: 78, compressionGain: 1.12 }
        : { quality: 78, compressionGain: format === "jpeg" ? 1.08 : 1 };
    const result = await encodeWorkspaceImageData(
      pixels,
      format,
      input.name,
      input.blob.size,
      undefined,
      {
        ...defaults,
        ...(input.quality === undefined ? null : { quality: input.quality }),
        forceEncode: true,
      },
    );
    return {
      blob: result.blob,
      name: result.name,
      mimeType: result.blob.type,
      width: result.width,
      height: result.height,
      returnedOriginal: false,
    };
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
    return await compressWorkspaceImageTask(
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
    return await convertWorkspaceImageTask(
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
