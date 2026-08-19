/// <reference lib="webworker" />

import {
  analyzeImageMetrics,
  compareImageQuality,
  type ImageAnalysisMetrics,
  type ImageQualityComparison,
} from "@/utils/wasm";

type AnalysisRequest = {
  id: string;
  source: File;
  compressed: Blob;
};

type AnalysisSuccessMessage = {
  id: string;
  ok: true;
  comparison: ImageQualityComparison;
  sourceMetrics: ImageAnalysisMetrics;
  compressedMetrics: ImageAnalysisMetrics;
};

type AnalysisErrorMessage = {
  id: string;
  ok: false;
  error: string;
};

type AnalysisMessage = AnalysisSuccessMessage | AnalysisErrorMessage;

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  const { id, source, compressed } = event.data;

  try {
    const [comparison, sourceMetrics, compressedMetrics] = await Promise.all([
      compareImageQuality(source, compressed),
      analyzeImageMetrics(source),
      analyzeImageMetrics(compressed),
    ]);

    const message: AnalysisSuccessMessage = {
      id,
      ok: true,
      comparison,
      sourceMetrics,
      compressedMetrics,
    };
    workerScope.postMessage(message satisfies AnalysisMessage);
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error);

    const message: AnalysisErrorMessage = {
      id,
      ok: false,
      error: errorMessage,
    };
    workerScope.postMessage(message satisfies AnalysisMessage);
  }
};

export {};
