"use client";

import type { ImagePlaceholderMetadata } from "./share-placeholder";

export const IMAGE_CHUNK_SIZE = 16 * 1024;
const CHUNK_INDEX_BYTES = 4;
export const WEAK_NETWORK_CHUNK_SIZE = 1200 - CHUNK_INDEX_BYTES;
export const MAX_IMAGE_TRANSFER_SIZE = 50 * 1024 * 1024;
const MAX_DATA_CHANNEL_PAYLOAD_BYTES = 1200;
const MAX_THUMBNAIL_BYTES = 256;
// Keep the SCTP queue deliberately small for mobile and Wi-Fi connections.
// Pause at the high-water mark, then wait for a real drain before resuming.
const BUFFER_HIGH_WATER_BYTES = 256 * 1024;
const BUFFER_LOW_WATER_BYTES = 64 * 1024;
const BUFFER_DRAIN_TIMEOUT_MS = 60_000;

export type ImageTransferMeta = {
  id: string;
  name: string;
  type: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
};

type TransferControlMessage =
  | {
      type: "IMAGE_PLACEHOLDER";
      payload: ImageTransferMeta & { placeholder: ImagePlaceholderMetadata };
    }
  | {
      type: "IMAGE_PREVIEW";
      payload: ImageTransferMeta & { thumbnailBase64: string };
    }
  | { type: "IMAGE_START"; payload: ImageTransferMeta }
  | { type: "IMAGE_READY"; payload: { id: string } }
  | { type: "IMAGE_COMPLETE"; payload: { id: string } }
  | { type: "IMAGE_RECEIVED"; payload: { id: string } }
  | { type: "IMAGE_DELETE"; payload: { id: string } }
  | {
      type: "R2_IMAGE_AVAILABLE";
      payload: ImageTransferMeta & { objectKey: string; expiresAt: number };
    }
  | { type: "IMAGE_FAILED"; payload: { id: string; reason: string } };

type IncomingTransfer = {
  meta: ImageTransferMeta;
  chunks: Map<number, ArrayBuffer>;
  receivedBytes: number;
  reportedPercent: number;
  completeRequested: boolean;
};

export type TransferProgress = ImageTransferMeta & {
  transferredBytes: number;
  progress: number;
};

export type ImageReceiverCallbacks = {
  onStart(meta: ImageTransferMeta): void;
  onPlaceholder?(
    meta: ImageTransferMeta,
    placeholder: ImagePlaceholderMetadata,
  ): void | Promise<void>;
  onPreview?(meta: ImageTransferMeta, thumbnail: Blob): void | Promise<void>;
  onProgress(progress: TransferProgress): void;
  onComplete(meta: ImageTransferMeta, blob: Blob): void | Promise<void>;
  onError(meta: ImageTransferMeta | null, reason: string): void;
  onReceipt?(id: string): void;
  onReady?(id: string): void;
  onDelete?(id: string): void | Promise<void>;
  onR2Available?(
    meta: ImageTransferMeta,
    objectKey: string,
    expiresAt: number,
  ): void | Promise<void>;
};

function createTransferId() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function createImageTransferMeta(
  file: Blob & { name?: string },
  id = createTransferId(),
  chunkSize = IMAGE_CHUNK_SIZE,
) {
  return {
    id,
    name: file.name || "shared-image",
    type: file.type,
    size: file.size,
    chunkSize,
    totalChunks: Math.ceil(file.size / chunkSize),
  } satisfies ImageTransferMeta;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeThumbnail(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_THUMBNAIL_BYTES * 2) {
    return null;
  }
  try {
    const binary = atob(value);
    if (binary.length > MAX_THUMBNAIL_BYTES) {
      return null;
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  } catch {
    return null;
  }
}

function sendControl(channel: RTCDataChannel, message: TransferControlMessage) {
  const payload = JSON.stringify(message);
  if (new TextEncoder().encode(payload).byteLength > MAX_DATA_CHANNEL_PAYLOAD_BYTES) {
    throw new Error("Image transfer control message exceeds the 1200-byte payload limit");
  }
  channel.send(payload);
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
    typeof meta.chunkSize === "number" &&
    Number.isSafeInteger(meta.chunkSize) &&
    meta.chunkSize >= WEAK_NETWORK_CHUNK_SIZE &&
    meta.chunkSize <= IMAGE_CHUNK_SIZE &&
    typeof meta.totalChunks === "number" &&
    meta.totalChunks === Math.ceil(meta.size / meta.chunkSize)
  );
}

