export const IMAGE_PROCESSING_API_VERSION = 1 as const;
export const IMAGE_PARAMETER_DOCUMENT_VERSION = 1 as const;

export type ImageInputFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "gif"
  | "bmp"
  | "ico"
  | "unknown";

export type ImageOutputFormat = "jpeg" | "png" | "webp" | "avif";
export type ImageProcessingEngine = "web" | "desktop-native";

export type ImageMetadata = {
  width: number;
  height: number;
  format: ImageInputFormat;
  mimeType: string;
  sizeBytes: number;
  hasAlpha?: boolean;
  frameCount?: number;
  orientationApplied: boolean;
};

export type ImageAssetReference = {
  scope: "compressed" | "queued" | "room" | "messaging";
  scopeKey: string;
  id: string;
  variant: "original" | "output" | "thumbnail";
  mimeType: string;
  revision: string;
};

export type ImageProcessingSource =
  | { kind: "blob"; blob: Blob; name: string; mimeType: string }
  | { kind: "stored"; asset: ImageAssetReference; name: string };

export type TemporaryImageArtifact = {
  kind: "temporary";
  token: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: number;
};

export type ImageProcessingArtifact =
  | { kind: "blob"; blob: Blob }
  | { kind: "stored"; asset: ImageAssetReference }
  | TemporaryImageArtifact;

export type ImageProcessingResult = {
  artifact: ImageProcessingArtifact;
  name: string;
  metadata: ImageMetadata;
  engine: ImageProcessingEngine;
  sourceUnchanged: true;
  returnedOriginal: boolean;
  implementation?: string;
};

export type ImageOperationType =
  | "crop"
  | "color"
  | "draw"
  | "rotate"
  | "resize"
  | "filter"
  | "annotation"
  | "ai";

export type ImageOperation = {
  id: string;
  userId: string;
  time: number;
  type: ImageOperationType;
  params: Record<string, unknown>;
};

export type ImageParameterDocument = {
  version: typeof IMAGE_PARAMETER_DOCUMENT_VERSION;
  operations: ImageOperation[];
};

export type ImageTaskStage =
  | "resolvingSource"
  | "decoding"
  | "analyzing"
  | "rendering"
  | "encoding"
  | "persisting"
  | "completed";

export type ImageTaskProgress = {
  stage: ImageTaskStage;
  completed: number;
  total: number;
};

export type ImageTaskContext = {
  requestId: string;
  signal?: AbortSignal;
  onProgress?(progress: ImageTaskProgress): void;
};

export type RenderPreviewRequest = {
  source: ImageProcessingSource;
  document: ImageParameterDocument;
  maxWidth: number;
  maxHeight: number;
  mimeType: "image/webp";
  quality: number;
};

export type ImagePreviewResult = {
  artifact: { kind: "blob"; blob: Blob };
  width: number;
  height: number;
  engine: ImageProcessingEngine;
  documentVersion: 1;
};

export type MaterializeImageRequest = {
  source: ImageProcessingSource;
  document: ImageParameterDocument;
  output: {
    format: "source" | ImageOutputFormat;
    quality?: number;
    allowAlphaLoss?: boolean;
  };
  destination: "memory" | "temporary";
};

export type CompressImageRequest = {
  source: ImageProcessingSource;
  options: {
    format: "auto" | ImageOutputFormat;
    profile?: "planner" | "interactive";
    quality?: number;
    compressionGain?: number;
    allowAlphaLoss?: boolean;
    dimensions?: { width: number; height: number };
    forceEncode?: boolean;
  };
  destination: "memory" | "temporary";
};

export type ImageAnalysisMetrics = {
  width: number;
  height: number;
  pixelCount: number;
  sourceSizeBytes: number;
  sourceSizeMb: number;
  sourceFormat: string;
  hasAlpha: boolean;
  hasAlphaChannel: boolean;
  hasRealAlpha: boolean;
  alphaMin: number;
  alphaMax: number;
  alphaRatio: number;
  transparentPixelRatio: number;
  semiTransparentRatio: number;
  sampleStride: number;
  sampleCount: number;
  edgeStrength: number;
  brightnessVariance: number;
  colorComplexity: number;
  colorEntropy: number;
  noiseLevel: number;
  gradientCoverage: number;
  detailCoverage: number;
  flatCoverage: number;
  complexityScore: number;
  compressibilityScore: number;
};

export type ImageQualityComparison = {
  width: number;
  height: number;
  mse: number;
  rmse: number;
  psnr: number;
  ssim: number;
  msSsim: number;
  edgeRetention: number;
  blurLossPercent: number;
  overallQualityScore: number;
  originalEdgeEnergy: number;
  compressedEdgeEnergy: number;
  originalLaplacianVariance: number;
  compressedLaplacianVariance: number;
  meanDeltaE: number;
  p95DeltaE: number;
  p99DeltaE: number;
  p95MaskedDeltaE: number;
  p99MaskedDeltaE: number;
  p95LuminanceError: number;
  p95ChromaError: number;
  perceptualDistance: number;
  meanAlphaError: number;
  p95AlphaError: number;
  p99AlphaError: number;
};

export type CompareImageQualityRequest = {
  source: ImageProcessingSource;
  assessed: ImageProcessingSource;
};

export type ImageQualityAnalysisResult = {
  comparison: ImageQualityComparison;
  sourceMetrics: ImageAnalysisMetrics;
  assessedMetrics: ImageAnalysisMetrics;
  engine: ImageProcessingEngine;
};

export type ConvertImageRequest = {
  source: ImageProcessingSource;
  format: ImageOutputFormat;
  quality?: number;
  allowAlphaLoss?: boolean;
  destination: "memory" | "temporary";
};

export type CreateShareAssetsRequest = {
  source: ImageProcessingSource;
  document?: ImageParameterDocument;
  container: { width: number; height: number };
};

export type ImageShareAssets = {
  placeholder: {
    width: number;
    height: number;
    dominantColor: string;
    blurHash: string;
  };
  thumbnail: { kind: "blob"; blob: Blob };
  thumbnailMimeType: "image/webp";
  engine: ImageProcessingEngine;
};

export type ImageProcessingCapabilities = {
  apiVersion: 1;
  engine: ImageProcessingEngine;
  inputFormats: ImageInputFormat[];
  outputFormats: ImageOutputFormat[];
  parameterOperations: ImageOperationType[];
  supportsStoredSources: boolean;
  supportsProgress: boolean;
  supportsCancellation: boolean;
  supportsQualityAnalysis: boolean;
  maxInputBytes?: number;
  maxPixels?: number;
  maxInlineBytes?: number;
  implementation?: string;
};

export type AdoptTemporaryImageInput = {
  artifact: TemporaryImageArtifact;
  target: Omit<ImageAssetReference, "mimeType" | "revision">;
  metadata: Record<string, unknown>;
};
