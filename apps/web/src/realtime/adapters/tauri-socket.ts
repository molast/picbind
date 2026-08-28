import TauriWebSocket, {
  type ConnectionConfig,
  type Message,
} from "@tauri-apps/plugin-websocket";
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

export interface TauriSocketHandle {
  addListener(listener: (message: Message) => void): () => void;
  send(message: Message | string | number[]): Promise<void>;
  disconnect(): Promise<void>;
}

export type TauriSocketConnector = (
  url: string,
  config: ConnectionConfig,
) => Promise<TauriSocketHandle>;

class TauriRealtimeSocket implements RealtimeSocket {
  private readonly listeners = new Set<Listener>();
  private readonly writes = new RealtimeFifoQueue(REALTIME_LIMITS.maximumSocketQueueBytes);
  private readonly removePluginListener: () => void;
  private currentState: RealtimeSocket["state"] = "open";
  private closePromise: Promise<void> | null = null;

  constructor(private readonly socket: TauriSocketHandle) {
    this.removePluginListener = socket.addListener((message) => this.receive(message));
  }

  get state() { return this.currentState; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyOpen() {
    this.emit({ type: "open" });
  }

  send(frame: RealtimeFrame) {
    const bytes = realtimeFrameBytes(frame);
    const maximum = frame.kind === "text"
      ? REALTIME_LIMITS.maximumTextFrameBytes
      : REALTIME_LIMITS.maximumBinaryFrameBytes;
    if (bytes > maximum) {
      return Promise.reject(new RealtimeTransportError(
        "invalidFrame",
        "Realtime frame exceeds its size limit",
        false,
      ));
    }
    return this.writes.enqueue(bytes, async () => {
      if (this.currentState !== "open") {
        throw new RealtimeTransportError("socketClosed", "Tauri WebSocket is not open", true);
      }
      await this.socket.send(frame.kind === "text" ? frame.data : [...new Uint8Array(frame.data)]);
    });
  }

  close(code = 1000, reason = "session-closed") {
    this.closePromise ??= (async () => {
      await this.writes.close();
      this.currentState = "closing";
      this.removePluginListener();
      try {
        if (code === 1000 && reason === "session-closed") await this.socket.disconnect();
        else await this.socket.send({ type: "Close", data: { code, reason } });
      } finally {
        this.currentState = "closed";
        this.listeners.clear();
      }
    })();
    return this.closePromise;
  }

  private receive(message: Message) {
    if (message.type === "Text") {
      this.emitIncoming({ kind: "text", data: message.data });
    } else if (message.type === "Binary") {
      this.emitIncoming({ kind: "binary", data: Uint8Array.from(message.data).buffer });
    } else if (message.type === "Close") {
      this.currentState = "closed";
      this.emit({
        type: "close",
        code: message.data?.code,
        reason: message.data?.reason,
      });
    }
  }

  private emitIncoming(frame: RealtimeFrame) {
    const maximum = frame.kind === "text"
      ? REALTIME_LIMITS.maximumTextFrameBytes
      : REALTIME_LIMITS.maximumBinaryFrameBytes;
    if (realtimeFrameBytes(frame) > maximum) {
      this.emit({
        type: "error",
        error: new RealtimeTransportError(
          "invalidFrame",
          "Tauri WebSocket returned an oversized frame",
          false,
        ).toRealtimeError(),
      });
      return;
    }
    this.emit({ type: "message", frame });
  }

  private emit(event: RealtimeSocketEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Listener failures cannot break transport dispatch. */ }
    }
  }
}

export class TauriRealtimeSocketFactory implements RealtimeSocketFactory {
  constructor(
    private readonly connector: TauriSocketConnector = (url, config) => TauriWebSocket.connect(url, config),
  ) {}

  async connect(options: RealtimeSocketConnectOptions) {
    try {
      const socket = await this.connector(options.url, {
        headers: options.headers,
        writeBufferSize: 128 * 1024,
        maxWriteBufferSize: REALTIME_LIMITS.maximumSocketQueueBytes,
        maxFrameSize: REALTIME_LIMITS.maximumBinaryFrameBytes,
        maxMessageSize: REALTIME_LIMITS.maximumBinaryFrameBytes,
      });
      const adapter = new TauriRealtimeSocket(socket);
      queueMicrotask(() => adapter.notifyOpen());
      return adapter;
    } catch (error) {
      throw new RealtimeTransportError(
        "socketConnectFailed",
        "Tauri WebSocket connection failed",
        true,
        toRealtimeError(error, {
          code: "socketConnectFailed",
          message: "Tauri WebSocket connection failed",
          retryable: true,
        }),
      );
    }
  }
}
