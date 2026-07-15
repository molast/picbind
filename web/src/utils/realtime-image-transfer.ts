"use client";

export const IMAGE_CHUNK_SIZE = 64 * 1024;
export const MAX_IMAGE_TRANSFER_SIZE = 50 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const LOW_BUFFERED_BYTES = 256 * 1024;

export type ImageTransferMeta = {
  id: string;
  name: string;
  type: string;
  size: number;
  totalChunks: number;
};

type TransferControlMessage =
  | { type: "IMAGE_START"; payload: ImageTransferMeta }
  | { type: "IMAGE_COMPLETE"; payload: { id: string } }
  | { type: "IMAGE_RECEIVED"; payload: { id: string } }
  | { type: "IMAGE_FAILED"; payload: { id: string; reason: string } };

type IncomingTransfer = {
  meta: ImageTransferMeta;
  chunks: ArrayBuffer[];
  receivedBytes: number;
  reportedPercent: number;
};

export type TransferProgress = ImageTransferMeta & {
  transferredBytes: number;
  progress: number;
};

export type ImageReceiverCallbacks = {
  onStart(meta: ImageTransferMeta): void;
  onProgress(progress: TransferProgress): void;
  onComplete(meta: ImageTransferMeta, blob: Blob): void | Promise<void>;
  onError(meta: ImageTransferMeta | null, reason: string): void;
  onReceipt?(id: string): void;
};

function createTransferId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function sendControl(channel: RTCDataChannel, message: TransferControlMessage) {
  channel.send(JSON.stringify(message));
}

function isValidMeta(value: unknown): value is ImageTransferMeta {
  if (!value || typeof value !== "object") {
    return false;
  }
  const meta = value as Partial<ImageTransferMeta>;
  return (
    typeof meta.id === "string" &&
    /^[a-f0-9]{32}$/.test(meta.id) &&
    typeof meta.name === "string" &&
    meta.name.length > 0 &&
    meta.name.length <= 255 &&
    typeof meta.type === "string" &&
    meta.type.startsWith("image/") &&
    typeof meta.size === "number" &&
    Number.isSafeInteger(meta.size) &&
    meta.size >= 0 &&
    meta.size <= MAX_IMAGE_TRANSFER_SIZE &&
    typeof meta.totalChunks === "number" &&
    meta.totalChunks === Math.ceil(meta.size / IMAGE_CHUNK_SIZE)
  );
}

export function sendImageReceipt(channel: RTCDataChannel, id: string) {
  if (channel.readyState === "open") {
    sendControl(channel, { type: "IMAGE_RECEIVED", payload: { id } });
  }
}

async function waitForWritableBuffer(channel: RTCDataChannel) {
  if (channel.bufferedAmount <= MAX_BUFFERED_BYTES) {
    return;
  }

  channel.bufferedAmountLowThreshold = LOW_BUFFERED_BYTES;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("DataChannel backpressure timeout"));
    }, 30_000);
    const handleLow = () => {
      cleanup();
      resolve();
    };
    const handleClosed = () => {
      cleanup();
      reject(new Error("DataChannel closed during transfer"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", handleLow);
      channel.removeEventListener("close", handleClosed);
      channel.removeEventListener("error", handleClosed);
    };
    channel.addEventListener("bufferedamountlow", handleLow, { once: true });
    channel.addEventListener("close", handleClosed, { once: true });
    channel.addEventListener("error", handleClosed, { once: true });
  });
}

