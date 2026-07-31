"use client";

import type { ImagePlaceholderMetadata } from "./share-placeholder";
import type { RealtimeMessageChannel } from "./weak-network-socket";
import type { ImageObjectMetadata } from "./image-object";

export const IMAGE_CHUNK_SIZE = 16 * 1024;
const TRANSFER_ID_BYTES = 16;
const CHUNK_INDEX_BYTES = 4;
const FRAME_HEADER_BYTES = TRANSFER_ID_BYTES + CHUNK_INDEX_BYTES;
export const WEAK_NETWORK_CHUNK_SIZE = 1200 - FRAME_HEADER_BYTES;
const MAX_DATA_CHANNEL_PAYLOAD_BYTES = 1200;
const MAX_THUMBNAIL_BYTES = 256;
const MAX_PREVIEW_THUMBNAIL_BYTES = 10 * 1024;
const PREVIEW_THUMBNAIL_CHUNK_SIZE = 600;
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
  workspace?: ImageObjectMetadata;
};

type TransferInstruction =
  | { type: "IMAGE_PLACEHOLDER_PENDING"; payload: ImageTransferMeta }
  | {
      type: "IMAGE_PLACEHOLDER";
      payload: ImageTransferMeta & { placeholder: ImagePlaceholderMetadata };
    }
  | {
      type: "IMAGE_PREVIEW";
      payload: ImageTransferMeta & { thumbnailBase64: string };
    }
  | {
      type: "IMAGE_PLACEHOLDER_ACK";
      payload: { id: string; width: number; height: number };
    }
  | {
      type: "IMAGE_THUMBNAIL_START";
      payload: {
        id: string;
        transferId: string;
        size: number;
        totalChunks: number;
      };
    }
  | {
      type: "IMAGE_THUMBNAIL_CHUNK";
      payload: { transferId: string; index: number; data: string };
    }
  | { type: "IMAGE_THUMBNAIL_COMPLETE"; payload: { transferId: string } }
  | { type: "IMAGE_START"; payload: ImageTransferMeta }
  | { type: "IMAGE_READY"; payload: { id: string } }
  | { type: "IMAGE_COMPLETE"; payload: { id: string } }
  | { type: "IMAGE_RECEIVED"; payload: { id: string } }
  | { type: "IMAGE_DELETE"; payload: { id: string } }
  | { type: "IMAGE_CANCEL"; payload: { id: string } }
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

