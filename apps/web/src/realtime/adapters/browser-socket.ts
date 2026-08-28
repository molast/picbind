import {
  REALTIME_LIMITS,
  RealtimeFifoQueue,
  RealtimeTransportError,
  realtimeFrameBytes,
  toRealtimeError,
  type RealtimeFrame,
  type RealtimeSocket,
  type RealtimeSocketConnectOptions,
  type RealtimeSocketEvent,
  type RealtimeSocketFactory,
} from "@picbind/shared";

type Listener = (event: RealtimeSocketEvent) => void;

function validateFrame(frame: RealtimeFrame) {
  const bytes = realtimeFrameBytes(frame);
  const maximum = frame.kind === "text"
    ? REALTIME_LIMITS.maximumTextFrameBytes
    : REALTIME_LIMITS.maximumBinaryFrameBytes;
  if (bytes > maximum) {
    throw new RealtimeTransportError("invalidFrame", "Realtime frame exceeds its size limit", false);
  }
  return bytes;
}

function incomingFrame(data: unknown): RealtimeFrame {
  const frame: RealtimeFrame = typeof data === "string"
    ? { kind: "text", data }
    : data instanceof ArrayBuffer
      ? { kind: "binary", data }
      : (() => {
          throw new RealtimeTransportError(
            "invalidFrame",
            "Browser WebSocket returned an unsupported frame",
            false,
          );
        })();
  validateFrame(frame);
  return frame;
}

class BrowserRealtimeSocket implements RealtimeSocket {
  private readonly listeners = new Set<Listener>();
  private readonly writes = new RealtimeFifoQueue(REALTIME_LIMITS.maximumSocketQueueBytes);
  private closePromise: Promise<void> | null = null;

  constructor(private readonly socket: WebSocket) {
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => this.emit({ type: "open" }));
    socket.addEventListener("message", (event) => {
      try {
        this.emit({ type: "message", frame: incomingFrame(event.data) });
      } catch (error) {
        this.emit({
          type: "error",
          error: toRealtimeError(error, {
            code: "invalidFrame",
            message: "Browser WebSocket returned an invalid frame",
            retryable: false,
          }),
        });
      }
    });
    socket.addEventListener("error", (cause) => this.emit({
      type: "error",
      error: toRealtimeError(cause, {
        code: "socketClosed",
        message: "Browser WebSocket failed",
        retryable: true,
      }),
    }));
    socket.addEventListener("close", (event) => this.emit({
      type: "close",
      code: event.code,
      reason: event.reason,
    }));
  }

  get state(): RealtimeSocket["state"] {
    switch (this.socket.readyState) {
      case WebSocket.CONNECTING: return "connecting";
      case WebSocket.OPEN: return "open";
      case WebSocket.CLOSING: return "closing";
      default: return "closed";
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(frame: RealtimeFrame) {
    const bytes = validateFrame(frame);
    return this.writes.enqueue(bytes, async () => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        throw new RealtimeTransportError("socketClosed", "Browser WebSocket is not open", true);
      }
      this.socket.send(frame.data);
    });
  }

  close(code = 1000, reason = "session-closed") {
    this.closePromise ??= (async () => {
      await this.writes.close();
      if (this.socket.readyState === WebSocket.CONNECTING
        || this.socket.readyState === WebSocket.OPEN) {
        this.socket.close(code, reason);
      }
      this.listeners.clear();
    })();
    return this.closePromise;
  }

  private emit(event: RealtimeSocketEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Listener failures cannot break transport dispatch. */ }
    }
  }
}

export class BrowserRealtimeSocketFactory implements RealtimeSocketFactory {
  async connect(options: RealtimeSocketConnectOptions) {
    try {
      const socket = new WebSocket(options.url, options.protocols);
      return new BrowserRealtimeSocket(socket);
    } catch (error) {
      throw new RealtimeTransportError(
        "socketConnectFailed",
        "Browser WebSocket connection failed",
        true,
        error,
      );
    }
  }
}
