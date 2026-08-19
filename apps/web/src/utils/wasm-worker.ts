"use client";

import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
import { isTauri } from "@tauri-apps/api/core";
import { createUuid } from "@/utils/uuid";
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
  worker: Worker;
};

const pendingTasks = new Map<string, PendingTask>();
const activeWorkers = new Set<Worker>();

function createCompressionWorker() {
  const worker = new Worker(new URL("../workers/compress.worker.ts", import.meta.url), {
    type: "module",
  });
  activeWorkers.add(worker);

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    const task = pendingTasks.get(message.id);
    if (!task) {
      worker.terminate();
      activeWorkers.delete(worker);
      return;
    }

    pendingTasks.delete(message.id);

    if (!message.ok) {
      task.reject(new Error(message.error));
    } else {
      task.resolve({
        blob: new Blob([message.bytes], { type: message.mime }),
        mime: message.mime,
        ext: message.ext,
        fileName: message.fileName,
      });
    }

    worker.terminate();
    activeWorkers.delete(worker);
  };

  worker.onerror = (event) => {
    const location = event.filename
      ? ` (${event.filename}:${event.lineno}:${event.colno})`
      : "";
    const error =
      event.error instanceof Error
        ? event.error
        : new Error(`${event.message || "Compression worker failed"}${location}`);
    pendingTasks.forEach((task, id) => {
      if (task.worker === worker) {
        pendingTasks.delete(id);
        task.reject(error);
      }
    });
    worker.terminate();
    activeWorkers.delete(worker);
  };

  return worker;
}

export async function compressWithWasmWorker(
  file: File,
  quality = 80,
  targetFormat: OutputFormat,
  allowAlphaLoss = false,
  automatic = false,
) {
  if (typeof window === "undefined") {
    return compressWithWasm(
      file,
      quality,
      targetFormat,
      allowAlphaLoss,
      automatic,
    );
  }

  const worker = createCompressionWorker();

  return new Promise<{
    blob: Blob;
    mime: string;
    ext: string;
    fileName: string;
  }>((resolve, reject) => {
    const id = createUuid();
    pendingTasks.set(id, { resolve, reject, worker });

    try {
      worker.postMessage({
        id,
        file,
        quality,
        targetFormat,
        allowAlphaLoss,
        automatic,
        allowThreadedAvif: !isTauri(),
      });
    } catch (error) {
      pendingTasks.delete(id);
      worker.terminate();
      activeWorkers.delete(worker);
      reject(error);
    }
  });
}

export function terminateCompressionWorker() {
  pendingTasks.forEach((task) => task.reject(new Error("Compression worker terminated")));
  pendingTasks.clear();
  activeWorkers.forEach((worker) => worker.terminate());
  activeWorkers.clear();
}

export { buildCompressedFileName };
