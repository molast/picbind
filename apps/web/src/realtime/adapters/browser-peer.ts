import {
  REALTIME_LIMITS,
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

type Listener = (event: RealtimePeerEvent) => void;

const CHANNEL_LABELS: Record<RealtimePeerChannel, string> = {
  control: "workspace-control",
  bulk: "workspace-bulk",
};

class BrowserRealtimePeer implements RealtimePeer {
  readonly id: string;
  private readonly connection: RTCPeerConnection;
  private readonly listeners = new Set<Listener>();
  private readonly channels: Partial<Record<RealtimePeerChannel, RTCDataChannel>> = {};
  private readonly pendingCandidates: RealtimeIceCandidate[] = [];
  private remoteDescriptionSet = false;
  private closed = false;

  constructor(options: RealtimePeerCreateOptions) {
    this.id = options.peerId;
    this.connection = new RTCPeerConnection({ iceServers: options.iceServers });
    this.connection.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const value = candidate.toJSON();
      if (typeof value.candidate !== "string") return;
      this.emit({ type: "iceCandidate", candidate: { ...value, candidate: value.candidate } });
    };
    this.connection.onconnectionstatechange = () => {
      const state = this.connection.connectionState;
      if (["new", "connecting", "connected", "disconnected", "failed", "closed"].includes(state)) {
        this.emit({ type: "connectionState", state });
      }
    };
    this.connection.ondatachannel = ({ channel }) => this.attachChannel(channel);
    if (options.initiator) {
      this.attachChannel(this.connection.createDataChannel(CHANNEL_LABELS.control, { ordered: true }));
      this.attachChannel(this.connection.createDataChannel(CHANNEL_LABELS.bulk, { ordered: true }));
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createOffer() {
    return this.description(await this.connection.createOffer());
  }

  async createAnswer() {
    return this.description(await this.connection.createAnswer());
  }

  async setLocalDescription(value: RealtimeSessionDescription) {
    await this.connection.setLocalDescription(value);
  }

  async setRemoteDescription(value: RealtimeSessionDescription) {
    await this.connection.setRemoteDescription(value);
    this.remoteDescriptionSet = true;
    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.connection.addIceCandidate(candidate);
    }
  }

  async addIceCandidate(value: RealtimeIceCandidate) {
    if (!this.remoteDescriptionSet) {
      if (this.pendingCandidates.length >= 256) {
        throw new RealtimeTransportError("rtcSignalFailed", "Too many pending RTC candidates", false);
      }
      this.pendingCandidates.push(value);
      return;
    }
    await this.connection.addIceCandidate(value);
  }

  async send(channel: RealtimePeerChannel, frame: RealtimeFrame) {
    const dataChannel = this.channels[channel];
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new RealtimeTransportError("rtcDataChannelFailed", `RTC ${channel} channel is not open`, true);
    }
    const bytes = realtimeFrameBytes(frame);
    const frameMaximum = frame.kind === "text"
      ? REALTIME_LIMITS.maximumTextFrameBytes
      : REALTIME_LIMITS.maximumBinaryFrameBytes;
    const bufferedMaximum = channel === "control"
      ? REALTIME_LIMITS.maximumRtcControlBufferedBytes
      : REALTIME_LIMITS.maximumRtcBulkBufferedBytes;
    if (bytes > frameMaximum) {
      throw new RealtimeTransportError("invalidFrame", "RTC frame exceeds its size limit", false);
    }
    if (dataChannel.bufferedAmount + bytes > bufferedMaximum) {
      throw new RealtimeTransportError("rtcBackpressure", `RTC ${channel} channel is backpressured`, true);
    }
    if (frame.kind === "text") dataChannel.send(frame.data);
    else dataChannel.send(frame.data);
  }

  async bufferedAmount(channel: RealtimePeerChannel) {
    return this.channels[channel]?.bufferedAmount ?? 0;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const channel of Object.values(this.channels)) channel?.close();
    this.connection.close();
    this.listeners.clear();
    this.pendingCandidates.length = 0;
  }

  private attachChannel(dataChannel: RTCDataChannel) {
    const channel = dataChannel.label === CHANNEL_LABELS.control
      ? "control"
      : dataChannel.label === CHANNEL_LABELS.bulk ? "bulk" : null;
    if (!channel) {
      dataChannel.close();
      return;
    }
    const previous = this.channels[channel];
    if (previous && previous !== dataChannel) previous.close();
    this.channels[channel] = dataChannel;
    dataChannel.binaryType = "arraybuffer";
    dataChannel.onopen = () => this.emit({ type: "channelState", channel, state: "open" });
    dataChannel.onclose = () => this.emit({ type: "channelState", channel, state: "closed" });
    dataChannel.onerror = (cause) => this.emit({
      type: "error",
      error: toRealtimeError(cause, {
        code: "rtcDataChannelFailed",
        message: `RTC ${channel} channel failed`,
        retryable: true,
      }),
    });
    dataChannel.onmessage = ({ data }) => {
      const frame: RealtimeFrame | null = typeof data === "string"
        ? { kind: "text", data }
        : data instanceof ArrayBuffer ? { kind: "binary", data } : null;
      const maximum = frame?.kind === "text"
        ? REALTIME_LIMITS.maximumTextFrameBytes
        : REALTIME_LIMITS.maximumBinaryFrameBytes;
      if (!frame || realtimeFrameBytes(frame) > maximum) {
        this.emit({
          type: "error",
          error: new RealtimeTransportError(
            "invalidFrame",
            "RTC DataChannel returned an invalid frame",
            false,
          ).toRealtimeError(),
        });
        return;
      }
      this.emit({ type: "message", channel, frame });
    };
    if (dataChannel.readyState === "open") {
      this.emit({ type: "channelState", channel, state: "open" });
    }
  }

  private description(value: RTCSessionDescriptionInit): RealtimeSessionDescription {
    if ((value.type !== "offer" && value.type !== "answer") || typeof value.sdp !== "string") {
      throw new RealtimeTransportError("rtcSignalFailed", "Browser returned an invalid SDP", false);
    }
    return { type: value.type, sdp: value.sdp };
  }

  private emit(event: RealtimePeerEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* Listener failures cannot break transport dispatch. */ }
    }
  }
}

export class BrowserRealtimePeerFactory implements RealtimePeerFactory {
  async create(options: RealtimePeerCreateOptions) {
    try {
      return new BrowserRealtimePeer(options);
    } catch (error) {
      throw new RealtimeTransportError(
        "rtcUnavailable",
        "Browser RTC peer creation failed",
        true,
        error,
      );
    }
  }
}