function isValidPlaceholder(value: unknown): value is ImagePlaceholderMetadata {
  if (!value || typeof value !== "object") return false;
  const placeholder = value as Partial<ImagePlaceholderMetadata>;
  return (
    Number.isInteger(placeholder.width) &&
    Number(placeholder.width) > 0 &&
    Number(placeholder.width) <= 100_000 &&
    Number.isInteger(placeholder.height) &&
    Number(placeholder.height) > 0 &&
    Number(placeholder.height) <= 100_000 &&
    typeof placeholder.dominantColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(placeholder.dominantColor) &&
    typeof placeholder.blurHash === "string" &&
    placeholder.blurHash.length >= 6 &&
    placeholder.blurHash.length <= 100
  );
}

export function sendImageReceipt(channel: RTCDataChannel, id: string) {
  if (channel.readyState === "open") {
    sendControl(channel, { type: "IMAGE_RECEIVED", payload: { id } });
  }
}

export function sendImageReady(channel: RTCDataChannel, id: string) {
  if (channel.readyState === "open") {
    sendControl(channel, { type: "IMAGE_READY", payload: { id } });
  }
}

export function sendImagePlaceholder(
  channel: RTCDataChannel,
  meta: ImageTransferMeta,
  placeholder: ImagePlaceholderMetadata,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  sendControl(channel, {
    type: "IMAGE_PLACEHOLDER",
    payload: { ...meta, placeholder },
  });
}

export function sendImageDelete(channel: RTCDataChannel, id: string) {
  if (channel.readyState === "open") {
    sendControl(channel, { type: "IMAGE_DELETE", payload: { id } });
  }
}

export function sendR2ImageAvailable(
  channel: RTCDataChannel,
  meta: ImageTransferMeta,
  objectKey: string,
  expiresAt: number,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  sendControl(channel, {
    type: "R2_IMAGE_AVAILABLE",
    payload: { ...meta, objectKey, expiresAt },
  });
}

export function sendImagePreview(
  channel: RTCDataChannel,
  meta: ImageTransferMeta,
  thumbnail: Uint8Array,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  if (thumbnail.byteLength > MAX_THUMBNAIL_BYTES) {
    throw new Error("Generated thumbnail is too large");
  }
  sendControl(channel, {
    type: "IMAGE_PREVIEW",
    payload: { ...meta, thumbnailBase64: bytesToBase64(thumbnail) },
  });
}

async function waitForWritableBuffer(channel: RTCDataChannel) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel closed during transfer");
  }
  if (channel.bufferedAmount <= BUFFER_HIGH_WATER_BYTES) {
    return;
  }

  channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER_BYTES;
  await new Promise<void>((resolve, reject) => {
    let timeoutId: number | undefined;
    const cleanUp = () => {
      channel.removeEventListener("bufferedamountlow", onBufferedAmountLow);
      channel.removeEventListener("close", onClose);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
    const onBufferedAmountLow = () => {
      if (channel.bufferedAmount <= BUFFER_LOW_WATER_BYTES) {
        cleanUp();
        resolve();
      }
    };
    const onClose = () => {
      cleanUp();
      reject(new Error("DataChannel closed during transfer"));
    };

    channel.addEventListener("bufferedamountlow", onBufferedAmountLow);
    channel.addEventListener("close", onClose, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanUp();
      reject(new Error("The peer stopped receiving image data"));
    }, BUFFER_DRAIN_TIMEOUT_MS);
    // The buffer can drain between the first check and listener registration.
    onBufferedAmountLow();
  });
}

