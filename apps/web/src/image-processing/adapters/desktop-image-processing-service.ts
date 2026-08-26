"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  IMAGE_PROCESSING_API_VERSION,
  ImageProcessingError,
  validateImageProcessingSource,
  type CompressImageRequest,
  type ConvertImageRequest,
  type ImageMetadata,
  type ImageOutputFormat,
  type ImageProcessingCapabilities,
  type ImageProcessingResult,
  type ImageProcessingService,
  type ImageProcessingSource,
  type ImageTaskContext,
} from "@picbind/shared";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const capabilities: ImageProcessingCapabilities = {
  apiVersion: IMAGE_PROCESSING_API_VERSION,
  engine: "desktop-native",
  inputFormats: ["jpeg", "png", "webp", "avif"],
  outputFormats: ["jpeg", "png", "webp", "avif"],
  parameterOperations: [],
  supportsStoredSources: true,
  supportsProgress: true,
  supportsCancellation: false,
  supportsQualityAnalysis: false,
  maxInputBytes: 50 * 1024 * 1024,
  maxPixels: 100_000_000,
  implementation: "picbind-image-native/1",
};

type NativeResponse = {
  metadata: ImageMetadata;
  returnedOriginal: boolean;
  dataLength: number;
  implementation: string;
};

type NativeCommandError = {
  code?: string;
  message?: string;
};

function report(
  context: ImageTaskContext | undefined,
  stage: Parameters<NonNullable<ImageTaskContext["onProgress"]>>[0]["stage"],
) {
  context?.onProgress?.({ stage, completed: stage === "completed" ? 1 : 0, total: 1 });
}

function checkContext(context?: ImageTaskContext) {
  if (context && !context.requestId) {
    throw new ImageProcessingError("invalidRequest", "Image task requestId is required");
  }
  if (context?.signal?.aborted) {
    throw new ImageProcessingError("cancelled", "Image processing was cancelled");
  }
}

function outputName(name: string, format: ImageOutputFormat) {
  const extension = format === "jpeg" ? "jpg" : format;
  return `${name.replace(/\.[^.]+$/, "") || "image"}.${extension}`;
}

async function encodeSource(source: ImageProcessingSource) {
  validateImageProcessingSource(source);
  if (source.kind === "blob") {
    const bytes = new Uint8Array(await source.blob.arrayBuffer());
    return { source: { kind: "inline" }, bytes };
  }
  return {
    source: {
      kind: "stored",
      scope: source.asset.scope,
      scopeKey: source.asset.scopeKey,
      id: source.asset.id,
      variant: source.asset.variant,
      revision: source.asset.revision,
    },
    bytes: new Uint8Array(),
  };
}

function toBytes(value: ArrayBuffer | Uint8Array | number[]) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function parseNativeError(error: unknown): ImageProcessingError {
  let parsed: NativeCommandError = {};
  try {
    const message = typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
    parsed = JSON.parse(message) as NativeCommandError;
  } catch {
    // The original error is retained as the cause below.
  }
  const code = (() => {
    switch (parsed.code) {
      case "sourceChanged": return "sourceChanged" as const;
      case "sourceUnavailable": return "sourceNotFound" as const;
      case "unsupportedFormat": return "unsupportedOutputFormat" as const;
      case "inputTooLarge": return "inputTooLarge" as const;
      case "decodeFailed": return "decodeFailed" as const;
      case "encodeFailed": return "encodeFailed" as const;
      case "alphaLossDenied": return "alphaLossForbidden" as const;
      case "invalidParameters":
      case "invalidSource": return "invalidRequest" as const;
      default: return "internal" as const;
    }
  })();
  return new ImageProcessingError(
    code,
    parsed.message || "Native image processing failed",
    parsed.code ? { nativeCode: parsed.code } : undefined,
    { cause: error },
  );
}

