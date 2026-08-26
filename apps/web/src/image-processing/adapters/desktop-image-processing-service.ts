"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  IMAGE_PROCESSING_API_VERSION,
  ImageProcessingError,
  validateImageParameterDocument,
  validateImageProcessingSource,
  type CompressImageRequest,
  type CompareImageQualityRequest,
  type ConvertImageRequest,
  type CreateShareAssetsRequest,
  type ImageAnalysisMetrics,
  type ImageMetadata,
  type ImageOutputFormat,
  type ImageParameterDocument,
  type ImageProcessingCapabilities,
  type ImageProcessingResult,
  type ImageProcessingService,
  type ImageProcessingSource,
  type ImageQualityComparison,
  type ImageTaskContext,
  type MaterializeImageRequest,
  type RenderPreviewRequest,
} from "@picbind/shared";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const capabilities: ImageProcessingCapabilities = {
  apiVersion: IMAGE_PROCESSING_API_VERSION,
  engine: "desktop-native",
  inputFormats: ["jpeg", "png", "webp", "avif"],
  outputFormats: ["jpeg", "png", "webp", "avif"],
  parameterOperations: ["crop", "resize", "rotate", "color", "draw"],
  supportsStoredSources: true,
  supportsProgress: true,
  supportsCancellation: true,
  supportsQualityAnalysis: true,
  maxInputBytes: 50 * 1024 * 1024,
  maxPixels: 100_000_000,
  implementation: "picbind-image-native/1",
};

type NativeResponse = {
  metadata: ImageMetadata;
  returnedOriginal: boolean;
  dataLength: number;
  implementation: string;
  temporary?: {
    token: string;
    mimeType: string;
    sizeBytes: number;
    expiresAt: number;
  };
};

type NativeBinaryResponse = {
  dataLength: number;
  implementation: string;
};

type NativePreviewResponse = NativeBinaryResponse & {
  width: number;
  height: number;
};

type NativeShareAssetsResponse = NativeBinaryResponse & {
  placeholder: {
    width: number;
    height: number;
    dominantColor: string;
    blurHash: string;
  };
  thumbnailMimeType: "image/webp";
};

type NativeQualityResponse = NativeBinaryResponse & {
  comparison: ImageQualityComparison;
  sourceMetrics: ImageAnalysisMetrics;
  assessedMetrics: ImageAnalysisMetrics;
};

type NativeCommandError = {
  code?: string;
  message?: string;
};

type NativeProgressEvent = {
  requestId: string;
  stage: Parameters<NonNullable<ImageTaskContext["onProgress"]>>[0]["stage"];
  completed: number;
  total: number;
};

export type DesktopNativeBridge = {
  invoke<T>(command: string, args?: unknown): Promise<T>;
  listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void>;
  randomUUID(): string;
};

const defaultNativeBridge: DesktopNativeBridge = {
  invoke: (command, args) => invoke(command, args as never),
  listen: (event, handler) => listen(event, handler),
  randomUUID: () => crypto.randomUUID(),
};

function checkContext(context?: ImageTaskContext) {
  if (context?.signal?.aborted) {
    throw new ImageProcessingError("cancelled", "Image processing was cancelled");
  }
}

