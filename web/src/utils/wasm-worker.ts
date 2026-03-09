"use client";

import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
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

const WORKER_POOL_SIZE = 2;
let workerPool: Worker[] = [];
const workerLoads = new Map<Worker, number>();
const pendingTasks = new Map<string, PendingTask>();

function getWorkerPool() {
  if (typeof window === "undefined") {
    return [];
  }

  if (!workerPool.length) {
    workerPool = Array.from({ length: WORKER_POOL_SIZE }, () =>
      new Worker(new URL("../workers/compress.worker.ts", import.meta.url), {
        type: "module",
      }),
    );
    workerPool.forEach((worker) => {
      workerLoads.set(worker, 0);

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        const task = pendingTasks.get(message.id);
        if (!task) {
          return;
        }

        pendingTasks.delete(message.id);
        workerLoads.set(worker, Math.max(0, (workerLoads.get(worker) || 0) - 1));

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

      worker.onerror = (event) => {
        const error = event.error || new Error(event.message || "Compression worker failed");
        pendingTasks.forEach((task, id) => {
          if (task.worker === worker) {
            pendingTasks.delete(id);
            task.reject(error);
          }
        });
        workerLoads.set(worker, 0);
      };
    });
  }

  return workerPool;
}

function pickWorker(workers: Worker[]) {
  let selected = workers[0];
  let minLoad = workerLoads.get(selected) || 0;
  for (let index = 1; index < workers.length; index += 1) {
    const worker = workers[index];
    const load = workerLoads.get(worker) || 0;
    if (load < minLoad) {
      minLoad = load;
      selected = worker;
    }
  }
  return selected;
}

export async function compressWithWasmWorker(
  file: File,
  quality = 80,
  targetFormat?: OutputFormat,
  allowAlphaLoss = false,
) {
  const workers = getWorkerPool();
  if (!workers.length) {
    return compressWithWasm(file, quality, targetFormat, allowAlphaLoss);
  }
  const worker = pickWorker(workers);

  return new Promise<{
    blob: Blob;
    mime: string;
    ext: string;
    fileName: string;
  }>((resolve, reject) => {
    const id = createUuid();
    pendingTasks.set(id, { resolve, reject, worker });
    workerLoads.set(worker, (workerLoads.get(worker) || 0) + 1);

    try {
      worker.postMessage({ id, file, quality, targetFormat, allowAlphaLoss });
    } catch (error) {
      pendingTasks.delete(id);
      workerLoads.set(worker, Math.max(0, (workerLoads.get(worker) || 0) - 1));
      reject(error);
    }
  });
}

export function terminateCompressionWorker() {
  pendingTasks.forEach((task) => task.reject(new Error("Compression worker terminated")));
  pendingTasks.clear();
  workerPool.forEach((worker) => worker.terminate());
  workerPool = [];
  workerLoads.clear();
}

export { buildCompressedFileName };
