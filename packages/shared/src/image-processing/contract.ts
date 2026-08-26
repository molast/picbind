import type {
  CompressImageRequest,
  CompareImageQualityRequest,
  ConvertImageRequest,
  CreateShareAssetsRequest,
  ImageMetadata,
  ImagePreviewResult,
  ImageProcessingCapabilities,
  ImageProcessingEngine,
  ImageProcessingResult,
  ImageQualityAnalysisResult,
  ImageProcessingSource,
  ImageShareAssets,
  ImageTaskContext,
  MaterializeImageRequest,
  RenderPreviewRequest,
  TemporaryImageArtifact,
} from "./types";

export interface ImageProcessingService {
  readonly engine: ImageProcessingEngine;

  capabilities(): Promise<ImageProcessingCapabilities>;
  inspect(source: ImageProcessingSource, context?: ImageTaskContext): Promise<ImageMetadata>;
  renderPreview(request: RenderPreviewRequest, context?: ImageTaskContext): Promise<ImagePreviewResult>;
  materialize(request: MaterializeImageRequest, context?: ImageTaskContext): Promise<ImageProcessingResult>;
  compress(request: CompressImageRequest, context?: ImageTaskContext): Promise<ImageProcessingResult>;
  compareQuality(request: CompareImageQualityRequest, context?: ImageTaskContext): Promise<ImageQualityAnalysisResult>;
  convert(request: ConvertImageRequest, context?: ImageTaskContext): Promise<ImageProcessingResult>;
  createShareAssets(request: CreateShareAssetsRequest, context?: ImageTaskContext): Promise<ImageShareAssets>;
  releaseTemporary(artifact: TemporaryImageArtifact): Promise<void>;
}
