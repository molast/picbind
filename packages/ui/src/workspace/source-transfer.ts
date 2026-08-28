import { REALTIME_LIMITS } from "@picbind/shared";

export type SourceTransferManifest = {
  requestId: string;
  imageId: string;
  mimeType: string;
  totalChunks: number;
  totalBytes: number;
  sha256: string;
  currentCommitId?: string | null;
};

export type CompletedSourceTransfer = {
  imageId: string;
  currentCommitId?: string | null;
  source: Blob;
};

type PendingTransfer = SourceTransferManifest & {
  chunks: Map<number, Uint8Array>;
  completionRequested: boolean;
};

type PendingManifest = {
  chunks: Map<number, Uint8Array>;
  bytes: number;
  completionRequested: boolean;
};

function bytesFrom(value: ArrayBuffer | ArrayBufferView) {
  const source = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return source.slice();
}

async function sha256(value: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await value.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class SourceTransferRegistry {
  private readonly transfers = new Map<string, PendingTransfer>();
  private readonly pendingManifests = new Map<string, PendingManifest>();
  private pendingManifestBytes = 0;

  get size() { return this.transfers.size + this.pendingManifests.size; }

  start(manifest: SourceTransferManifest) {
    if (!manifest.requestId
      || !manifest.imageId
      || !manifest.mimeType.startsWith("image/")
      || !Number.isSafeInteger(manifest.totalChunks)
      || manifest.totalChunks < 1
      || manifest.totalChunks > 65_536
      || !Number.isSafeInteger(manifest.totalBytes)
      || manifest.totalBytes < 1
      || !/^[0-9a-f]{64}$/i.test(manifest.sha256)) {
      return false;
    }
    const pending = this.takePendingManifest(manifest.requestId);
    this.transfers.set(manifest.requestId, {
      ...manifest,
      chunks: new Map(),
      completionRequested: pending?.completionRequested === true,
    });
    if (pending) {
      for (const [index, chunk] of pending.chunks) {
        if (!this.push(manifest.requestId, index, chunk)) {
          this.transfers.delete(manifest.requestId);
          return false;
        }
      }
    }
    return true;
  }

  push(requestId: string, index: number, value: ArrayBuffer | ArrayBufferView) {
    const transfer = this.transfers.get(requestId);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 65_536) {
      return false;
    }
    if (!transfer) return this.pushPendingManifest(requestId, index, value);
    if (index >= transfer.totalChunks) return false;
    if (transfer.chunks.has(index)) return true;
    const bytes = bytesFrom(value);
    const received = [...transfer.chunks.values()]
      .reduce((total, chunk) => total + chunk.byteLength, bytes.byteLength);
    if (received > transfer.totalBytes) {
      this.transfers.delete(requestId);
      return false;
    }
    transfer.chunks.set(index, bytes);
    return true;
  }

  async complete(requestId: string): Promise<CompletedSourceTransfer | null> {
    const transfer = this.transfers.get(requestId);
    if (!transfer) {
      const pending = this.pendingManifests.get(requestId);
      if (pending) pending.completionRequested = true;
      return null;
    }
    transfer.completionRequested = true;
    if (transfer.chunks.size !== transfer.totalChunks) return null;
    this.transfers.delete(requestId);
    const ordered: Uint8Array[] = [];
    for (let index = 0; index < transfer.totalChunks; index += 1) {
      const chunk = transfer.chunks.get(index);
      if (!chunk) return null;
      ordered.push(chunk);
    }
    const source = new Blob(ordered.map((chunk) => chunk.buffer as ArrayBuffer), {
      type: transfer.mimeType,
    });
    if (source.size !== transfer.totalBytes || await sha256(source) !== transfer.sha256.toLowerCase()) {
      return null;
    }
    return {
      imageId: transfer.imageId,
      currentCommitId: transfer.currentCommitId,
      source,
    };
  }

  isCompletionPending(requestId: string) {
    return this.transfers.get(requestId)?.completionRequested === true;
  }

  has(requestId: string) {
    return this.transfers.has(requestId) || this.pendingManifests.has(requestId);
  }

  cancel(requestId: string) {
    this.transfers.delete(requestId);
    this.takePendingManifest(requestId);
  }

  clear() {
    this.transfers.clear();
    this.pendingManifests.clear();
    this.pendingManifestBytes = 0;
  }

  private pushPendingManifest(
    requestId: string,
    index: number,
    value: ArrayBuffer | ArrayBufferView,
  ) {
    if (!requestId) return false;
    const bytes = bytesFrom(value);
    if (bytes.byteLength < 1 || bytes.byteLength > REALTIME_LIMITS.sourceChunkBytes) return false;
    let pending = this.pendingManifests.get(requestId);
    if (!pending) {
      if (this.pendingManifests.size >= REALTIME_LIMITS.maximumConcurrentSourceTransfers) {
        return false;
      }
      pending = { chunks: new Map(), bytes: 0, completionRequested: false };
      this.pendingManifests.set(requestId, pending);
    }
    if (pending.chunks.has(index)) return true;
    if (this.pendingManifestBytes + bytes.byteLength > REALTIME_LIMITS.maximumSocketQueueBytes) {
      this.takePendingManifest(requestId);
      return false;
    }
    pending.chunks.set(index, bytes);
    pending.bytes += bytes.byteLength;
    this.pendingManifestBytes += bytes.byteLength;
    return true;
  }

  private takePendingManifest(requestId: string) {
    const pending = this.pendingManifests.get(requestId);
    if (!pending) return undefined;
    this.pendingManifests.delete(requestId);
    this.pendingManifestBytes -= pending.bytes;
    return pending;
  }
}
