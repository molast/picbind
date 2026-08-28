import { Channel, invoke } from "@tauri-apps/api/core";
import {
  REALTIME_LIMITS,
  RealtimeFifoQueue,
  RealtimeTransportError,
  realtimeFrameBytes,
  toRealtimeError,
  type RealtimeFrame,
  type RealtimeIceCandidate,
  type RealtimePeer,
  type RealtimePeerChannel,
  type RealtimePeerCreateOptions,
  type RealtimePeerEvent,
  type RealtimePeerFactory,
  type RealtimeSessionDescription,
} from "@picbind/shared";

const COMMAND = "plugin:picbind-realtime|";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type NativeEventHeader = {
  type: "iceCandidate" | "connectionState" | "channelState" | "message" | "error";
  sessionId: string;
  peerId: string;
  sequence: number;
  channel?: RealtimePeerChannel;
  state?: string;
  candidate?: RealtimeIceCandidate;
  frameKind?: RealtimeFrame["kind"];
  error?: string;
};

export type NativeEventChannel = {
  value: unknown;
  close(): void;
};

export interface NativeRealtimeBridge {
  channel(listener: (value: ArrayBuffer) => void): NativeEventChannel;
  invoke<T>(command: string, args: Record<string, unknown>): Promise<T>;
  invokeRaw(command: string, body: Uint8Array, headers: Record<string, string>): Promise<void>;
}

const defaultBridge: NativeRealtimeBridge = {
  channel(listener) {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = listener;
    return {
      value: channel,
      close: () => (channel as unknown as { cleanupCallback(): void }).cleanupCallback(),
    };
  },
  invoke: (command, args) => invoke(command, args),
  invokeRaw: (command, body, headers) => invoke(command, body, { headers }),
};

