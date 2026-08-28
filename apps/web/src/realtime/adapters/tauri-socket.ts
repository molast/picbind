import { Channel, invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig, Message } from "@tauri-apps/plugin-websocket";
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
const MAXIMUM_PENDING_EVENTS = 64;

function currentPageOrigin() {
  if (typeof globalThis.location === "undefined") return undefined;
  const origin = globalThis.location.origin;
  return origin && origin !== "null" ? origin : undefined;
}

function isMissingTauriConnection(error: unknown) {
  return /connection not found for the given id/i.test(String(error));
}

export interface TauriSocketBridge {
  channel(listener: (message: Message) => void): { value: unknown; close(): void };
  invoke<T>(command: string, args: Record<string, unknown>): Promise<T>;
}

export interface TauriSocketHandle {
  addListener(listener: (message: Message) => void): () => void;
  send(message: Message | string | number[]): Promise<void>;
  disconnect(): Promise<void>;
}

export type TauriSocketConnector = (
  url: string,
  config: ConnectionConfig,
) => Promise<TauriSocketHandle>;

const defaultBridge: TauriSocketBridge = {
  channel(listener) {
    const channel = new Channel<Message>();
    channel.onmessage = listener;
    return {
      value: channel,
      close: () => (channel as unknown as { cleanupCallback(): void }).cleanupCallback(),
    };
  },
  invoke: (command, args) => invoke(command, args),
};

class BufferedTauriSocketHandle implements TauriSocketHandle {
  private readonly listeners = new Set<(message: Message) => void>();
  private readonly pending: Message[] = [];
  private pendingBytes = 0;
  private id: number | null = null;
  private messagesClosed = false;
  private readonly messages;

  constructor(private readonly bridge: TauriSocketBridge) {
    this.messages = bridge.channel((message) => this.receive(message));
  }

  async connect(url: string, config: ConnectionConfig) {
    const serializedConfig = config.headers
      ? { ...config, headers: Array.from(new Headers(config.headers).entries()) }
      : config;
    try {
      this.id = await this.bridge.invoke<number>("plugin:websocket|connect", {
        url,
        onMessage: this.messages.value,
        config: serializedConfig,
      });
    } catch (error) {
      this.closeMessages();
      throw error;
    }
  }

  addListener(listener: (message: Message) => void) {
    this.listeners.add(listener);
    for (const message of this.pending.splice(0)) listener(message);
    this.pendingBytes = 0;
    return () => this.listeners.delete(listener);
  }

  async send(message: Message | string | number[]) {
    if (this.id === null) throw new Error("Tauri WebSocket is not connected");
    const normalized: Message = typeof message === "string"
      ? { type: "Text", data: message }
      : Array.isArray(message)
        ? { type: "Binary", data: message }
        : message;
    try {
      await this.bridge.invoke("plugin:websocket|send", {
        id: this.id,
        message: normalized,
      });
    } finally {
      if (normalized.type === "Close") this.closeMessages();
    }
  }

  async disconnect() {
    await this.send({
      type: "Close",
      data: { code: 1000, reason: "Disconnected by client" },
    });
  }

  private receive(message: Message) {
    if (this.listeners.size > 0) {
      for (const listener of this.listeners) listener(message);
      if (message.type === "Close") this.closeMessages();
      return;
    }
    const bytes = message.type === "Text"
      ? new TextEncoder().encode(message.data).byteLength
      : message.type === "Binary"
        ? message.data.length
        : 0;
    if (this.pending.length >= MAXIMUM_PENDING_EVENTS
      || this.pendingBytes + bytes > REALTIME_LIMITS.maximumSocketQueueBytes) return;
    this.pending.push(message);
    this.pendingBytes += bytes;
    if (message.type === "Close") this.closeMessages();
  }

  private closeMessages() {
    if (this.messagesClosed) return;
    this.messagesClosed = true;
    this.messages.close();
  }
}

export function createTauriSocketConnector(
  bridge: TauriSocketBridge = defaultBridge,
): TauriSocketConnector {
  return async (url, config) => {
    const handle = new BufferedTauriSocketHandle(bridge);
    await handle.connect(url, config);
    return handle;
  };
}

class TauriRealtimeSocket implements RealtimeSocket {
  private readonly listeners = new Set<Listener>();
  private readonly pendingEvents: RealtimeSocketEvent[] = [];
  private readonly writes = new RealtimeFifoQueue(REALTIME_LIMITS.maximumSocketQueueBytes);
  private readonly removePluginListener: () => void;
  private pendingEventBytes = 0;
  private currentState: RealtimeSocket["state"] = "open";
  private closePromise: Promise<void> | null = null;

  constructor(private readonly socket: TauriSocketHandle) {
    this.removePluginListener = socket.addListener((message) => this.receive(message));
  }

  get state() { return this.currentState; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    for (const event of this.pendingEvents.splice(0)) this.deliver(listener, event);
    this.pendingEventBytes = 0;
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
      const remoteAlreadyClosed = this.currentState === "closed";
      this.currentState = "closing";
      this.removePluginListener();
      try {
        if (!remoteAlreadyClosed) {
          if (code === 1000 && reason === "session-closed") await this.socket.disconnect();
          else await this.socket.send({ type: "Close", data: { code, reason } });
        }
      } catch (error) {
        if (!isMissingTauriConnection(error)) throw error;
      } finally {
        this.currentState = "closed";
        this.pendingEvents.length = 0;
        this.pendingEventBytes = 0;
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
    if (this.listeners.size === 0) {
      const bytes = event.type === "message" ? realtimeFrameBytes(event.frame) : 0;
      if (this.pendingEvents.length < MAXIMUM_PENDING_EVENTS
        && this.pendingEventBytes + bytes <= REALTIME_LIMITS.maximumSocketQueueBytes) {
        this.pendingEvents.push(event);
        this.pendingEventBytes += bytes;
      }
      return;
    }
    for (const listener of this.listeners) {
      this.deliver(listener, event);
    }
  }

  private deliver(listener: Listener, event: RealtimeSocketEvent) {
    try { listener(event); } catch { /* Listener failures cannot break transport dispatch. */ }
  }
}

export class TauriRealtimeSocketFactory implements RealtimeSocketFactory {
  constructor(
    private readonly connector: TauriSocketConnector = createTauriSocketConnector(),
    private readonly originProvider: () => string | undefined = currentPageOrigin,
  ) {}

  async connect(options: RealtimeSocketConnectOptions) {
    try {
      const headers = new Headers(options.headers);
      const origin = this.originProvider();
      if (origin && !headers.has("origin")) headers.set("origin", origin);
      const socket = await this.connector(options.url, {
        headers,
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