export async function sendImageFile(
  channel: RTCDataChannel,
  file: File,
  onProgress: (progress: TransferProgress) => void,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }

  const meta: ImageTransferMeta = {
    id: createTransferId(),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    totalChunks: Math.ceil(file.size / IMAGE_CHUNK_SIZE),
  };
  sendControl(channel, { type: "IMAGE_START", payload: meta });
  onProgress({ ...meta, transferredBytes: 0, progress: 0 });

  let transferredBytes = 0;
  let reportedPercent = 0;
  try {
    for (let offset = 0; offset < file.size; offset += IMAGE_CHUNK_SIZE) {
      await waitForWritableBuffer(channel);
      const chunk = await file.slice(offset, offset + IMAGE_CHUNK_SIZE).arrayBuffer();
      channel.send(chunk);
      transferredBytes += chunk.byteLength;
      const progress = file.size ? transferredBytes / file.size : 1;
      const percent = Math.floor(progress * 100);
      if (percent > reportedPercent || transferredBytes === file.size) {
        reportedPercent = percent;
        onProgress({ ...meta, transferredBytes, progress });
      }
    }
    await waitForWritableBuffer(channel);
    sendControl(channel, { type: "IMAGE_COMPLETE", payload: { id: meta.id } });
    return meta;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Image transfer failed";
    if (channel.readyState === "open") {
      sendControl(channel, {
        type: "IMAGE_FAILED",
        payload: { id: meta.id, reason },
      });
    }
    throw error;
  }
}

export class RealtimeImageReceiver {
  private incoming: IncomingTransfer | null = null;

  constructor(private readonly callbacks: ImageReceiverCallbacks) {}

  handle(data: string | ArrayBuffer) {
    if (typeof data !== "string") {
      this.handleChunk(data);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return;
    }
    const message = parsed as TransferControlMessage;

    if (message.type === "IMAGE_START") {
      if (!isValidMeta(message.payload)) {
        this.callbacks.onError(null, "Received invalid image metadata");
        return;
      }
      if (this.incoming) {
        this.callbacks.onError(
          this.incoming.meta,
          "A new image started before the active transfer completed",
        );
      }
      this.incoming = {
        meta: message.payload,
        chunks: [],
        receivedBytes: 0,
        reportedPercent: 0,
      };
      this.callbacks.onStart(message.payload);
      return;
    }

    if (message.type === "IMAGE_FAILED") {
      const meta = this.incoming?.meta ?? null;
      this.incoming = null;
      const reason =
        typeof message.payload?.reason === "string"
          ? message.payload.reason
          : "Remote image transfer failed";
      this.callbacks.onError(meta, reason);
      return;
    }

    if (message.type === "IMAGE_COMPLETE") {
      if (typeof message.payload?.id === "string") {
        this.complete(message.payload.id);
      }
      return;
    }

    if (message.type === "IMAGE_RECEIVED") {
      if (typeof message.payload?.id === "string") {
        this.callbacks.onReceipt?.(message.payload.id);
      }
    }
  }

  private handleChunk(chunk: ArrayBuffer) {
    if (!this.incoming) {
      this.callbacks.onError(null, "Received an image chunk without metadata");
      return;
    }
    if (
      chunk.byteLength > IMAGE_CHUNK_SIZE ||
      this.incoming.receivedBytes + chunk.byteLength > this.incoming.meta.size
    ) {
      const meta = this.incoming.meta;
      this.incoming = null;
      this.callbacks.onError(meta, "Received an invalid image chunk");
      return;
    }
    this.incoming.chunks.push(chunk);
    this.incoming.receivedBytes += chunk.byteLength;
    const { meta, receivedBytes } = this.incoming;
    const progress = meta.size ? Math.min(receivedBytes / meta.size, 1) : 1;
    const percent = Math.floor(progress * 100);
    if (
      percent > this.incoming.reportedPercent ||
      receivedBytes === meta.size
    ) {
      this.incoming.reportedPercent = percent;
      this.callbacks.onProgress({
        ...meta,
        transferredBytes: receivedBytes,
        progress,
      });
    }
  }

  private complete(id: string) {
    const transfer = this.incoming;
    this.incoming = null;
    if (!transfer || transfer.meta.id !== id) {
      this.callbacks.onError(null, "Image completion did not match the active transfer");
      return;
    }
    if (transfer.receivedBytes !== transfer.meta.size) {
      this.callbacks.onError(
        transfer.meta,
        `Image size mismatch: expected ${transfer.meta.size}, received ${transfer.receivedBytes}`,
      );
      return;
    }
    if (transfer.chunks.length !== transfer.meta.totalChunks) {
      this.callbacks.onError(transfer.meta, "Image chunk count mismatch");
      return;
    }
    const blob = new Blob(transfer.chunks, { type: transfer.meta.type });
    void this.callbacks.onComplete(transfer.meta, blob);
  }
}
