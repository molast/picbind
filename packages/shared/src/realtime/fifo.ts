import { RealtimeTransportError } from "./errors";

export class RealtimeFifoQueue {
  private tail = Promise.resolve();
  private pendingBytes = 0;
  private closed = false;

  constructor(private readonly maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError("Realtime FIFO maximumBytes must be a positive integer");
    }
  }

  get queuedBytes() {
    return this.pendingBytes;
  }

  enqueue(bytes: number, operation: () => Promise<void>): Promise<void> {
    if (this.closed) {
      return Promise.reject(new RealtimeTransportError(
        "socketClosed",
        "Realtime transport is closed",
        false,
      ));
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.pendingBytes + bytes > this.maximumBytes) {
      return Promise.reject(new RealtimeTransportError(
        "socketQueueFull",
        "Realtime socket write queue is full",
        true,
      ));
    }

    this.pendingBytes += bytes;
    const result = this.tail.then(operation).finally(() => {
      this.pendingBytes -= bytes;
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async close() {
    this.closed = true;
    await this.tail;
  }
}
