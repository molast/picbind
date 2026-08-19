import { realtimeTicket } from "./api";
import {
  decodeBinaryRelay,
  encodeBinaryRelay,
  streamId,
  type RelayDelivery,
  type RelayRoute,
  WorkspaceEventGate,
} from "./realtime-protocol";
import type { WorkspaceEvent, WorkspaceIdentity } from "./types";

type Listener = (event: WorkspaceEvent | Record<string, unknown>) => void;
type Transport = "socket" | "rtc";
type SendOptions = {
  route?: RelayRoute;
  targetUserId?: string;
  delivery?: RelayDelivery;
  dataClass?: WorkspaceEvent["dataClass"];
};

const CLIENT_ID_KEY = "picbind.workspace.client-id";
const PROTOCOL = "picbind.workspace.v2";

function persistentClientId() {
  let value = localStorage.getItem(CLIENT_ID_KEY);
  if (!value) {
    value = `client_${crypto.randomUUID()}`;
    localStorage.setItem(CLIENT_ID_KEY, value);
  }
  return value;
}

export class WorkspaceRealtimeClient {
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private bulk: RTCDataChannel | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly reliable = new Map<string, string | ArrayBuffer>();
  private readonly reliableTypes = new Map<string, string>();
  private readonly sequences = new Map<string, number>();
  private readonly eventGate = new WorkspaceEventGate();
  private readonly timers = new Set<number>();
  private readonly onlineCollaborators = new Set<string>();
  private readonly localClientId = persistentClientId();
  private readonly localUserId: string;
  private reconnectTimer: number | null = null;
  private healthTimer: number | null = null;
  private disposed = false;
  private transportEpoch = 0;
  private peerTarget: string | undefined;
  private rtcOpenedAt = 0;
  private localRtcReady = false;
  private remoteRtcReady = false;
  private qualificationProbes = new Set<string>();
  private acknowledgedProbes = new Set<string>();
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private iceServers: RTCIceServer[] = [];
  state: "idle" | "socket" | "rtc" | "unavailable" = "idle";

