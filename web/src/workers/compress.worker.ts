/// <reference lib="webworker" />

import {
  compressImageAutomatically,
  compressImageWithAlgorithms,
} from "@/utils/compress-algorithms";
import type { OutputFormat } from "@/utils/compress-shared";

type WorkerRequest = {
  id: string;
  file: File;
  quality: number;
  targetFormat: OutputFormat;
  allowAlphaLoss?: boolean;
  automatic?: boolean;
  allowThreadedAvif?: boolean;
};

const workerScope = self as DedicatedWorkerGlobalScope;

function describeWorkerError(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  if (error instanceof ErrorEvent) {
    const location = error.filename
      ? ` (${error.filename}:${error.lineno}:${error.colno})`
      : "";
    const nested = error.error instanceof Error
      ? `: ${error.error.stack || error.error.message}`
      : "";
    return `${error.message || "Worker resource failed to load"}${location}${nested}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const {
    id,
    file,
    quality,
    targetFormat,
    allowAlphaLoss,
    automatic,
    allowThreadedAvif,
  } = event.data;
  const runtimeOptions = { allowThreadedAvif };

  try {
    const output = automatic
      ? await compressImageAutomatically(file, quality, runtimeOptions)
      : await compressImageWithAlgorithms(
          file,
          quality,
          targetFormat,
          allowAlphaLoss,
          runtimeOptions,
        );
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    const mime = output.mime;
    const ext = output.ext;

    workerScope.postMessage(
      {
        id,
        ok: true,
        bytes: bytes.buffer,
        mime,
        ext,
        fileName: output.fileName,
      },
      [bytes.buffer],
    );
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: describeWorkerError(error),
    });
  }
};

export {};
