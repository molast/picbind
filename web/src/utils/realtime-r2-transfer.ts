"use client";

export type HttpTransferProgress = {
  transferredBytes: number;
  size: number;
  progress: number;
};

export function uploadFileToR2(
  uploadUrl: string,
  file: File,
  onProgress: (progress: HttpTransferProgress) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
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
    request.onerror = () => reject(new Error("R2 upload failed"));
    request.onabort = () => reject(new Error("R2 upload was cancelled"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress({ transferredBytes: file.size, size: file.size, progress: 1 });
        resolve();
      } else {
        reject(new Error(`R2 upload failed (${request.status})`));
      }
    };
    request.send(file);
  });
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