async function executeNative(
  metadata: Record<string, unknown>,
  source: ImageProcessingSource,
  context?: ImageTaskContext,
) {
  checkContext(context);
  report(context, "resolvingSource");
  const encodedSource = await encodeSource(source);
  checkContext(context);
  report(context, metadata.operation === "inspect" ? "decoding" : "encoding");
  const metadataBytes = encoder.encode(JSON.stringify({
    ...metadata,
    source: encodedSource.source,
    inlineLength: encodedSource.bytes.byteLength,
  }));
  const frame = new Uint8Array(4 + metadataBytes.byteLength + encodedSource.bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, metadataBytes.byteLength, true);
  frame.set(metadataBytes, 4);
  frame.set(encodedSource.bytes, 4 + metadataBytes.byteLength);

  let raw: ArrayBuffer | Uint8Array | number[];
  try {
    raw = await invoke<ArrayBuffer | Uint8Array | number[]>("image_processing_execute", frame);
  } catch (error) {
    throw parseNativeError(error);
  }
  checkContext(context);
  const response = toBytes(raw);
  if (response.byteLength < 4) {
    throw new ImageProcessingError("internal", "Native image response frame is invalid");
  }
  const metadataLength = new DataView(
    response.buffer,
    response.byteOffset,
    response.byteLength,
  ).getUint32(0, true);
  const metadataEnd = 4 + metadataLength;
  if (metadataEnd > response.byteLength) {
    throw new ImageProcessingError("internal", "Native image response metadata is invalid");
  }
  const result = JSON.parse(decoder.decode(response.subarray(4, metadataEnd))) as NativeResponse;
  const bytes = response.slice(metadataEnd);
  if (bytes.byteLength !== result.dataLength) {
    throw new ImageProcessingError("internal", "Native image response data is incomplete");
  }
  return { result, bytes };
}

export class DesktopImageProcessingService implements ImageProcessingService {
  readonly engine = "desktop-native" as const;

  constructor(private readonly webFallback: ImageProcessingService) {}

  async capabilities() {
    return capabilities;
  }

  async inspect(source: ImageProcessingSource, context?: ImageTaskContext) {
    const { result } = await executeNative({ operation: "inspect" }, source, context);
    report(context, "completed");
    return result.metadata;
  }

  renderPreview = this.webFallback.renderPreview.bind(this.webFallback);
  materialize = this.webFallback.materialize.bind(this.webFallback);
  compareQuality = this.webFallback.compareQuality.bind(this.webFallback);
  createShareAssets = this.webFallback.createShareAssets.bind(this.webFallback);
  releaseTemporary = this.webFallback.releaseTemporary.bind(this.webFallback);

  async compress(
    request: CompressImageRequest,
    context?: ImageTaskContext,
  ): Promise<ImageProcessingResult> {
    if (request.destination !== "memory") {
      throw new ImageProcessingError("capabilityUnavailable", "Desktop native temporary artifacts are not implemented");
    }
    if (
      request.options.profile
      && !["planner", "interactive"].includes(request.options.profile)
    ) {
      throw new ImageProcessingError("invalidRequest", "Compression profile is invalid");
    }
    if (
      request.options.format === "auto"
      || request.options.profile === "planner"
      || request.options.dimensions
    ) {
      return this.webFallback.compress(request, context);
    }
    const quality = request.options.quality ?? 80;
    const gain = request.options.compressionGain ?? 1;
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new ImageProcessingError("invalidRequest", "Compression quality must be between 1 and 100");
    }
    if (!Number.isFinite(gain) || gain < 0.5 || gain > 2) {
      throw new ImageProcessingError("invalidRequest", "Compression gain must be between 0.5 and 2.0");
    }
    const { result, bytes } = await executeNative({
      operation: "encode",
      options: {
        format: request.options.format,
        quality,
        compressionGain: gain,
        allowAlphaLoss: request.options.allowAlphaLoss ?? false,
        forceEncode: request.options.forceEncode ?? false,
      },
    }, request.source, context);
    report(context, "completed");
    return {
      artifact: { kind: "blob", blob: new Blob([bytes], { type: result.metadata.mimeType }) },
      name: outputName(request.source.name, request.options.format),
      metadata: result.metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal: result.returnedOriginal,
      implementation: result.implementation,
    };
  }

  async convert(
    request: ConvertImageRequest,
    context?: ImageTaskContext,
  ): Promise<ImageProcessingResult> {
    if (request.destination !== "memory") {
      throw new ImageProcessingError("capabilityUnavailable", "Desktop native temporary artifacts are not implemented");
    }
    const quality = request.quality ?? 92;
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new ImageProcessingError("invalidRequest", "Conversion quality must be between 1 and 100");
    }
    const { result, bytes } = await executeNative({
      operation: "encode",
      options: {
        format: request.format,
        quality,
        compressionGain: 1,
        allowAlphaLoss: request.allowAlphaLoss ?? false,
        forceEncode: true,
      },
    }, request.source, context);
    report(context, "completed");
    return {
      artifact: { kind: "blob", blob: new Blob([bytes], { type: result.metadata.mimeType }) },
      name: outputName(request.source.name, request.format),
      metadata: result.metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal: false,
      implementation: result.implementation,
    };
  }
}
