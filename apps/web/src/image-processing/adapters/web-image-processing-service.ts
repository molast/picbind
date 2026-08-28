"use client";

import {
  IMAGE_PROCESSING_API_VERSION,
  ImageProcessingError,
  validateImageParameterDocument,
  validateImageProcessingSource,
  type CompressImageRequest,
  type CompareImageQualityRequest,
  type ConvertImageRequest,
  type CreateShareAssetsRequest,
  type ImageMetadata,
  type ImageProcessingCapabilities,
  type ImageProcessingResult,
  type ImageProcessingService,
  type ImageProcessingSource,
  type ImageTaskContext,
  type MaterializeImageRequest,
  type RenderPreviewRequest,
} from "@picbind/shared";
import { analyzeCompressionInWorker } from "@/utils/analysis-worker";
import { compressWithWasmWorker } from "@/utils/wasm-worker";
import { getImageStorageRepository } from "@picbind/ui/source/image-storage";
import {
  compressWebImage,
  convertWebImage,
  createWebShareAssets,
  inspectWebImage,
  materializeWebImage,
  renderWebImagePreview,
} from "@picbind/ui/source/image-processing-web-runtime";

const capabilities: ImageProcessingCapabilities = {
  apiVersion: IMAGE_PROCESSING_API_VERSION,
  engine: "web",
  inputFormats: ["jpeg", "png", "webp", "avif", "gif", "bmp", "ico"],
  outputFormats: ["jpeg", "png", "webp", "avif"],
  parameterOperations: ["crop", "color", "draw", "rotate", "resize", "filter", "annotation", "ai"],
  supportsStoredSources: true,
  supportsProgress: true,
  supportsCancellation: true,
  supportsQualityAnalysis: true,
  maxInputBytes: 50 * 1024 * 1024,
  maxPixels: 32 * 1024 * 1024,
  implementation: "web-worker-wasm-browser-codecs",
};

function report(context: ImageTaskContext | undefined, stage: Parameters<NonNullable<ImageTaskContext["onProgress"]>>[0]["stage"]) {
  context?.onProgress?.({ stage, completed: stage === "completed" ? 1 : 0, total: 1 });
}

function taskSignal(context?: ImageTaskContext) {
  if (context && !context.requestId) {
    throw new ImageProcessingError("invalidRequest", "Image task requestId is required");
  }
  if (context?.signal?.aborted) {
    throw new ImageProcessingError("cancelled", "Image processing was cancelled");
  }
  return context?.signal ?? new AbortController().signal;
}

async function resolveSource(source: ImageProcessingSource, context?: ImageTaskContext) {
  validateImageProcessingSource(source);
  const signal = taskSignal(context);
  report(context, "resolvingSource");
  if (source.kind === "blob") return { blob: source.blob, name: source.name, mimeType: source.mimeType };

  const repository = getImageStorageRepository();
  const { asset } = source;
  const record = await repository.get(asset.scope, asset.scopeKey, asset.id);
  if (!record) throw new ImageProcessingError("sourceNotFound", "Stored image source was not found");
  if (record.revision !== asset.revision) {
    throw new ImageProcessingError("sourceChanged", "Stored image source changed before processing");
  }
  const blob = await repository.read(
    asset.scope,
    asset.scopeKey,
    asset.id,
    asset.variant,
    asset.mimeType,
    signal,
  );
  if (!blob) throw new ImageProcessingError("sourceNotFound", "Stored image data was not found");
  return { blob, name: source.name, mimeType: asset.mimeType };
}

function outputName(name: string, format: string) {
  const extension = format === "jpeg" ? "jpg" : format;
  return `${name.replace(/\.[^.]+$/, "") || "image"}.${extension}`;
}

async function metadataFor(blob: Blob): Promise<ImageMetadata> {
  return inspectWebImage(blob);
}

export class WebImageProcessingService implements ImageProcessingService {
  readonly engine = "web" as const;

  async capabilities() {
    return capabilities;
  }

  async releaseMemorySource(_cacheKey: string) {
    // Browser Blob sources are owned and released by the workspace container.
  }

  async inspect(source: ImageProcessingSource, context?: ImageTaskContext) {
    const resolved = await resolveSource(source, context);
    report(context, "decoding");
    const result = await metadataFor(resolved.blob);
    report(context, "completed");
    return result;
  }