class NativeRealtimePeer implements RealtimePeer {
  readonly id: string;
  private readonly listeners = new Set<(event: RealtimePeerEvent) => void>();
  private readonly eventChannel: NativeEventChannel;
  private readonly pendingCandidates: RealtimeIceCandidate[] = [];
  private readonly writes = {
    control: new RealtimeFifoQueue(REALTIME_LIMITS.maximumRtcControlBufferedBytes),
    bulk: new RealtimeFifoQueue(REALTIME_LIMITS.maximumSocketQueueBytes),
  };
  private remoteDescriptionSet = false;
  private lastSequence = 0;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly options: RealtimePeerCreateOptions,
    private readonly bridge: NativeRealtimeBridge,
  ) {
    this.id = options.peerId;
    this.eventChannel = bridge.channel((value) => this.receive(value));
  }

  async initialize() {
    await this.bridge.invoke(`${COMMAND}realtime_peer_create`, {
      options: this.options,
      onEvent: this.eventChannel.value,
    });
  }

  subscribe(listener: (event: RealtimePeerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createOffer() {
    return this.invoke<RealtimeSessionDescription>("realtime_peer_create_offer");
  }

  createAnswer() {
    return this.invoke<RealtimeSessionDescription>("realtime_peer_create_answer");
  }

  setLocalDescription(value: RealtimeSessionDescription) {
    return this.invoke<void>("realtime_peer_set_local_description", { value });
  }

  async setRemoteDescription(value: RealtimeSessionDescription) {
    await this.invoke<void>("realtime_peer_set_remote_description", { value });
    this.remoteDescriptionSet = true;
    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.invoke<void>("realtime_peer_add_ice_candidate", { value: candidate });
    }
  }

  async addIceCandidate(value: RealtimeIceCandidate) {
    if (!this.remoteDescriptionSet) {
      if (this.pendingCandidates.length >= 256) {
        throw new RealtimeTransportError("rtcSignalFailed", "Too many pending native RTC candidates", false);
      }
      this.pendingCandidates.push(value);
      return;
    }
    await this.invoke<void>("realtime_peer_add_ice_candidate", { value });
  }

  async send(channel: RealtimePeerChannel, frame: RealtimeFrame) {
    const bytes = realtimeFrameBytes(frame);
    const frameMaximum = frame.kind === "text"
      ? REALTIME_LIMITS.maximumTextFrameBytes
      : REALTIME_LIMITS.maximumBinaryFrameBytes;
    if (bytes > frameMaximum) {
      throw new RealtimeTransportError("invalidFrame", "Native RTC frame exceeds its size limit", false);
    }
    try {
      await this.writes[channel].enqueue(bytes, async () => {
        const bufferedMaximum = channel === "control"
          ? REALTIME_LIMITS.maximumRtcControlBufferedBytes
          : REALTIME_LIMITS.maximumRtcBulkBufferedBytes;
        if (await this.bufferedAmount(channel) + bytes > bufferedMaximum) {
          throw new RealtimeTransportError("rtcBackpressure", `Native RTC ${channel} channel is backpressured`, true);
        }
        const body = frame.kind === "text"
          ? textEncoder.encode(frame.data)
          : new Uint8Array(frame.data);
        await this.bridge.invokeRaw(`${COMMAND}realtime_peer_send`, body, {
          "x-picbind-session-id": this.options.sessionId,
          "x-picbind-peer-id": this.options.peerId,
          "x-picbind-channel": channel,
          "x-picbind-frame-kind": frame.kind,
        });
      });
    } catch (error) {
      if (error instanceof RealtimeTransportError && error.code === "rtcBackpressure") throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("backpressured")
        || (error instanceof RealtimeTransportError && error.code === "socketQueueFull")) {
        throw new RealtimeTransportError(
          "rtcBackpressure",
          `Native RTC ${channel} channel is backpressured`,
          true,
          error,
        );
      }
      throw error;
    }
  }

  bufferedAmount(channel: RealtimePeerChannel) {
    return this.invoke<number>("realtime_peer_buffered_amount", { channel });
  }

  close() {
    this.closePromise ??= Promise.all([
      this.writes.control.close(),
      this.writes.bulk.close(),
    ]).then(() => this.invoke<void>("realtime_peer_close"))
      .finally(() => {
        this.eventChannel.close();
        this.listeners.clear();
        this.pendingCandidates.length = 0;
      });
    return this.closePromise;
  }

  private invoke<T>(command: string, args: Record<string, unknown> = {}) {
    return this.bridge.invoke<T>(`${COMMAND}${command}`, {
      sessionId: this.options.sessionId,
      peerId: this.options.peerId,
      ...args,
    });
  }

  private receive(value: ArrayBuffer) {
    try {
      const bytes = new Uint8Array(value);
      if (bytes.byteLength < 4) throw new Error("missing native event header");
      const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
      if (headerLength > REALTIME_LIMITS.maximumBinaryHeaderBytes
        || 4 + headerLength > bytes.byteLength) {
        throw new Error("invalid native event header length");
      }
      const header = JSON.parse(textDecoder.decode(bytes.subarray(4, 4 + headerLength))) as NativeEventHeader;
      if (header.sessionId !== this.options.sessionId || header.peerId !== this.options.peerId) return;
      if (!Number.isSafeInteger(header.sequence) || header.sequence <= this.lastSequence) return;
      this.lastSequence = header.sequence;
      const payload = bytes.subarray(4 + headerLength);
      if (payload.byteLength > REALTIME_LIMITS.maximumBinaryFrameBytes) {
        throw new Error("native event payload exceeds its size limit");
      }
      if (header.type === "iceCandidate" && header.candidate) {
        this.emit({ type: "iceCandidate", candidate: header.candidate });
      } else if (header.type === "connectionState"
        && ["new", "connecting", "connected", "disconnected", "failed", "closed"].includes(header.state || "")) {
        this.emit({ type: "connectionState", state: header.state as Extract<RealtimePeerEvent, { type: "connectionState" }>["state"] });
      } else if (header.type === "channelState"
        && (header.channel === "control" || header.channel === "bulk")
        && (header.state === "open" || header.state === "closed")) {
        this.emit({ type: "channelState", channel: header.channel, state: header.state });
      } else if (header.type === "message"
        && (header.channel === "control" || header.channel === "bulk")) {
        if (header.frameKind === "text"
          && payload.byteLength > REALTIME_LIMITS.maximumTextFrameBytes) {
          throw new Error("native text event exceeds its size limit");
        }
        const frame: RealtimeFrame = header.frameKind === "text"
          ? { kind: "text", data: textDecoder.decode(payload) }
          : header.frameKind === "binary"
            ? { kind: "binary", data: payload.slice().buffer }
            : (() => { throw new Error("invalid native event frame kind"); })();
        this.emit({ type: "message", channel: header.channel, frame });
      } else if (header.type === "error") {
        this.emit({
          type: "error",
          error: new RealtimeTransportError(
            "rtcDataChannelFailed",
            header.error || "Native RTC failed",
            true,
          ).toRealtimeError(),
        });
      }
    } catch (error) {
      this.emit({
        type: "error",
        error: toRealtimeError(error, {
          code: "invalidFrame",
          message: "Native RTC returned an invalid event",
          retryable: false,
        }),
      });
    }
  }

  private emit(event: RealtimePeerEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Listener failures cannot break transport dispatch. */ }
    }
  }
}

export class NativeRealtimePeerFactory implements RealtimePeerFactory {
  constructor(private readonly bridge: NativeRealtimeBridge = defaultBridge) {}

  async create(options: RealtimePeerCreateOptions) {
    const peer = new NativeRealtimePeer(options, this.bridge);
    try {
      await peer.initialize();
      return peer;
    } catch (error) {
      await peer.close().catch(() => undefined);
      throw new RealtimeTransportError(
        "rtcUnavailable",
        "Native RTC peer creation failed",
        true,
        error,
      );
    }
  }
}