function outputName(name: string, format: ImageOutputFormat | string) {
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

function artifactFromNative(result: NativeResponse, bytes: Uint8Array) {
  if (result.temporary) {
    if (bytes.byteLength !== 0) {
      throw new ImageProcessingError("internal", "Native temporary output included inline data");
    }
    return { kind: "temporary" as const, ...result.temporary };
  }
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return {
    kind: "blob" as const,
    blob: new Blob([buffer], { type: result.metadata.mimeType }),
  };
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
      case "unsupportedOperation": return "unsupportedOperation" as const;
      case "cancelled": return "cancelled" as const;
      case "invalidRequest": return "invalidRequest" as const;
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

async function executeNative<T extends NativeBinaryResponse = NativeResponse>(
  bridge: DesktopNativeBridge,
  metadata: Record<string, unknown>,
  source: ImageProcessingSource,
  context?: ImageTaskContext,
  assessed?: ImageProcessingSource,
) {
  checkContext(context);
  const requestId = context?.requestId || bridge.randomUUID();
  const encodedSource = await encodeSource(source);
  const encodedAssessed = assessed ? await encodeSource(assessed) : undefined;
  checkContext(context);
  const metadataBytes = encoder.encode(JSON.stringify({
    apiVersion: IMAGE_PROCESSING_API_VERSION,
    requestId,
    ...metadata,
    source: encodedSource.source,
    assessed: encodedAssessed?.source,
    inlineLength: encodedSource.bytes.byteLength,
    assessedInlineLength: encodedAssessed?.bytes.byteLength ?? 0,
  }));
  const frame = new Uint8Array(
    4 + metadataBytes.byteLength + encodedSource.bytes.byteLength
      + (encodedAssessed?.bytes.byteLength ?? 0),
  );
  new DataView(frame.buffer).setUint32(0, metadataBytes.byteLength, true);
  frame.set(metadataBytes, 4);
  frame.set(encodedSource.bytes, 4 + metadataBytes.byteLength);
  if (encodedAssessed) {
    frame.set(
      encodedAssessed.bytes,
      4 + metadataBytes.byteLength + encodedSource.bytes.byteLength,
    );
  }

  let raw: ArrayBuffer | Uint8Array | number[];
  const unlisten = await bridge.listen<NativeProgressEvent>("image-processing-progress", ({ payload }) => {
    if (payload.requestId === requestId) {
      context?.onProgress?.({
        stage: payload.stage,
        completed: payload.completed,
        total: payload.total,
      });
    }
  });
  const cancel = () => {
    void bridge.invoke("image_processing_cancel", { requestId }).catch(() => undefined);
  };
  context?.signal?.addEventListener("abort", cancel, { once: true });
  try {
    checkContext(context);
    raw = await bridge.invoke<ArrayBuffer | Uint8Array | number[]>("image_processing_execute", frame);
  } catch (error) {
    throw parseNativeError(error);
  } finally {
    context?.signal?.removeEventListener("abort", cancel);
    unlisten();
  }
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
  const result = JSON.parse(decoder.decode(response.subarray(4, metadataEnd))) as T;
  const bytes = response.slice(metadataEnd);
  if (bytes.byteLength !== result.dataLength) {
    throw new ImageProcessingError("internal", "Native image response data is incomplete");
  }
  return { result, bytes };
}

export class DesktopImageProcessingService implements ImageProcessingService {
  readonly engine = "desktop-native" as const;

  constructor(
    private readonly bridge: DesktopNativeBridge = defaultNativeBridge,
  ) {}

  async capabilities() {
    return capabilities;
  }

  async inspect(source: ImageProcessingSource, context?: ImageTaskContext) {
    const { result } = await executeNative(this.bridge, { operation: "inspect" }, source, context);
    return result.metadata;
  }

  async renderPreview(request: RenderPreviewRequest, context?: ImageTaskContext) {
    validateImageParameterDocument(request.document);
    if (request.mimeType !== "image/webp"
      || !Number.isInteger(request.maxWidth) || request.maxWidth < 1
      || !Number.isInteger(request.maxHeight) || request.maxHeight < 1
      || !Number.isFinite(request.quality) || request.quality < 0 || request.quality > 1) {
      throw new ImageProcessingError("invalidRequest", "Preview dimensions, quality or mimeType are invalid");
    }
    const { result, bytes } = await executeNative<NativePreviewResponse>(this.bridge, {
      operation: "renderPreview",
      document: request.document,
      preview: {
        maxWidth: request.maxWidth,
        maxHeight: request.maxHeight,
        quality: Math.max(1, Math.round(request.quality * 100)),
      },
    }, request.source, context);
    return {
      artifact: { kind: "blob" as const, blob: new Blob([bytes], { type: "image/webp" }) },
      width: result.width,
      height: result.height,
      engine: this.engine,
      documentVersion: 1 as const,
    };
  }

  async materialize(
    request: MaterializeImageRequest,
    context?: ImageTaskContext,
  ): Promise<ImageProcessingResult> {
    validateImageParameterDocument(request.document);
    const quality = request.output.quality ?? 92;
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new ImageProcessingError("invalidRequest", "Materialize quality must be between 1 and 100");
    }
    const { result, bytes } = await executeNative<NativeResponse>(this.bridge, {
      operation: "materialize",
      destination: request.destination,
      document: request.document,
      materialize: {
        format: request.output.format,
        quality: Math.round(quality),
        allowAlphaLoss: request.output.allowAlphaLoss ?? false,
      },
    }, request.source, context);
    return {
      artifact: artifactFromNative(result, bytes),
      name: outputName(request.source.name, result.metadata.format),
      metadata: result.metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal: result.returnedOriginal,
      implementation: result.implementation,
    };
  }

  async compareQuality(request: CompareImageQualityRequest, context?: ImageTaskContext) {
    const { result } = await executeNative<NativeQualityResponse>(
      this.bridge,
      { operation: "compareQuality" },
      request.source,
      context,
      request.assessed,
    );
    return {
      comparison: result.comparison,
      sourceMetrics: result.sourceMetrics,
      assessedMetrics: result.assessedMetrics,
      engine: this.engine,
    };
  }

  async createShareAssets(request: CreateShareAssetsRequest, context?: ImageTaskContext) {
    if (request.document) {
      validateImageParameterDocument(request.document);
    }
    if (!Number.isInteger(request.container.width) || request.container.width < 1
      || !Number.isInteger(request.container.height) || request.container.height < 1) {
      throw new ImageProcessingError("invalidRequest", "Share asset container is invalid");
    }
    const { result, bytes } = await executeNative<NativeShareAssetsResponse>(this.bridge, {
      operation: "createShareAssets",
      document: request.document,
      container: request.container,
    }, request.source, context);
    return {
      placeholder: result.placeholder,
      thumbnail: {
        kind: "blob" as const,
        blob: new Blob([bytes], { type: result.thumbnailMimeType }),
      },
      thumbnailMimeType: result.thumbnailMimeType,
      engine: this.engine,
    };
  }

  async releaseTemporary(artifact: Parameters<ImageProcessingService["releaseTemporary"]>[0]) {
    await this.bridge.invoke("image_processing_release_temporary", { token: artifact.token });
  }

  async compress(
    request: CompressImageRequest,
    context?: ImageTaskContext,
  ): Promise<ImageProcessingResult> {
    if (
      request.options.profile
      && !["planner", "interactive"].includes(request.options.profile)
    ) {
      throw new ImageProcessingError("invalidRequest", "Compression profile is invalid");
    }
    if (request.options.dimensions
      && (!Number.isInteger(request.options.dimensions.width)
        || !Number.isInteger(request.options.dimensions.height)
        || request.options.dimensions.width < 1
        || request.options.dimensions.height < 1
        || request.options.dimensions.width > 16_384
        || request.options.dimensions.height > 16_384
        || request.options.dimensions.width * request.options.dimensions.height > 100_000_000)) {
      throw new ImageProcessingError(
        "invalidRequest",
        "Compression dimensions exceed the native size limits",
      );
    }
    if (request.options.profile === "planner" && request.options.dimensions) {
      throw new ImageProcessingError(
        "invalidRequest",
        "Planner compression does not accept resize dimensions",
      );
    }
    const quality = request.options.quality ?? 80;
    const gain = request.options.compressionGain ?? 1;
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new ImageProcessingError("invalidRequest", "Compression quality must be between 1 and 100");
    }
    if (!Number.isFinite(gain) || gain < 0.5 || gain > 2) {
      throw new ImageProcessingError("invalidRequest", "Compression gain must be between 0.5 and 2.0");
    }
    const { result, bytes } = await executeNative(this.bridge, {
      operation: "encode",
      destination: request.destination,
      options: {
        format: request.options.format,
        profile: request.options.profile ?? "interactive",
        quality,
        compressionGain: gain,
        allowAlphaLoss: request.options.allowAlphaLoss ?? false,
        forceEncode: request.options.forceEncode ?? false,
        dimensions: request.options.dimensions,
      },
    }, request.source, context);
    return {
      artifact: artifactFromNative(result, bytes),
      name: outputName(request.source.name, result.metadata.format),
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
    const quality = request.quality ?? 92;
    if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
      throw new ImageProcessingError("invalidRequest", "Conversion quality must be between 1 and 100");
    }
    const { result, bytes } = await executeNative(this.bridge, {
      operation: "encode",
      destination: request.destination,
      options: {
        format: request.format,
        profile: "interactive",
        quality,
        compressionGain: 1,
        allowAlphaLoss: request.allowAlphaLoss ?? false,
        forceEncode: true,
        dimensions: undefined,
      },
    }, request.source, context);
    return {
      artifact: artifactFromNative(result, bytes),
      name: outputName(request.source.name, request.format),
      metadata: result.metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal: false,
      implementation: result.implementation,
    };
  }
}
