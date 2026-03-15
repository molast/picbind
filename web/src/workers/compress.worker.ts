/// <reference lib="webworker" />

import { compressImageWithAlgorithms } from "@/utils/compress-algorithms";
import type { OutputFormat } from "@/utils/compress-shared";

type WorkerRequest = {
  id: string;
  file: File;
  quality: number;
  targetFormat: OutputFormat;
  allowAlphaLoss?: boolean;
};

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file, quality, targetFormat, allowAlphaLoss } = event.data;

  try {
    const output = await compressImageWithAlgorithms(file, quality, targetFormat, allowAlphaLoss);
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
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error);

    workerScope.postMessage({
      id,
      ok: false,
      error: errorMessage,
    });
  }
};

export {};