  async renderPreview(request: RenderPreviewRequest, context?: ImageTaskContext) {
    validateImageParameterDocument(request.document);
    if (request.mimeType !== "image/webp"
      || !Number.isFinite(request.maxWidth) || request.maxWidth < 1
      || !Number.isFinite(request.maxHeight) || request.maxHeight < 1
      || !Number.isFinite(request.quality) || request.quality < 0 || request.quality > 1) {
      throw new ImageProcessingError("invalidRequest", "Preview dimensions and mimeType are invalid");
    }
    const resolved = await resolveSource(request.source, context);
    report(context, "decoding");
    const metadata = await metadataFor(resolved.blob);
    report(context, "rendering");
    const preview = await renderWebImagePreview({
      blob: resolved.blob,
      metadata,
      document: request.document,
      maxWidth: request.maxWidth,
      maxHeight: request.maxHeight,
      quality: request.quality,
    });
    report(context, "completed");
    if (request.destination === "cache") {
      const url = URL.createObjectURL(preview.blob);
      return {
        artifact: {
          kind: "cache" as const,
          id: url,
          url,
          mimeType: "image/webp" as const,
          sizeBytes: preview.blob.size,
          engine: this.engine,
        },
        width: preview.width,
        height: preview.height,
        engine: this.engine,
        documentVersion: 1 as const,
      };
    }
    return {
      artifact: { kind: "blob" as const, blob: preview.blob },
      width: preview.width,
      height: preview.height,
      engine: this.engine,
      documentVersion: 1 as const,
    };
  }

  async releasePreviewCache(artifact: Parameters<ImageProcessingService["releasePreviewCache"]>[0]) {
    URL.revokeObjectURL(artifact.url);
  }

  async materialize(request: MaterializeImageRequest, context?: ImageTaskContext): Promise<ImageProcessingResult> {
    if (request.destination !== "memory") {
      throw new ImageProcessingError("capabilityUnavailable", "Web image processing only supports memory output");
    }
    if (request.output.format === "jxl") {
      throw new ImageProcessingError(
        "unsupportedOutputFormat",
        "JPEG XL encoding is only available in the Desktop Native engine",
      );
    }
    validateImageParameterDocument(request.document);
    const resolved = await resolveSource(request.source, context);
    report(context, "decoding");
    const sourceMetadata = await metadataFor(resolved.blob);
    report(context, "rendering");
    let materialized = await materializeWebImage({
      ...resolved,
      metadata: sourceMetadata,
      document: request.document,
      quality: request.output.quality,
    });
    const requestedFormat = request.output.format === "source"
      ? sourceMetadata.format
      : request.output.format;
    if (requestedFormat === "unknown" || requestedFormat === "gif" || requestedFormat === "bmp" || requestedFormat === "ico") {
      throw new ImageProcessingError("unsupportedOutputFormat", "The source format cannot be materialized");
    }
    const currentFormat = (await metadataFor(materialized.blob)).format;
    if (currentFormat !== requestedFormat) {
      report(context, "encoding");
      const signal = taskSignal(context);
      const converted = await convertWebImage({
        blob: materialized.blob,
        name: materialized.name,
        format: requestedFormat,
        signal,
        allowAlphaLoss: request.output.allowAlphaLoss,
        quality: request.output.quality,
      });
      materialized = {
        ...materialized,
        blob: converted.blob,
        name: converted.name,
        mimeType: converted.blob.type,
        width: converted.width,
        height: converted.height,
        returnedOriginal: false,
      };
    }
    const metadata = await metadataFor(materialized.blob);
    report(context, "completed");
    return {
      artifact: { kind: "blob", blob: materialized.blob },
      name: materialized.name,
      metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal: materialized.returnedOriginal,
      implementation: capabilities.implementation,
    };
  }

