"use client";

import { createUuid } from "@/utils/uuid";
import type { ImageAnalysisMetrics, ImageQualityComparison } from "@/utils/wasm";

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

export type CompressionAnalysisResult = {
  comparison: ImageQualityComparison;
  sourceMetrics: ImageAnalysisMetrics;
  compressedMetrics: ImageAnalysisMetrics;
};

export async function analyzeCompressionInWorker(
  source: File,
  compressed: Blob,
  signal?: AbortSignal,
): Promise<CompressionAnalysisResult> {
  signal?.throwIfAborted();
  if (typeof window === "undefined") {
    throw new Error("Analysis worker is unavailable on the server");
  }

  const worker = new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), {
    type: "module",
  });

  return new Promise<CompressionAnalysisResult>((resolve, reject) => {
    const id = createUuid();
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    const handleAbort = () => {
      cleanup();
      worker.terminate();
      reject(new DOMException("Image analysis was cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    worker.onmessage = (event: MessageEvent<AnalysisMessage>) => {
      const message = event.data;
      if (message.id !== id) {
        return;
      }

      worker.terminate();
      cleanup();

      if (!message.ok) {
        reject(new Error(message.error));
        return;
      }

      resolve({
        comparison: message.comparison,
        sourceMetrics: message.sourceMetrics,
        compressedMetrics: message.compressedMetrics,
      });
    };

    worker.onerror = (event) => {
      worker.terminate();
      cleanup();
      reject(event.error || new Error(event.message || "Analysis worker failed"));
    };

    worker.postMessage({ id, source, compressed });
  });
}
