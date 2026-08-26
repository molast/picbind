"use client";

import {
  IMAGE_PROCESSING_API_VERSION,
  ImageProcessingError,
  type ImageProcessingCapabilities,
  type ImageProcessingService,
} from "@picbind/shared";

const unavailable = (): never => {
  throw new ImageProcessingError(
    "capabilityUnavailable",
    "Desktop native image processing is not enabled for this capability",
  );
};

export class DesktopImageProcessingService implements ImageProcessingService {
  readonly engine = "desktop-native" as const;

  async capabilities(): Promise<ImageProcessingCapabilities> {
    return {
      apiVersion: IMAGE_PROCESSING_API_VERSION,
      engine: this.engine,
      inputFormats: [],
      outputFormats: [],
      parameterOperations: [],
      supportsStoredSources: false,
      supportsProgress: false,
      supportsCancellation: false,
      supportsQualityAnalysis: false,
      implementation: "desktop-native-unavailable",
    };
  }

  inspect = unavailable;
  renderPreview = unavailable;
  materialize = unavailable;
  compress = unavailable;
  compareQuality = unavailable;
  convert = unavailable;
  createShareAssets = unavailable;
  async releaseTemporary() {}
}
