"use client";

import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
import { compressWithWasm } from "@/utils/wasm";

type WorkerSuccessMessage = {
  id: string;
  ok: true;
  bytes: ArrayBuffer;
  mime: string;
  ext: string;
  fileName: string;
};

type WorkerErrorMessage = {
  id: string;
  ok: false;
  error: string;
};

type WorkerMessage = WorkerSuccessMessage | WorkerErrorMessage;

type PendingTask = {
  resolve: (value: {
    blob: Blob;
    mime: string;
    ext: string;
    fileName: string;
  }) => void;
  reject: (reason?: unknown) => void;
};

let workerInstance: Worker | null = null;
const pendingTasks = new Map<string, PendingTask>();

function getWorker() {
  if (typeof window === "undefined") {
    return null;
  }

  if (!workerInstance) {
    workerInstance = new Worker(new URL("../workers/compress.worker.ts", import.meta.url), {
      type: "module",
    });

    workerInstance.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      const task = pendingTasks.get(message.id);
      if (!task) {
        return;
      }

      pendingTasks.delete(message.id);

      if (!message.ok) {
        task.reject(new Error(message.error));
        return;
      }

      task.resolve({
        blob: new Blob([message.bytes], { type: message.mime }),
        mime: message.mime,
        ext: message.ext,
        fileName: message.fileName,
      });
    };

    workerInstance.onerror = (event) => {
      const error = event.error || new Error(event.message || "Compression worker failed");
      pendingTasks.forEach((task) => task.reject(error));
      pendingTasks.clear();
      workerInstance?.terminate();
      workerInstance = null;
    };
  }

  return workerInstance;
}

export async function compressWithWasmWorker(
  file: File,
  quality = 80,
  targetFormat?: OutputFormat,
) {
  const worker = getWorker();
  if (!worker) {
    return compressWithWasm(file, quality, targetFormat);
  }

  return new Promise<{
    blob: Blob;
    mime: string;
    ext: string;
    fileName: string;
  }>((resolve, reject) => {
    const id = crypto.randomUUID();
    pendingTasks.set(id, { resolve, reject });

    try {
      worker.postMessage({ id, file, quality, targetFormat });
    } catch (error) {
      pendingTasks.delete(id);
      reject(error);
    }
  });
}

export function terminateCompressionWorker() {
  pendingTasks.forEach((task) => task.reject(new Error("Compression worker terminated")));
  pendingTasks.clear();
  workerInstance?.terminate();
  workerInstance = null;
}

export { buildCompressedFileName };
