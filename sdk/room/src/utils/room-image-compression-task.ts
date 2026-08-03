"use client";

import { getRoomSdkConfig } from "../config";
import { getLang, getShareRoomLabels } from "../locales";
import type {
  RoomCompressionDimensions,
  RoomCompressionFormat,
  RoomCompressionResult,
} from "./room-image-compression";

type WorkerSuccessMessage = {
  ok: true;
  bytes: ArrayBuffer;
  mime: string;
  format: RoomCompressionResult["format"];
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
  return new DOMException(getShareRoomLabels(getLang()).compressionCancelled, "AbortError");
}

export function compressRoomImageTask(
  image: File,
  requestedFormat: RoomCompressionFormat,
  signal: AbortSignal,
  dimensions?: RoomCompressionDimensions,
  allowAlphaLoss = false,
): Promise<RoomCompressionResult> {
  if (signal.aborted) return Promise.reject(abortError());

  const worker = new Worker(
    new URL("../workers/room-image-compression.worker.ts", import.meta.url),
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
        reject(event.error || new Error(event.message || getShareRoomLabels(getLang()).compressionWorkerFailed)),
      );
    };

    worker.postMessage({
      image,
      lang: getLang(),
      allowAlphaLoss,
      requestedFormat,
      targetWidth: dimensions?.width,
      targetHeight: dimensions?.height,
      wasmBaseUrl: getRoomSdkConfig().wasmBaseUrl,
    });
  });
}