  async compress(request: CompressImageRequest, context?: ImageTaskContext): Promise<ImageProcessingResult> {
    if (request.destination !== "memory") {
      throw new ImageProcessingError("capabilityUnavailable", "Web image processing only supports memory output");
    }
    if (request.options.format === "jxl") {
      throw new ImageProcessingError(
        "unsupportedOutputFormat",
        "JPEG XL encoding is only available in the Desktop Native engine",
      );
    }
    const gain = request.options.compressionGain;
    if (gain !== undefined && (!Number.isFinite(gain) || gain < 0.5 || gain > 2)) {
      throw new ImageProcessingError("invalidRequest", "Compression gain must be between 0.5 and 2.0");
    }
    if (request.options.profile && !["planner", "interactive"].includes(request.options.profile)) {
      throw new ImageProcessingError("invalidRequest", "Compression profile is invalid");
    }
    if (request.options.quality !== undefined
      && (!Number.isFinite(request.options.quality) || request.options.quality < 1 || request.options.quality > 100)) {
      throw new ImageProcessingError("invalidRequest", "Compression quality must be between 1 and 100");
    }
    if (request.options.dimensions
      && (!Number.isInteger(request.options.dimensions.width)
        || !Number.isInteger(request.options.dimensions.height)
        || request.options.dimensions.width < 1 || request.options.dimensions.height < 1
        || request.options.dimensions.width > 16_384 || request.options.dimensions.height > 16_384)) {
      throw new ImageProcessingError("invalidRequest", "Compression dimensions must be integers between 1 and 16384");
    }
    const resolved = await resolveSource(request.source, context);
    const sourceMetadata = await metadataFor(resolved.blob);
    report(context, "encoding");
    const signal = taskSignal(context);
    const profile = request.options.profile ?? "interactive";
    if (profile === "planner" && request.options.dimensions) {
      throw new ImageProcessingError("invalidRequest", "Planner compression does not accept resize dimensions");
    }
    let result: { blob: Blob; name: string; width: number; height: number };
    try {
      result = profile === "planner"
        ? await (async () => {
          const requestedFormat = request.options.format === "auto"
            ? sourceMetadata.format
            : request.options.format;
          if (requestedFormat === "unknown" || requestedFormat === "gif" || requestedFormat === "bmp" || requestedFormat === "ico" || requestedFormat === "jxl") {
            throw new ImageProcessingError("unsupportedOutputFormat", "The source format cannot be compressed");
          }
          const output = await compressWithWasmWorker(
            new File([resolved.blob], resolved.name, { type: resolved.mimeType }),
            request.options.quality ?? 80,
            requestedFormat,
            request.options.allowAlphaLoss ?? false,
            request.options.format === "auto",
            signal,
          );
          const dimensions = await metadataFor(output.blob);
          return {
            blob: output.blob,
            name: output.fileName,
            width: dimensions.width,
            height: dimensions.height,
          };
          })()
        : await compressWebImage({
            ...resolved,
            format: request.options.format,
            signal,
            dimensions: request.options.dimensions,
            allowAlphaLoss: request.options.allowAlphaLoss,
            quality: request.options.quality,
            compressionGain: gain,
            forceEncode: request.options.forceEncode,
          });
    } catch (error) {
      if (error instanceof ImageProcessingError) throw error;
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new ImageProcessingError("cancelled", "Image compression was cancelled", undefined, { cause: error });
      }
      throw new ImageProcessingError("encodeFailed", "The image could not be compressed", undefined, { cause: error });
    }
    const metadata = await metadataFor(result.blob);
    const unchangedDimensions = !request.options.dimensions
      || (request.options.dimensions.width === sourceMetadata.width
        && request.options.dimensions.height === sourceMetadata.height);
    const returnedOriginal = unchangedDimensions
      && metadata.format === sourceMetadata.format
      && result.blob.size === resolved.blob.size;
    report(context, "completed");
    return {
      artifact: { kind: "blob", blob: result.blob },
      name: result.name,
      metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal,
      implementation: capabilities.implementation,
    };
  }

  async compareQuality(request: CompareImageQualityRequest, context?: ImageTaskContext) {
    const signal = taskSignal(context);
    const [source, assessed] = await Promise.all([
      resolveSource(request.source, context),
      resolveSource(request.assessed, context),
    ]);
    report(context, "analyzing");
    try {
      const analysis = await analyzeCompressionInWorker(
        new File([source.blob], source.name, { type: source.mimeType }),
        assessed.blob,
        signal,
      );
      report(context, "completed");
      return {
        comparison: analysis.comparison,
        sourceMetrics: analysis.sourceMetrics,
        assessedMetrics: analysis.compressedMetrics,
        engine: this.engine,
      };
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new ImageProcessingError("cancelled", "Image analysis was cancelled", undefined, { cause: error });
      }
      throw new ImageProcessingError("internal", "Image quality analysis failed", undefined, { cause: error });
    }
  }

  async convert(request: ConvertImageRequest, context?: ImageTaskContext): Promise<ImageProcessingResult> {
    if (request.destination !== "memory") {
      throw new ImageProcessingError("capabilityUnavailable", "Web image processing only supports memory output");
    }
    if (request.format === "jxl") {
      throw new ImageProcessingError(
        "unsupportedOutputFormat",
        "JPEG XL encoding is only available in the Desktop Native engine",
      );
    }
    const resolved = await resolveSource(request.source, context);
    report(context, "encoding");
    const result = await convertWebImage({
      ...resolved,
      format: request.format,
      signal: taskSignal(context),
      allowAlphaLoss: request.allowAlphaLoss,
    });
    const metadata = await metadataFor(result.blob);
    if (metadata.format !== request.format) {
      throw new ImageProcessingError("encodeFailed", "Image conversion returned the wrong format");
    }
    report(context, "completed");
    return {
      artifact: { kind: "blob", blob: result.blob },
      name: result.name || outputName(resolved.name, request.format),
      metadata,
      engine: this.engine,
      sourceUnchanged: true,
      returnedOriginal: false,
      implementation: capabilities.implementation,
    };
  }

  async createShareAssets(request: CreateShareAssetsRequest, context?: ImageTaskContext) {
    const resolved = await resolveSource(request.source, context);
    let source = resolved.blob;
    if (request.document) {
      validateImageParameterDocument(request.document);
      if (request.document.operations.length) {
        const metadata = await metadataFor(source);
        source = (await materializeWebImage({
          ...resolved,
          metadata,
          document: request.document,
        })).blob;
      }
    }
    report(context, "rendering");
    const result = await createWebShareAssets(source, request.container);
    report(context, "completed");
    return {
      placeholder: result.placeholder,
      thumbnail: { kind: "blob" as const, blob: result.thumbnail },
      thumbnailMimeType: "image/webp" as const,
      engine: this.engine,
    };
  }

  async releaseTemporary() {
    // Web artifacts are Blob-backed and do not require explicit native cleanup.
  }
}
