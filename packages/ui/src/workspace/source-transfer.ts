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

  get size() { return this.transfers.size; }

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
    this.transfers.set(manifest.requestId, { ...manifest, chunks: new Map(), completionRequested: false });
    return true;
  }

  push(requestId: string, index: number, value: ArrayBuffer | ArrayBufferView) {
    const transfer = this.transfers.get(requestId);
    if (!transfer || !Number.isSafeInteger(index) || index < 0 || index >= transfer.totalChunks) {
      return false;
    }
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
    if (!transfer) return null;
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

  has(requestId: string) { return this.transfers.has(requestId); }

  cancel(requestId: string) { this.transfers.delete(requestId); }
  clear() { this.transfers.clear(); }
}
