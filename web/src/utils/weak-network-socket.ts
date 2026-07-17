"use client";

import { getShareRoomSocketUrl } from "./api-endpoints";

export const WEAK_NETWORK_SOCKET_ENTER_RTT_MS = 400;
export const WEAK_NETWORK_SOCKET_EXIT_RTT_MS = 200;
export const WEAK_NETWORK_RECOVERY_STABLE_MS = 5000;

export type RealtimeMessageChannel = {
  readonly readyState: RTCDataChannelState;
  send(data: string): void;
};

export type RelayChannelName = "control" | "instruction" | "thumbnail";

type WeakNetworkSocketOptions = {
  roomId: string;
  sessionId: string;
  onMessage(channel: RelayChannelName, payload: string): void;
  onRoomClosed(): void;
  onRoomKicked(): void;
  onWeakNetworkChange(weakNetwork: boolean): void;
  onRelayReadyChange(ready: boolean): void;
  onSocketLatencyChange(latencyMs: number | null): void;
  onPeerUnavailable(): void;
};

export class WeakNetworkSocket {
  private socket: WebSocket | null = null;
  private desired = false;
  private relayReady = false;
  private reconnectTimer: number | null = null;
  private recoveryStartedAt: number | null = null;
  private pingTimer: number | null = null;
  private peerDisconnectTimer: number | null = null;
  private peerUnavailable = false;
  private readonly pendingPings = new Map<string, number>();

  constructor(private readonly options: WeakNetworkSocketOptions) {}

  get canRelay() {
    return this.relayReady && this.socket?.readyState === WebSocket.OPEN;
  }

  updateRtt(rttMs: number | null) {
    if (this.peerUnavailable) return;
    if (rttMs === null || !Number.isFinite(rttMs)) {
      this.markUnavailable();
      return;
    }
    if (!this.desired && rttMs > WEAK_NETWORK_SOCKET_ENTER_RTT_MS) {
      this.enterWeakNetwork();
      return;
    }
    if (!this.desired) return;
    if (rttMs >= WEAK_NETWORK_SOCKET_EXIT_RTT_MS) {
      this.recoveryStartedAt = null;
      return;
    }
    const now = Date.now();
    this.recoveryStartedAt ??= now;
    if (now - this.recoveryStartedAt >= WEAK_NETWORK_RECOVERY_STABLE_MS) {
      this.disconnect();
    }
  }

  markUnavailable() {
    if (this.peerUnavailable) return;
    this.recoveryStartedAt = null;
    if (!this.desired) this.enterWeakNetwork();
  }

  markPeerAvailable() {
    if (!this.peerUnavailable) return;
    this.peerUnavailable = false;
    this.clearPeerDisconnectTimer();
  }

  markPeerUnavailable() {
    if (this.peerUnavailable) return;
    this.handlePeerUnavailable();
  }

  send(channel: RelayChannelName, payload: string) {
    if (!this.canRelay || !this.socket) return false;
    try {
      this.socket.send(JSON.stringify({ type: "RELAY", channel, payload }));
      return true;
    } catch {
      this.setRelayReady(false);
      return false;
    }
  }

  disconnect() {
    const wasDesired = this.desired;
    this.desired = false;
    this.setRelayReady(false);
    this.recoveryStartedAt = null;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearPeerDisconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.stopLatencyMonitor();
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Network recovered");
    }
    if (wasDesired) this.options.onWeakNetworkChange(false);
  }

  private enterWeakNetwork() {
    if (this.desired) return;
    this.desired = true;
    this.recoveryStartedAt = null;
    this.options.onWeakNetworkChange(true);
    this.connect();
  }

  private connect() {
    if (
      !this.desired ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    const socket = new WebSocket(
      getShareRoomSocketUrl(this.options.roomId, this.options.sessionId),
    );
    this.socket = socket;
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: {
        type?: unknown;
        id?: unknown;
        ready?: unknown;
        channel?: unknown;
        payload?: unknown;
      };
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch {
        return;
      }
      if (message.type === "SOCKET_STATE") {
        this.setRelayReady(message.ready === true);
      } else if (
        message.type === "RELAY" &&
        (message.channel === "control" ||
          message.channel === "instruction" ||
          message.channel === "thumbnail") &&
        typeof message.payload === "string"
      ) {
        this.options.onMessage(message.channel, message.payload);
      } else if (message.type === "PONG" && typeof message.id === "string") {
        const sentAt = this.pendingPings.get(message.id);
        if (sentAt !== undefined) {
          this.pendingPings.delete(message.id);
          this.options.onSocketLatencyChange(
            Math.max(0, Math.round(performance.now() - sentAt)),
          );
        }
      } else if (message.type === "ROOM_CLOSED") {
        this.disconnect();
        this.options.onRoomClosed();
      } else if (message.type === "ROOM_KICKED") {
        this.disconnect();
        this.options.onRoomKicked();
      } else if (message.type === "PEER_UNAVAILABLE") {
        this.markPeerUnavailable();
      }
    };
    socket.onopen = () => {
      this.startLatencyMonitor(socket);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setRelayReady(false);
      this.stopLatencyMonitor();
      if (this.desired) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 3000);
      }
    };
    socket.onerror = () => {
      this.setRelayReady(false);
    };
  }

  private setRelayReady(ready: boolean) {
    if (ready && this.peerUnavailable) return;
    if (this.relayReady === ready) return;
    this.relayReady = ready;
    this.options.onRelayReadyChange(ready);
  }

  private handlePeerUnavailable() {
    this.peerUnavailable = true;
    this.recoveryStartedAt = null;
    this.setRelayReady(false);
    this.options.onPeerUnavailable();
    this.clearPeerDisconnectTimer();
    this.peerDisconnectTimer = window.setTimeout(() => {
      this.peerDisconnectTimer = null;
      this.disconnect();
    }, 5000);
  }

  private clearPeerDisconnectTimer() {
    if (this.peerDisconnectTimer !== null) {
      window.clearTimeout(this.peerDisconnectTimer);
      this.peerDisconnectTimer = null;
    }
  }

  private startLatencyMonitor(socket: WebSocket) {
    this.stopLatencyMonitor();
    const ping = () => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      const id = crypto.randomUUID().replace(/-/g, "");
      this.pendingPings.set(id, performance.now());
      for (const [pendingId, sentAt] of this.pendingPings) {
        if (performance.now() - sentAt > 10_000) this.pendingPings.delete(pendingId);
      }
      socket.send(JSON.stringify({ type: "PING", id }));
    };
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }

  private stopLatencyMonitor() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPings.clear();
    this.options.onSocketLatencyChange(null);
  }
}

export class AdaptiveMessageChannel implements RealtimeMessageChannel {
  private dataChannel: RTCDataChannel | null = null;

  constructor(
    private readonly channel: RelayChannelName,
    private readonly socket: WeakNetworkSocket,
  ) {}

  get readyState(): RTCDataChannelState {
    if (this.socket.canRelay) return "open";
    return this.dataChannel?.readyState || "closed";
  }

  setDataChannel(channel: RTCDataChannel | null) {
    this.dataChannel = channel;
  }

  send(data: string) {
    if (this.socket.send(this.channel, data)) return;
    if (this.dataChannel?.readyState !== "open") {
      throw new Error("Realtime message channel is not open");
    }
    this.dataChannel.send(data);
  }
}
