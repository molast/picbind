"use client";

export type HttpTransferProgress = {
  transferredBytes: number;
  size: number;
  progress: number;
};

export type R2UploadRetry = {
  failedAttempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  error: Error;
};

const R2_UPLOAD_MAX_ATTEMPTS = 5;
const R2_UPLOAD_RETRY_BASE_DELAY_MS = 400;

class R2UploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "R2UploadError";
  }
}

function uploadFileToR2Once(
  uploadUrl: string,
  file: File,
  onProgress: (progress: HttpTransferProgress) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const onAbort = () => request.abort();
    if (signal?.aborted) {
      reject(new DOMException("R2 upload was cancelled", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanUp = () => signal?.removeEventListener("abort", onAbort);
    request.open("PUT", uploadUrl);
    request.setRequestHeader("content-type", file.type);
    request.upload.onprogress = (event) => {
      const transferredBytes = event.loaded;
      onProgress({
        transferredBytes,
        size: file.size,
        progress: file.size ? Math.min(1, transferredBytes / file.size) : 1,
      });
    };
    request.onerror = () => {
      cleanUp();
      reject(new R2UploadError("R2 upload failed"));
    };
    request.onabort = () => {
      cleanUp();
      reject(new DOMException("R2 upload was cancelled", "AbortError"));
    };
    request.onload = () => {
      cleanUp();
      if (request.status >= 200 && request.status < 300) {
        onProgress({ transferredBytes: file.size, size: file.size, progress: 1 });
        resolve();
      } else {
        reject(new R2UploadError(`R2 upload failed (${request.status})`, request.status));
      }
    };
    request.send(file);
  });
}

function isRetryableR2UploadError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (!(error instanceof R2UploadError) || error.status === undefined) return true;
  return error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function waitForR2UploadRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("R2 upload was cancelled", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("R2 upload was cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function uploadFileToR2(
  uploadUrl: string,
  file: File,
  onProgress: (progress: HttpTransferProgress) => void,
  signal?: AbortSignal,
  onRetry?: (retry: R2UploadRetry) => void,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= R2_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await uploadFileToR2Once(uploadUrl, file, onProgress, signal);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === R2_UPLOAD_MAX_ATTEMPTS || !isRetryableR2UploadError(error)) {
        throw error;
      }
      onProgress({ transferredBytes: 0, size: file.size, progress: 0 });
      const delay = R2_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      onRetry?.({
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        maxAttempts: R2_UPLOAD_MAX_ATTEMPTS,
        delayMs: delay,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      await waitForR2UploadRetry(delay, signal);
    }
  }
  throw lastError;
}

export async function downloadFileFromR2(
  downloadUrl: string,
  type: string,
  expectedSize: number,
  onProgress: (progress: HttpTransferProgress) => void,
) {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`R2 download failed (${response.status})`);
  }
  if (!response.body) {
    const blob = await response.blob();
    onProgress({ transferredBytes: blob.size, size: expectedSize, progress: 1 });
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let transferredBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = new ArrayBuffer(value.byteLength);
    new Uint8Array(chunk).set(value);
    chunks.push(chunk);
    transferredBytes += value.byteLength;
    onProgress({
      transferredBytes,
      size: expectedSize,
      progress: expectedSize
        ? Math.min(1, transferredBytes / expectedSize)
        : 0,
    });
  }
  if (transferredBytes !== expectedSize) {
    throw new Error(
      `R2 download size mismatch: expected ${expectedSize}, received ${transferredBytes}`,
    );
  }
  return new Blob(chunks, { type });
}