type IncomingThumbnail = {
  imageId: string;
  transferId: string;
  size: number;
  totalChunks: number;
  chunks: Map<number, Uint8Array>;
  receivedBytes: number;
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
  onPlaceholderPending?(meta: ImageTransferMeta): void | Promise<void>;
  onPreview?(meta: ImageTransferMeta, thumbnail: Blob): void | Promise<void>;
  onPlaceholderAck?(id: string, width: number, height: number): void;
  onThumbnail?(id: string, thumbnail: Blob): void | Promise<void>;
  onProgress(progress: TransferProgress): void;
  onComplete(meta: ImageTransferMeta, blob: Blob): void | Promise<void>;
  onError(meta: ImageTransferMeta | null, reason: string): void;
  onReceipt?(id: string): void;
  onReady?(id: string): void;
  onDelete?(id: string): void | Promise<void>;
  onCancel?(id: string): void | Promise<void>;
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
  workspace?: ImageObjectMetadata,
) {
  return {
    id,
    name: file.name || "shared-image",
    type: file.type,
    size: file.size,
    chunkSize,
    totalChunks: Math.ceil(file.size / chunkSize),
    ...(workspace ? { workspace } : {}),
  } satisfies ImageTransferMeta;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string, maxBytes: number) {
  try {
    const binary = atob(value);
    if (binary.length > maxBytes) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function transferIdToBytes(id: string) {
  return Uint8Array.from({ length: TRANSFER_ID_BYTES }, (_, index) =>
    Number.parseInt(id.slice(index * 2, index * 2 + 2), 16),
  );
}

function transferIdFromBytes(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function sendInstruction(channel: RealtimeMessageChannel, message: TransferInstruction) {
  const payload = JSON.stringify(message);
  if (new TextEncoder().encode(payload).byteLength > MAX_DATA_CHANNEL_PAYLOAD_BYTES) {
    throw new Error("Image transfer instruction exceeds the 1200-byte payload limit");
  }
  channel.send(payload);
}

function isValidMeta(
  value: unknown,
  maxImageTransferSize: number,
): value is ImageTransferMeta {
  if (!value || typeof value !== "object") {
    return false;
  }
  const meta = value as Partial<ImageTransferMeta>;
  const workspace = meta.workspace;
  const validWorkspace =
    workspace === undefined ||
    (typeof workspace === "object" &&
      workspace !== null &&
      typeof workspace.rootImageId === "string" &&
      /^[a-f0-9]{32}$/.test(workspace.rootImageId) &&
      (workspace.parentImageId === null ||
        (typeof workspace.parentImageId === "string" &&
          /^[a-f0-9]{32}$/.test(workspace.parentImageId))) &&
      typeof workspace.ownerId === "string" &&
      workspace.ownerId.length <= 128 &&
      Number.isSafeInteger(workspace.width) &&
      workspace.width >= 0 &&
      workspace.width <= 100_000 &&
      Number.isSafeInteger(workspace.height) &&
      workspace.height >= 0 &&
      workspace.height <= 100_000 &&
      ["local", "received", "compressed", "review-export"].includes(
        workspace.source,
      ) &&
      [
        "original",
        "compress",
        "convert",
        "crop",
        "resize",
        "adjust",
        "review-export",
      ].includes(workspace.operation) &&
      Number.isSafeInteger(workspace.version) &&
      workspace.version >= 1 &&
      (workspace.outboxOrigin === undefined ||
        ["library", "direct", "received"].includes(workspace.outboxOrigin)) &&
      (workspace.createdAt === undefined ||
        (Number.isSafeInteger(workspace.createdAt) && workspace.createdAt > 0)) &&
      (workspace.updatedAt === undefined ||
        (Number.isSafeInteger(workspace.updatedAt) && workspace.updatedAt > 0)) &&
      (workspace.likeCount === undefined ||
        (Number.isSafeInteger(workspace.likeCount) && workspace.likeCount >= 0)));
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
    meta.size <= maxImageTransferSize &&
    typeof meta.chunkSize === "number" &&
    Number.isSafeInteger(meta.chunkSize) &&
    meta.chunkSize >= WEAK_NETWORK_CHUNK_SIZE &&
    meta.chunkSize <= IMAGE_CHUNK_SIZE &&
    typeof meta.totalChunks === "number" &&
    meta.totalChunks === Math.ceil(meta.size / meta.chunkSize) &&
    validWorkspace
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

export function sendImageReceipt(channel: RealtimeMessageChannel, id: string) {
  if (channel.readyState === "open") {
    sendInstruction(channel, { type: "IMAGE_RECEIVED", payload: { id } });
  }
}

export function sendImageReady(channel: RealtimeMessageChannel, id: string) {
  if (channel.readyState === "open") {
    sendInstruction(channel, { type: "IMAGE_READY", payload: { id } });
  }
}

export function sendImagePlaceholder(
  channel: RealtimeMessageChannel,
  meta: ImageTransferMeta,
  placeholder: ImagePlaceholderMetadata,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  sendInstruction(channel, {
    type: "IMAGE_PLACEHOLDER",
    payload: { ...meta, placeholder },
  });
}

export function sendImagePlaceholderPending(
  channel: RealtimeMessageChannel,
  meta: ImageTransferMeta,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  sendInstruction(channel, {
    type: "IMAGE_PLACEHOLDER_PENDING",
    payload: meta,
  });
}

export function sendImagePlaceholderAck(
  channel: RealtimeMessageChannel,
  id: string,
  width: number,
  height: number,
) {
  if (channel.readyState !== "open") return false;
  const normalizedWidth = Math.max(1, Math.min(4096, Math.round(width)));
  const normalizedHeight = Math.max(1, Math.min(4096, Math.round(height)));
  sendInstruction(channel, {
    type: "IMAGE_PLACEHOLDER_ACK",
    payload: { id, width: normalizedWidth, height: normalizedHeight },
  });
  return true;
}

export function sendImageDelete(channel: RealtimeMessageChannel, id: string) {
  if (channel.readyState === "open") {
    sendInstruction(channel, { type: "IMAGE_DELETE", payload: { id } });
  }
}

export function sendImageCancel(channel: RealtimeMessageChannel, id: string) {
  if (channel.readyState === "open") {
    sendInstruction(channel, { type: "IMAGE_CANCEL", payload: { id } });
  }
}

export function sendR2ImageAvailable(
  channel: RealtimeMessageChannel,
  meta: ImageTransferMeta,
  objectKey: string,
  expiresAt: number,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  sendInstruction(channel, {
    type: "R2_IMAGE_AVAILABLE",
    payload: { ...meta, objectKey, expiresAt },
  });
}

export function sendImagePreview(
  channel: RealtimeMessageChannel,
  meta: ImageTransferMeta,
  thumbnail: Uint8Array,
) {
  if (channel.readyState !== "open") {
    throw new Error("DataChannel is not open");
  }
  if (thumbnail.byteLength > MAX_THUMBNAIL_BYTES) {
    throw new Error("Generated thumbnail is too large");
  }
  sendInstruction(channel, {
    type: "IMAGE_PREVIEW",
    payload: { ...meta, thumbnailBase64: bytesToBase64(thumbnail) },
  });
}

export async function sendImageThumbnail(
  thumbnailChannel: RealtimeMessageChannel,
  imageId: string,
  thumbnail: Uint8Array,
) {
  if (thumbnailChannel.readyState !== "open") {
    throw new Error("Image thumbnail channel is not open");
  }
  if (thumbnail.byteLength === 0 || thumbnail.byteLength > MAX_PREVIEW_THUMBNAIL_BYTES) {
    throw new Error("Generated WebP thumbnail is invalid");
  }
  const transferId = createTransferId();
  const totalChunks = Math.ceil(
    thumbnail.byteLength / PREVIEW_THUMBNAIL_CHUNK_SIZE,
  );
  sendInstruction(thumbnailChannel, {
    type: "IMAGE_THUMBNAIL_START",
    payload: {
      id: imageId,
      transferId,
      size: thumbnail.byteLength,
      totalChunks,
    },
  });
  for (
    let offset = 0;
    offset < thumbnail.byteLength;
    offset += PREVIEW_THUMBNAIL_CHUNK_SIZE
  ) {
    const chunk = thumbnail.subarray(
      offset,
      offset + PREVIEW_THUMBNAIL_CHUNK_SIZE,
    );
    sendInstruction(thumbnailChannel, {
      type: "IMAGE_THUMBNAIL_CHUNK",
      payload: {
        transferId,
        index: offset / PREVIEW_THUMBNAIL_CHUNK_SIZE,
        data: bytesToBase64(chunk),
      },
    });
  }
  sendInstruction(thumbnailChannel, {
    type: "IMAGE_THUMBNAIL_COMPLETE",
    payload: { transferId },
  });
}

async function waitForWritableBuffer(
  channel: RTCDataChannel,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException("Transfer cancelled", "AbortError");
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
      signal?.removeEventListener("abort", onAbort);
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
    const onAbort = () => {
      cleanUp();
      reject(new DOMException("Transfer cancelled", "AbortError"));
    };

    channel.addEventListener("bufferedamountlow", onBufferedAmountLow);
    channel.addEventListener("close", onClose, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanUp();
      reject(new Error("The peer stopped receiving image data"));
    }, BUFFER_DRAIN_TIMEOUT_MS);
    // The buffer can drain between the first check and listener registration.
    onBufferedAmountLow();
  });
}

export async function sendImageFile(
  instructionChannel: RealtimeMessageChannel,
  fileChannel: RTCDataChannel,
  file: File,
  onProgress: (progress: TransferProgress) => void,
  transferId?: string,
  chunkSize = IMAGE_CHUNK_SIZE,
  waitUntilReady?: (id: string) => Promise<void>,
  signal?: AbortSignal,
  workspace?: ImageObjectMetadata,
) {
  if (
    instructionChannel.readyState !== "open" ||
    fileChannel.readyState !== "open"
  ) {
    throw new Error("DataChannels are not open");
  }

  const meta = createImageTransferMeta(file, transferId, chunkSize, workspace);
  sendInstruction(instructionChannel, { type: "IMAGE_START", payload: meta });
  await waitUntilReady?.(meta.id);
  if (signal?.aborted) throw new DOMException("Transfer cancelled", "AbortError");
  onProgress({ ...meta, transferredBytes: 0, progress: 0 });

  let transferredBytes = 0;
  let reportedPercent = 0;
  try {
    for (let offset = 0; offset < file.size; offset += meta.chunkSize) {
      await waitForWritableBuffer(fileChannel, signal);
      if (signal?.aborted) throw new DOMException("Transfer cancelled", "AbortError");
      const chunk = await file.slice(offset, offset + meta.chunkSize).arrayBuffer();
      if (signal?.aborted) throw new DOMException("Transfer cancelled", "AbortError");
      const frame = new Uint8Array(FRAME_HEADER_BYTES + chunk.byteLength);
      frame.set(transferIdToBytes(meta.id), 0);
      new DataView(frame.buffer).setUint32(TRANSFER_ID_BYTES, offset / meta.chunkSize);
      frame.set(new Uint8Array(chunk), FRAME_HEADER_BYTES);
      fileChannel.send(frame.buffer);
      transferredBytes += chunk.byteLength;
      const progress = file.size ? transferredBytes / file.size : 1;
      const percent = Math.floor(progress * 100);
      if (percent > reportedPercent || transferredBytes === file.size) {
        reportedPercent = percent;
        onProgress({ ...meta, transferredBytes, progress });
      }
    }
    await waitForWritableBuffer(fileChannel, signal);
    sendInstruction(instructionChannel, { type: "IMAGE_COMPLETE", payload: { id: meta.id } });
    return meta;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Image transfer failed";
    if (!signal?.aborted && instructionChannel.readyState === "open") {
      sendInstruction(instructionChannel, {
        type: "IMAGE_FAILED",
        payload: { id: meta.id, reason },
      });
    }
    throw error;
  }
}

export class RealtimeImageReceiver {
  private incoming: IncomingTransfer | null = null;
  private readonly incomingThumbnails = new Map<string, IncomingThumbnail>();

  constructor(
    private readonly callbacks: ImageReceiverCallbacks,
    private readonly getMaxImageTransferSize: () => number,
  ) {}

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
    const message = parsed as TransferInstruction;

    if (message.type === "IMAGE_PLACEHOLDER_PENDING") {
      if (!isValidMeta(message.payload, this.getMaxImageTransferSize())) {
        this.callbacks.onError(null, "Received invalid pending placeholder");
        return;
      }
      void this.callbacks.onPlaceholderPending?.(message.payload);
      return;
    }

    if (message.type === "IMAGE_PLACEHOLDER") {
      if (
        !isValidMeta(message.payload, this.getMaxImageTransferSize()) ||
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
      if (!isValidMeta(message.payload, this.getMaxImageTransferSize())) {
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

    if (message.type === "IMAGE_PLACEHOLDER_ACK") {
      const { id, width, height } = message.payload || {};
      if (
        typeof id === "string" &&
        /^[a-f0-9]{32}$/.test(id) &&
        Number.isInteger(width) &&
        width >= 1 &&
        width <= 4096 &&
        Number.isInteger(height) &&
        height >= 1 &&
        height <= 4096
      ) {
        this.callbacks.onPlaceholderAck?.(id, width, height);
      }
      return;
    }

    if (message.type === "IMAGE_THUMBNAIL_START") {
      const { id, transferId, size, totalChunks } =
        message.payload || {};
      if (
        typeof id !== "string" ||
        !/^[a-f0-9]{32}$/.test(id) ||
        typeof transferId !== "string" ||
        !/^[a-f0-9]{32}$/.test(transferId) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > MAX_PREVIEW_THUMBNAIL_BYTES ||
        totalChunks !== Math.ceil(size / PREVIEW_THUMBNAIL_CHUNK_SIZE)
      ) {
        this.callbacks.onError(null, "Received invalid thumbnail metadata");
        return;
      }
      this.incomingThumbnails.set(transferId, {
        imageId: id,
        transferId,
        size,
        totalChunks,
        chunks: new Map(),
        receivedBytes: 0,
        completeRequested: false,
      });
      return;
    }

    if (message.type === "IMAGE_THUMBNAIL_CHUNK") {
      const { transferId, index, data } = message.payload || {};
      const thumbnail =
        typeof transferId === "string"
          ? this.incomingThumbnails.get(transferId)
          : undefined;
      const chunk =
        typeof data === "string"
          ? base64ToBytes(data, PREVIEW_THUMBNAIL_CHUNK_SIZE)
          : null;
      if (
        !thumbnail ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= thumbnail.totalChunks ||
        !chunk ||
        thumbnail.chunks.has(index) ||
        thumbnail.receivedBytes + chunk.byteLength > thumbnail.size
      ) {
        if (thumbnail) this.incomingThumbnails.delete(thumbnail.transferId);
        this.callbacks.onError(null, "Received an invalid thumbnail chunk");
        return;
      }
      thumbnail.chunks.set(index, chunk);
      thumbnail.receivedBytes += chunk.byteLength;
      if (
        thumbnail.completeRequested &&
        thumbnail.receivedBytes === thumbnail.size
      ) {
        this.completeThumbnail(thumbnail.transferId);
      }
      return;
    }

    if (message.type === "IMAGE_THUMBNAIL_COMPLETE") {
      const transferId = message.payload?.transferId;
      if (typeof transferId === "string") this.completeThumbnail(transferId);
      return;
    }

    if (message.type === "IMAGE_START") {
      if (!isValidMeta(message.payload, this.getMaxImageTransferSize())) {
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

    if (message.type === "IMAGE_CANCEL") {
      const id = message.payload?.id;
      if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) return;
      if (this.incoming?.meta.id === id) this.incoming = null;
      void this.callbacks.onCancel?.(id);
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
        !isValidMeta(message.payload, this.getMaxImageTransferSize()) ||
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
    if (frame.byteLength <= FRAME_HEADER_BYTES) {
      this.callbacks.onError(
        this.incoming?.meta ?? null,
        "Received an invalid image chunk frame",
      );
      return;
    }
    const transferId = transferIdFromBytes(
      new Uint8Array(frame, 0, TRANSFER_ID_BYTES),
    );
    if (!this.incoming || this.incoming.meta.id !== transferId) return;
    const index = new DataView(frame).getUint32(TRANSFER_ID_BYTES);
    const chunk = frame.slice(FRAME_HEADER_BYTES);
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

  private completeThumbnail(transferId: string) {
    const thumbnail = this.incomingThumbnails.get(transferId);
    if (!thumbnail) return;
    if (thumbnail.receivedBytes !== thumbnail.size) {
      thumbnail.completeRequested = true;
      return;
    }
    this.incomingThumbnails.delete(transferId);
    if (thumbnail.chunks.size !== thumbnail.totalChunks) {
      this.callbacks.onError(null, "Thumbnail data is incomplete");
      return;
    }
    const chunks = Array.from(
      { length: thumbnail.totalChunks },
      (_, index) => thumbnail.chunks.get(index),
    );
    if (chunks.some((chunk) => !chunk)) {
      this.callbacks.onError(null, "Thumbnail chunks are incomplete");
      return;
    }
    void this.callbacks.onThumbnail?.(
      thumbnail.imageId,
      new Blob(chunks as BlobPart[], { type: "image/webp" }),
    );
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
