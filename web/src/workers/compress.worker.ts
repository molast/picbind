/// <reference lib="webworker" />

import { compressImageWithAlgorithms } from "@/utils/compress-algorithms";
import type { OutputFormat } from "@/utils/compress-shared";

type WorkerRequest = {
  id: string;
  file: File;
  quality: number;
  targetFormat?: OutputFormat;
};

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file, quality, targetFormat } = event.data;

  try {
    const output = await compressImageWithAlgorithms(file, quality, targetFormat);
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    const mime = output.mime;
    const ext = output.ext;
    const cloned = new Uint8Array(bytes.length);
    cloned.set(bytes);

    workerScope.postMessage(
      {
        id,
        ok: true,
        bytes: cloned.buffer,
        mime,
        ext,
        fileName: output.fileName,
      },
      [cloned.buffer],
    );
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown compression error",
    });
  }
};

export {};
