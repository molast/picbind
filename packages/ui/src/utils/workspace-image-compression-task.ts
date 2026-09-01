"use client";

import { getPicBindUiConfig } from "../config";
import { getLang, getWorkspaceEditorLabels } from "../locales";
import type {
  WorkspaceCompressionDimensions,
  WorkspaceCompressionEncodingOptions,
  WorkspaceCompressionFormat,
  WorkspaceCompressionResult,
} from "./workspace-image-compression";

type WorkerSuccessMessage = {
  ok: true;
  bytes: ArrayBuffer;
  mime: string;
  format: WorkspaceCompressionResult["format"];
  name: string;
  width: number;
  height: number;
};

type WorkerErrorMessage = {
  ok: false;
  error: string;
};

type WorkerMessage = WorkerSuccessMessage | WorkerErrorMessage;

function abortError() {
  return new DOMException(getWorkspaceEditorLabels(getLang()).compressionCancelled, "AbortError");
}

export function compressWorkspaceImageTask(
  image: File,
  requestedFormat: WorkspaceCompressionFormat,
  signal: AbortSignal,
  dimensions?: WorkspaceCompressionDimensions,
  allowAlphaLoss = false,
  encodingOptions?: WorkspaceCompressionEncodingOptions,
): Promise<WorkspaceCompressionResult> {
  if (signal.aborted) return Promise.reject(abortError());

  const worker = new Worker(
    new URL("../workers/workspace-image-compression.worker.ts", import.meta.url),
    { type: "module" },
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      worker.terminate();
      callback();
    };
    const handleAbort = () => finish(() => reject(abortError()));

    signal.addEventListener("abort", handleAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (!message.ok) {
        finish(() => reject(new Error(message.error)));
        return;
      }
      finish(() =>
        resolve({
          blob: new Blob([message.bytes], { type: message.mime }),
          format: message.format,
          name: message.name,
          width: message.width,
          height: message.height,
          operation: "compress",
        }),
      );
    };
    worker.onerror = (event) => {
      finish(() =>
        reject(event.error || new Error(event.message || getWorkspaceEditorLabels(getLang()).compressionWorkerFailed)),
      );
    };

    worker.postMessage({
      image,
      lang: getLang(),
      allowAlphaLoss,
      requestedFormat,
      targetWidth: dimensions?.width,
      targetHeight: dimensions?.height,
      wasmBaseUrl: getPicBindUiConfig().wasmBaseUrl,
      encodingOptions,
    });
  });
}
