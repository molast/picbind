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
  cleanup(): void;
};

const pendingTasks = new Map<string, PendingTask>();

function createCompressionWorker() {
  const worker = new Worker(new URL("../workers/compress.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    const task = pendingTasks.get(message.id);
    if (!task) {
      worker.terminate();
      return;
    }

    pendingTasks.delete(message.id);
    task.cleanup();

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
        task.cleanup();
        task.reject(error);
      }
    });
    worker.terminate();
  };

  return worker;
}

export async function compressWithWasmWorker(
  file: File,
  quality = 80,
  targetFormat: OutputFormat,
  allowAlphaLoss = false,
  automatic = false,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (typeof window === "undefined") {
    const result = await compressWithWasm(
      file,
      quality,
      targetFormat,
      allowAlphaLoss,
      automatic,
    );
    signal?.throwIfAborted();
    return result;
  }

  const worker = createCompressionWorker();

  return new Promise<{
    blob: Blob;
    mime: string;
    ext: string;
    fileName: string;
  }>((resolve, reject) => {
    const id = createUuid();
    const handleAbort = () => {
      const task = pendingTasks.get(id);
      if (!task) return;
      pendingTasks.delete(id);
      task.cleanup();
      worker.terminate();
      reject(new DOMException("Image compression was cancelled", "AbortError"));
    };
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    pendingTasks.set(id, { resolve, reject, worker, cleanup });
    signal?.addEventListener("abort", handleAbort, { once: true });

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
      cleanup();
      worker.terminate();
      reject(error);
    }
  });
}

export { buildCompressedFileName };