export async function sendImageFile(
  controlChannel: RTCDataChannel,
  fileChannel: RTCDataChannel,
  file: File,
  onProgress: (progress: TransferProgress) => void,
  transferId?: string,
  chunkSize = IMAGE_CHUNK_SIZE,
  waitUntilReady?: (id: string) => Promise<void>,
) {
  if (
    controlChannel.readyState !== "open" ||
    fileChannel.readyState !== "open"
  ) {
    throw new Error("DataChannels are not open");
  }

  const meta = createImageTransferMeta(file, transferId, chunkSize);
  sendControl(controlChannel, { type: "IMAGE_START", payload: meta });
  await waitUntilReady?.(meta.id);
  onProgress({ ...meta, transferredBytes: 0, progress: 0 });

  let transferredBytes = 0;
  let reportedPercent = 0;
  try {
    for (let offset = 0; offset < file.size; offset += meta.chunkSize) {
      await waitForWritableBuffer(fileChannel);
      const chunk = await file.slice(offset, offset + meta.chunkSize).arrayBuffer();
      const frame = new Uint8Array(CHUNK_INDEX_BYTES + chunk.byteLength);
      new DataView(frame.buffer).setUint32(0, offset / meta.chunkSize);
      frame.set(new Uint8Array(chunk), CHUNK_INDEX_BYTES);
      fileChannel.send(frame.buffer);
      transferredBytes += chunk.byteLength;
      const progress = file.size ? transferredBytes / file.size : 1;
      const percent = Math.floor(progress * 100);
      if (percent > reportedPercent || transferredBytes === file.size) {
        reportedPercent = percent;
        onProgress({ ...meta, transferredBytes, progress });
      }
    }
    await waitForWritableBuffer(fileChannel);
    sendControl(controlChannel, { type: "IMAGE_COMPLETE", payload: { id: meta.id } });
    return meta;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Image transfer failed";
    if (controlChannel.readyState === "open") {
      sendControl(controlChannel, {
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

    if (message.type === "IMAGE_PLACEHOLDER") {
      if (
        !isValidMeta(message.payload) ||
        !isValidPlaceholder(message.payload.placeholder)
      ) {
        this.callbacks.onError(null, "Received invalid placeholder metadata");
        return;
      }
      void this.callbacks.onPlaceholder?.(
        message.payload,
        message.payload.placeholder,
      );
      return;
    }

    if (message.type === "IMAGE_PREVIEW") {
      if (!isValidMeta(message.payload)) {
        this.callbacks.onError(null, "Received invalid image preview metadata");
        return;
      }
      const thumbnail = decodeThumbnail(message.payload.thumbnailBase64);
      if (!thumbnail) {
        this.callbacks.onError(message.payload, "Received an invalid image preview");
        return;
      }
      void this.callbacks.onPreview?.(message.payload, thumbnail);
      return;
    }

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
        chunks: new Map(),
        receivedBytes: 0,
        reportedPercent: 0,
        completeRequested: false,
      };
      this.callbacks.onStart(message.payload);
      return;
    }

    if (message.type === "IMAGE_READY") {
      if (typeof message.payload?.id === "string") {
        this.callbacks.onReady?.(message.payload.id);
      }
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
      return;
    }

    if (message.type === "IMAGE_DELETE") {
      const id = message.payload?.id;
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) return;
      if (this.incoming?.meta.id === id) {
        this.incoming = null;
      }
      void this.callbacks.onDelete?.(id);
      return;
    }

    if (message.type === "R2_IMAGE_AVAILABLE") {
      if (
        !isValidMeta(message.payload) ||
        typeof message.payload.objectKey !== "string" ||
        message.payload.objectKey.length > 512 ||
        !/^[A-Za-z0-9_\/-]+$/.test(message.payload.objectKey) ||
        typeof message.payload.expiresAt !== "number" ||
        !Number.isSafeInteger(message.payload.expiresAt)
      ) {
        this.callbacks.onError(null, "Received invalid R2 image metadata");
        return;
      }
      void this.callbacks.onR2Available?.(
        message.payload,
        message.payload.objectKey,
        message.payload.expiresAt,
      );
    }
  }

  private handleChunk(frame: ArrayBuffer) {
    if (!this.incoming) {
      this.callbacks.onError(null, "Received an image chunk without metadata");
      return;
    }
    if (frame.byteLength <= CHUNK_INDEX_BYTES) {
      this.callbacks.onError(this.incoming.meta, "Received an invalid image chunk frame");
      return;
    }
    const index = new DataView(frame).getUint32(0);
    const chunk = frame.slice(CHUNK_INDEX_BYTES);
    const incomingMeta = this.incoming.meta;
    if (
      index >= incomingMeta.totalChunks ||
      this.incoming.chunks.has(index) ||
      chunk.byteLength > incomingMeta.chunkSize ||
      this.incoming.receivedBytes + chunk.byteLength > this.incoming.meta.size
    ) {
      const meta = this.incoming.meta;
      this.incoming = null;
      this.callbacks.onError(meta, "Received an invalid image chunk");
      return;
    }
    this.incoming.chunks.set(index, chunk);
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
    if (this.incoming.completeRequested && receivedBytes === meta.size) {
      this.complete(meta.id);
    }
  }

  private complete(id: string) {
    const transfer = this.incoming;
    if (!transfer || transfer.meta.id !== id) {
      this.callbacks.onError(null, "Image completion did not match the active transfer");
      return;
    }
    if (transfer.receivedBytes !== transfer.meta.size) {
      transfer.completeRequested = true;
      return;
    }
    this.incoming = null;
    if (transfer.chunks.size !== transfer.meta.totalChunks) {
      this.callbacks.onError(
        transfer.meta,
        "Image chunk count mismatch",
      );
      return;
    }
    const chunks = Array.from({ length: transfer.meta.totalChunks }, (_, index) => transfer.chunks.get(index));
    if (chunks.some((chunk) => !chunk)) {
      this.callbacks.onError(transfer.meta, "Image chunks are incomplete");
      return;
    }
    const blob = new Blob(chunks as BlobPart[], { type: transfer.meta.type });
    void this.callbacks.onComplete(transfer.meta, blob);
  }
}