  constructor(private workspace: WorkspaceIdentity) {
    this.localUserId = `${workspace.role === "owner" ? "owner" : "guest"}-${this.localClientId}`;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(value: WorkspaceEvent | Record<string, unknown>) {
    this.listeners.forEach((listener) => listener(value));
  }

  private schedule(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  async connect() {
    this.disposed = false;
    const ticket = await realtimeTicket(this.workspace, this.localClientId);
    this.iceServers = ticket.iceServers;
    if (this.workspace.role === "collaborator" && ticket.workspaceId) {
      this.workspace.workspaceId = ticket.workspaceId;
    }
    const url = new URL(
      `/api/workspaces/${encodeURIComponent(this.workspace.workspaceId)}/realtime-v2`,
      "https://api.picbind.com",
    );
    url.protocol = "wss:";
    const socket = new WebSocket(url, [PROTOCOL, `picbind.ticket.${ticket.ticket}`]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      this.state = "socket";
      this.flushReliable();
      this.startRtc();
    };
    socket.onmessage = (message) => this.receive(message.data as string | ArrayBuffer, "socket");
    socket.onerror = () => {
      if (this.state !== "rtc") this.state = "unavailable";
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.disposed) return;
      if (event.code === 1000 && event.reason === "rtc-promoted" && this.state === "rtc") return;
      this.state = "unavailable";
      this.stopPeer();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.disposed) return;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => this.scheduleReconnect());
    }, 1_500);
  }

  private receive(raw: string | ArrayBuffer, transport: Transport) {
    let value: Record<string, unknown>;
    if (raw instanceof ArrayBuffer) {
      const decoded = decodeBinaryRelay(raw);
      if (!decoded) return;
      value = { type: "workspaceRelay", event: { ...decoded.event, bytes: decoded.bytes } };
    } else {
      try {
        value = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
    }

    if (value.type === "eventAck" && typeof value.eventId === "string") {
      this.reliable.delete(value.eventId);
      this.reliableTypes.delete(value.eventId);
      this.qualifyRtc();
      return;
    }
    if (value.type === "eventNack" && typeof value.eventId === "string") {
      const eventType = this.reliableTypes.get(value.eventId);
      this.reliable.delete(value.eventId);
      this.reliableTypes.delete(value.eventId);
      this.emit({ type: "deliveryFailed", eventId: value.eventId, eventType });
      this.qualifyRtc();
      return;
    }
    if (value.type === "rtcProbe" && typeof value.probeId === "string") {
      this.sendRtcControl({ type: "rtcProbeAck", probeId: value.probeId });
      return;
    }
    if (value.type === "rtcProbeAck" && typeof value.probeId === "string") {
      this.acknowledgedProbes.add(value.probeId);
      this.qualifyRtc();
      return;
    }
    if (value.type === "peerLeaving") {
      if (this.workspace.role === "owner" && this.peerTarget) {
        const userId = this.peerTarget;
        this.onlineCollaborators.delete(userId);
        this.emit({ type: "memberLeft", userId, role: "collaborator", transport: "rtc" });
      } else {
        this.emit({ type: "ownerPresence", online: false, transport: "rtc" });
      }
      this.fallbackToSocket(false, false);
      return;
    }
    if (value.type === "transportReady") {
      this.remoteRtcReady = true;
      this.promoteRtc();
      return;
    }
    if (value.type === "transportFallback") {
      this.fallbackToSocket(false, false);
      return;
    }
    if (value.type === "webRtcOffer"
      || value.type === "webRtcAnswer"
      || value.type === "webRtcIceCandidate") {
      void this.handleSignal(value).catch(() => this.fallbackToSocket());
      return;
    }

    if (value.type === "connected" && this.workspace.role === "owner") {
      this.onlineCollaborators.clear();
      if (Array.isArray(value.members)) {
        for (const member of value.members as Array<Record<string, unknown>>) {
          if (member.role === "collaborator" && typeof member.userId === "string") {
            this.onlineCollaborators.add(member.userId);
          }
        }
      }
      this.negotiateOnlyCollaborator();
    } else if (value.type === "memberJoined"
      && this.workspace.role === "owner"
      && typeof value.userId === "string") {
      this.onlineCollaborators.add(value.userId);
      this.negotiateOnlyCollaborator();
    } else if (value.type === "memberLeft"
      && this.workspace.role === "owner"
      && typeof value.userId === "string") {
      this.onlineCollaborators.delete(value.userId);
      this.negotiateOnlyCollaborator();
    }

    if (value.type === "workspaceRelay" && value.event && typeof value.event === "object") {
      const event = value.event as WorkspaceEvent;
      if (transport === "rtc" && event.reliability === "reliable") {
        this.sendRtcControl({ type: "eventAck", eventId: event.eventId });
      }
      const disposition = this.eventGate.accept(event);
      if (disposition === "duplicate") return;
      if (disposition === "sequenceGap") {
        this.emit({ type: "syncRequired", senderId: event.senderId, streamId: event.streamId });
      }
      this.emit(event);
      return;
    }
    this.emit({ ...value, transport });
  }

  private nextEvent(type: string, payload: Record<string, unknown>, options: SendOptions) {
    const route = options.route || "workspace";
    const eventStream = streamId(route, options.targetUserId);
    const sequence = (this.sequences.get(eventStream) || 0) + 1;
    this.sequences.set(eventStream, sequence);
    return {
      eventId: crypto.randomUUID(),
      sequence,
      timestamp: Date.now(),
      dataClass: options.dataClass || "collaborationEvent",
      reliability: options.delivery || "reliable",
      streamId: eventStream,
      senderId: this.localUserId,
      senderName: this.workspace.role === "owner" ? "Owner" : "Guest",
      senderRole: this.workspace.role,
      type,
      ...payload,
    } satisfies WorkspaceEvent;
  }

  send(type: string, payload: Record<string, unknown>, options: SendOptions = {}) {
    const event = this.nextEvent(type, payload, options);
    const envelope = JSON.stringify({
      type: "workspaceRelay",
      version: 1,
      route: options.route || "workspace",
      targetUserId: options.targetUserId,
      delivery: options.delivery || "reliable",
      event,
    });
    if ((options.delivery || "reliable") === "reliable") {
      this.reliable.set(event.eventId, envelope);
      this.reliableTypes.set(event.eventId, type);
    }
    this.sendFrame(envelope, options, event.dataClass);
    return event.eventId;
  }

  sendBinary(
    type: string,
    payload: Record<string, unknown>,
    binary: ArrayBuffer,
    options: Omit<SendOptions, "delivery"> & { delivery?: "reliable" | "bulk" } = {},
  ) {
    const event = this.nextEvent(type, payload, options);
    const frame = encodeBinaryRelay({
      route: options.route || "workspace",
      targetUserId: options.targetUserId,
      delivery: options.delivery || "bulk",
      event,
      bytes: binary,
    });
    if (options.delivery === "reliable") {
      this.reliable.set(event.eventId, frame);
      this.reliableTypes.set(event.eventId, type);
    }
    this.sendFrame(frame, options, event.dataClass);
    return event.eventId;
  }

  private sendFrame(
    frame: string | ArrayBuffer,
    options: Pick<SendOptions, "delivery">,
    dataClass: WorkspaceEvent["dataClass"],
  ) {
    if (this.state === "rtc") {
      const channel = options.delivery === "bulk"
        || dataClass === "preview"
        || dataClass === "sourceOrCommit"
        ? this.bulk
        : this.control;
      if (channel?.readyState === "open") {
        try {
          if (typeof frame === "string") channel.send(frame);
          else channel.send(frame);
          return;
        } catch {
          this.fallbackToSocket();
        }
      }
    }
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame);
  }

  private flushReliable() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.reliable.forEach((value) => this.socket?.send(value));
  }

  private sendSignal(value: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private startRtc() {
    this.stopPeer();
    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peer = peer;
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.sendSignal({
        type: "webRtcIceCandidate",
        targetRole: this.workspace.role === "owner" ? undefined : "owner",
        targetUserId: this.peerTarget,
        candidate,
      });
    };
    peer.ondatachannel = ({ channel }) => this.attachChannel(channel);
    peer.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        this.fallbackToSocket();
      }
    };
  }

  private negotiateOnlyCollaborator() {
    if (this.workspace.role !== "owner" || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.onlineCollaborators.size !== 1) {
      this.fallbackToSocket(false);
      return;
    }
    const [target] = this.onlineCollaborators;
    if (this.peerTarget === target && this.peer) return;
    this.startRtc();
    void this.createOffer(target).catch(() => this.fallbackToSocket());
  }

  private async createOffer(targetUserId: string) {
    const peer = this.peer;
    if (!peer) return;
    this.peerTarget = targetUserId;
    this.attachChannel(peer.createDataChannel("workspace-control", { ordered: true }));
    this.attachChannel(peer.createDataChannel("workspace-bulk", { ordered: true }));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.sendSignal({ type: "webRtcOffer", sdp: offer.sdp, targetUserId });
  }

  private attachChannel(channel: RTCDataChannel) {
    if (channel.label === "workspace-bulk") this.bulk = channel;
    else this.control = channel;
    channel.binaryType = "arraybuffer";
    channel.onmessage = (message) => this.receive(message.data as string | ArrayBuffer, "rtc");
    channel.onclose = () => this.fallbackToSocket();
    channel.onopen = () => {
      if (channel.label !== "workspace-control") {
        this.qualifyRtc();
        return;
      }
      this.rtcOpenedAt = Date.now();
      this.qualificationProbes.clear();
      this.acknowledgedProbes.clear();
      for (let index = 0; index < 3; index += 1) {
        const probeId = crypto.randomUUID();
        this.qualificationProbes.add(probeId);
        this.schedule(() => this.sendRtcControl({ type: "rtcProbe", probeId }), index * 200);
      }
      this.schedule(() => this.qualifyRtc(), 2_100);
    };
  }

  private sendRtcControl(value: Record<string, unknown>) {
    if (this.control?.readyState === "open") this.control.send(JSON.stringify(value));
  }

  private qualifyRtc() {
    const probesAcknowledged = [...this.qualificationProbes]
      .every((probeId) => this.acknowledgedProbes.has(probeId));
    if (this.localRtcReady
      || this.control?.readyState !== "open"
      || this.bulk?.readyState !== "open"
      || this.qualificationProbes.size !== 3
      || !probesAcknowledged
      || Date.now() - this.rtcOpenedAt < 2_000
      || this.reliable.size > 0) return;
    this.localRtcReady = true;
    this.transportEpoch += 1;
    this.sendSignal({
      type: "transportReady",
      transportEpoch: this.transportEpoch,
      transport: "webRtcDataChannel",
      targetRole: this.workspace.role === "owner" ? undefined : "owner",
      targetUserId: this.peerTarget,
    });
    this.promoteRtc();
  }

  private promoteRtc() {
    if (!this.localRtcReady || !this.remoteRtcReady) return;
    if (this.workspace.role === "owner" && this.onlineCollaborators.size !== 1) return;
    this.state = "rtc";
    if (this.workspace.role === "collaborator") this.socket?.close(1000, "rtc-promoted");
    this.startHealthChecks();
  }

  private startHealthChecks() {
    if (this.healthTimer !== null) window.clearInterval(this.healthTimer);
    this.healthTimer = window.setInterval(() => {
      if (this.control?.readyState !== "open" || this.bulk?.readyState !== "open") {
        this.fallbackToSocket();
        return;
      }
      const probeId = crypto.randomUUID();
      this.acknowledgedProbes.delete(probeId);
      this.sendRtcControl({ type: "rtcProbe", probeId });
      this.schedule(() => {
        if (!this.acknowledgedProbes.has(probeId)) this.fallbackToSocket();
      }, 3_000);
    }, 5_000);
  }

  private async handleSignal(value: Record<string, unknown>) {
    if (typeof value.senderId === "string") this.peerTarget = value.senderId;
    if (!this.peer) this.startRtc();
    const peer = this.peer!;
    if (value.type === "webRtcOffer" && typeof value.sdp === "string") {
      await peer.setRemoteDescription({ type: "offer", sdp: value.sdp });
      await this.flushPendingIce(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.sendSignal({ type: "webRtcAnswer", sdp: answer.sdp, targetUserId: value.senderId });
    } else if (value.type === "webRtcAnswer" && typeof value.sdp === "string") {
      await peer.setRemoteDescription({ type: "answer", sdp: value.sdp });
      await this.flushPendingIce(peer);
    } else if (value.type === "webRtcIceCandidate" && value.candidate) {
      const candidate = value.candidate as RTCIceCandidateInit;
      if (peer.remoteDescription) await peer.addIceCandidate(candidate);
      else this.pendingIceCandidates.push(candidate);
    }
  }

  private async flushPendingIce(peer: RTCPeerConnection) {
    const candidates = this.pendingIceCandidates.splice(0);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }

  private fallbackToSocket(renegotiate = true, notifyPeer = true) {
    if (this.disposed) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (notifyPeer) {
        this.sendSignal({
          type: "transportFallback",
          transportEpoch: Math.max(1, this.transportEpoch),
          reason: "peer-failed",
          targetRole: this.workspace.role === "owner" ? undefined : "owner",
          targetUserId: this.peerTarget,
        });
      }
      this.state = "socket";
      this.flushReliable();
    } else {
      this.state = "unavailable";
      this.scheduleReconnect();
    }
    this.stopPeer();
    if (renegotiate && this.workspace.role === "owner" && this.onlineCollaborators.size === 1) {
      this.schedule(() => this.negotiateOnlyCollaborator(), 1_000);
    }
  }

  private stopPeer() {
    if (this.healthTimer !== null) window.clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.localRtcReady = false;
    this.remoteRtcReady = false;
    this.qualificationProbes.clear();
    this.acknowledgedProbes.clear();
    this.pendingIceCandidates = [];
    if (this.control) this.control.onclose = null;
    if (this.bulk) this.bulk.onclose = null;
    this.control?.close();
    this.bulk?.close();
    this.peer?.close();
    this.peer = null;
    this.control = null;
    this.bulk = null;
    this.peerTarget = undefined;
  }

  disconnect() {
    this.disposed = true;
    this.sendRtcControl({ type: "peerLeaving" });
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
    this.stopPeer();
    this.socket?.close(1000, "page-left");
    this.socket = null;
    this.listeners.clear();
    this.onlineCollaborators.clear();
  }
}
