"use client";

import {
  ImageProcessingError,
  type CompressImageRequest,
  type CompareImageQualityRequest,
  type ConvertImageRequest,
  type CreateShareAssetsRequest,
  type ImageParameterDocument,
  type ImageProcessingService,
  type ImageProcessingSource,
  type ImageTaskContext,
  type MaterializeImageRequest,
  type RenderPreviewRequest,
  type TemporaryImageArtifact,
} from "@picbind/shared";

const nativeMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const nativeOperations = new Set(["crop", "resize", "rotate", "color", "draw"]);

function sourceMimeType(source: ImageProcessingSource) {
  return source.kind === "blob" ? source.mimeType : source.asset.mimeType;
}

function supportsNativeSource(source: ImageProcessingSource) {
  return nativeMimeTypes.has(sourceMimeType(source).toLowerCase());
}

function supportsNativeDocument(document?: ImageParameterDocument) {
  return !document || document.operations.every((operation) => nativeOperations.has(operation.type));
}

function requireMemoryFallback(destination: "memory" | "temporary") {
  if (destination !== "memory") {
    throw new ImageProcessingError(
      "capabilityUnavailable",
      "This image requires the Web engine, which cannot create Desktop temporary artifacts",
    );
  }
}

export class DesktopImageProcessingSelector implements ImageProcessingService {
  readonly engine = "desktop-native" as const;

  constructor(
    private readonly native: ImageProcessingService,
    private readonly web: ImageProcessingService,
  ) {}

  capabilities() {
    return this.native.capabilities();
  }

  inspect(source: ImageProcessingSource, context?: ImageTaskContext) {
    return (supportsNativeSource(source) ? this.native : this.web).inspect(source, context);
  }

  renderPreview(request: RenderPreviewRequest, context?: ImageTaskContext) {
    const service = supportsNativeSource(request.source) && supportsNativeDocument(request.document)
      ? this.native
      : this.web;
    return service.renderPreview(request, context);
  }

  async materialize(request: MaterializeImageRequest, context?: ImageTaskContext) {
    if (supportsNativeSource(request.source) && supportsNativeDocument(request.document)) {
      return this.native.materialize(request, context);
    }
    requireMemoryFallback(request.destination);
    return this.web.materialize(request, context);
  }

  async compress(request: CompressImageRequest, context?: ImageTaskContext) {
    if (supportsNativeSource(request.source)) return this.native.compress(request, context);
    requireMemoryFallback(request.destination);
    return this.web.compress(request, context);
  }

  compareQuality(request: CompareImageQualityRequest, context?: ImageTaskContext) {
    const service = supportsNativeSource(request.source) && supportsNativeSource(request.assessed)
      ? this.native
      : this.web;
    return service.compareQuality(request, context);
  }

  async convert(request: ConvertImageRequest, context?: ImageTaskContext) {
    if (supportsNativeSource(request.source)) return this.native.convert(request, context);
    requireMemoryFallback(request.destination);
    return this.web.convert(request, context);
  }

  createShareAssets(request: CreateShareAssetsRequest, context?: ImageTaskContext) {
    const service = supportsNativeSource(request.source) && supportsNativeDocument(request.document)
      ? this.native
      : this.web;
    return service.createShareAssets(request, context);
  }

  releaseTemporary(artifact: TemporaryImageArtifact) {
    return this.native.releaseTemporary(artifact);
  }
}
