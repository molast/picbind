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
type PendingFrame = {
  frame: string | ArrayBuffer;
  delivery: RelayDelivery;
  dataClass: WorkspaceEvent["dataClass"];
};
type Probe = { sentAt: number; qualification: boolean; timeout: number };
type PeerState = {
  key: string;
  userId: string;
  pc: RTCPeerConnection;
  control: RTCDataChannel | null;
  bulk: RTCDataChannel | null;
  candidates: RTCIceCandidateInit[];
  probes: Map<string, Probe>;
  qualificationRtts: number[];
  healthOutcomes: boolean[];
  healthRtts: number[];
  healthTimer: number | null;
  qualificationStartedAt: number;
  disconnectedAt: number;
  degradedSince: number;
  localReadyEpoch: number;
  remoteReadyEpoch: number;
  primary: boolean;
  fallingBack: boolean;
};

const CLIENT_ID_KEY = "picbind.workspace.client-id";
const RTC_QUALITY = Object.freeze({
  requiredQualificationProbes: 3,
  maximumQualificationRttMs: 500,
  minimumStableMs: 2_000,
  healthIntervalMs: 2_000,
  probeTimeoutMs: 2_500,
  disconnectedFallbackMs: 3_000,
  maximumBufferedBytes: 1024 * 1024,
  degradedRttMs: 1_500,
  degradedWindowMs: 5_000,
  maximumLossRate: 0.3,
  healthWindowSize: 10,
});

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
  private readonly peers = new Map<string, PeerState>();
  private readonly listeners = new Set<Listener>();
  private readonly reliable = new Map<string, PendingFrame>();
  private readonly reliableTypes = new Map<string, string>();
  private readonly sequences = new Map<string, number>();
  private readonly eventGate = new WorkspaceEventGate();
  private readonly timers = new Set<number>();
  private readonly onlineCollaborators = new Set<string>();
  private readonly localClientId = persistentClientId();
  private readonly localUserId: string;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private disposed = false;
  private ownerOnline = false;
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
    if (this.disposed) return;
    this.iceServers = ticket.iceServers;
    if (this.workspace.role === "collaborator" && ticket.workspaceId) {
      this.workspace.workspaceId = ticket.workspaceId;
    }
    const url = new URL(
      `/api/workspaces/${encodeURIComponent(this.workspace.workspaceId)}/realtime-v2`,
      "https://api.picbind.com",
    );
    url.protocol = "wss:";
    url.searchParams.set("ticket", ticket.ticket);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.state = this.hasPrimaryPeer() ? "rtc" : "socket";
      this.flushReliable();
    };
    socket.onmessage = (message) => this.receive(message.data as string | ArrayBuffer, "socket");
    socket.onerror = () => {
      if (!this.hasPrimaryPeer()) this.state = "unavailable";
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.disposed) return;
      this.state = this.hasPrimaryPeer() ? "rtc" : "unavailable";
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.disposed) return;
    const baseDelay = Math.min(1_500 * (2 ** this.reconnectAttempt), 15_000);
    const delay = Math.floor(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private peerKey(senderId?: string) {
    return this.workspace.role === "collaborator" ? "owner" : senderId || "";
  }

  private receive(raw: string | ArrayBuffer, transport: Transport, rtcPeer?: PeerState) {
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
      this.peers.forEach((peer) => this.qualifyPeer(peer));
      return;
    }
    if (value.type === "eventNack" && typeof value.eventId === "string") {
      const eventType = this.reliableTypes.get(value.eventId);
      this.reliable.delete(value.eventId);
      this.reliableTypes.delete(value.eventId);
      this.emit({ type: "deliveryFailed", eventId: value.eventId, eventType });
      this.peers.forEach((peer) => this.qualifyPeer(peer));
      return;
    }
    if (value.type === "rtcProbe" && typeof value.probeId === "string" && rtcPeer) {
      this.sendPeerControl(rtcPeer, { type: "rtcProbeAck", probeId: value.probeId });
      return;
    }
    if (value.type === "rtcProbeAck" && typeof value.probeId === "string" && rtcPeer) {
      this.ackProbe(rtcPeer, value.probeId);
      return;
    }
    if (value.type === "peerLeaving" && rtcPeer) {
      const userId = rtcPeer.userId;
      this.fallbackPeer(rtcPeer, "peer-left", false);
      if (this.workspace.role === "owner") {
        this.onlineCollaborators.delete(userId);
        this.emit({ type: "memberLeft", userId, role: "collaborator", transport: "rtc" });
      } else {
        this.ownerOnline = false;
        this.emit({ type: "ownerPresence", online: false, transport: "rtc" });
      }
      return;
    }
    if (value.type === "transportReady") {
      const peer = rtcPeer || this.peers.get(this.peerKey(String(value.senderId || "")));
      if (peer) this.handleTransportReady(peer, value);
      return;
    }
    if (value.type === "transportFallback") {
      const peer = rtcPeer || this.peers.get(this.peerKey(String(value.senderId || "")));
      if (peer) this.fallbackPeer(peer, String(value.reason || "peer-requested"));
      return;
    }
    if (value.type === "webrtcOffer"
      || value.type === "webrtcAnswer"
      || value.type === "webrtcIceCandidate") {
      void this.handleSignal(value).catch(() => {
        const peer = this.peers.get(this.peerKey(String(value.senderId || "")));
        if (peer) this.fallbackPeer(peer, "signal-failed");
      });
      return;
    }

    if (value.type === "connected") {
      this.ownerOnline = value.ownerOnline === true || this.workspace.role === "owner";
      if (this.workspace.role === "owner") {
        this.onlineCollaborators.clear();
        if (Array.isArray(value.members)) {
          for (const member of value.members as Array<Record<string, unknown>>) {
            if (member.role === "collaborator" && typeof member.userId === "string") {
              this.onlineCollaborators.add(member.userId);
            }
          }
        }
        this.peers.forEach((peer) => {
          if (peer.primary) this.onlineCollaborators.add(peer.userId);
        });
      } else if (this.ownerOnline) {
        this.offerOwner();
      }
    } else if (value.type === "memberJoined"
      && this.workspace.role === "owner"
      && typeof value.userId === "string") {
      this.onlineCollaborators.add(value.userId);
    } else if (value.type === "memberLeft"
      && this.workspace.role === "owner"
      && typeof value.userId === "string") {
      const peer = this.peers.get(value.userId);
      if (!peer?.primary) {
        this.onlineCollaborators.delete(value.userId);
        if (peer) this.fallbackPeer(peer, "peer-left", false);
      }
    } else if (value.type === "ownerPresence" && this.workspace.role === "collaborator") {
      const peer = this.peers.get("owner");
      this.ownerOnline = value.online === true || Boolean(peer?.primary);
      value = { ...value, online: this.ownerOnline };
      if (value.online === true) this.offerOwner();
    }

    if (value.type === "workspaceRelay" && value.event && typeof value.event === "object") {
      const event = value.event as WorkspaceEvent;
      if (transport === "rtc" && event.reliability === "reliable" && rtcPeer) {
        this.sendPeerControl(rtcPeer, { type: "eventAck", eventId: event.eventId });
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
    const frame = this.encodeJsonFrame(event, options.route || "workspace", options.targetUserId);
    this.rememberReliable(event, frame, options);
    this.routeFrame(frame, event, options);
    return event.eventId;
  }

  removeCollaborator(userId: string) {
    if (this.workspace.role !== "owner" || !userId || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: "memberKick", targetUserId: userId }));
    return true;
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
    this.rememberReliable(event, frame, options);
    this.routeFrame(frame, event, options);
    return event.eventId;
  }

  private encodeJsonFrame(event: WorkspaceEvent, route: RelayRoute, targetUserId?: string) {
    return JSON.stringify({
      type: "workspaceRelay",
      version: 1,
      route,
      targetUserId,
      delivery: event.reliability,
      event,
    });
  }

  private rememberReliable(event: WorkspaceEvent, frame: string | ArrayBuffer, options: SendOptions) {
    if (event.reliability !== "reliable") return;
    this.reliable.set(event.eventId, {
      frame,
      delivery: options.delivery || "reliable",
      dataClass: event.dataClass,
    });
    this.reliableTypes.set(event.eventId, event.type);
  }

  private routeFrame(frame: string | ArrayBuffer, event: WorkspaceEvent, options: SendOptions) {
    if (this.workspace.role === "collaborator") {
      const peer = this.peers.get("owner");
      if (peer?.primary && this.sendPeerFrame(peer, frame, event)) return;
      this.sendSocket(frame);
      return;
    }
    if (options.route === "user" && options.targetUserId) {
      const peer = this.peers.get(options.targetUserId);
      if (peer?.primary && this.sendPeerFrame(peer, frame, event)) return;
      this.sendSocket(frame);
      return;
    }
    if ((options.route || "workspace") !== "workspace" || this.onlineCollaborators.size === 0) {
      this.sendSocket(frame);
      return;
    }
    for (const userId of this.onlineCollaborators) {
      const peer = this.peers.get(userId);
      if (peer?.primary && this.sendPeerFrame(peer, frame, event)) continue;
      this.sendSocket(this.targetFrame(frame, userId));
    }
  }

  private targetFrame(frame: string | ArrayBuffer, targetUserId: string) {
    if (typeof frame === "string") {
      const envelope = JSON.parse(frame) as { event: WorkspaceEvent };
      return this.encodeJsonFrame(envelope.event, "user", targetUserId);
    }
    const decoded = decodeBinaryRelay(frame);
    if (!decoded) return frame;
    return encodeBinaryRelay({
      route: "user",
      targetUserId,
      delivery: decoded.event.reliability === "reliable" ? "reliable" : "bulk",
      event: decoded.event,
      bytes: decoded.bytes,
    });
  }

  private sendPeerFrame(peer: PeerState, frame: string | ArrayBuffer, event: WorkspaceEvent) {
    const channel = event.reliability === "bulk"
      || event.dataClass === "preview"
      || event.dataClass === "sourceOrCommit"
      ? peer.bulk
      : peer.control;
    if (channel?.readyState !== "open") return false;
    try {
      if (typeof frame === "string") channel.send(frame);
      else channel.send(frame);
      return true;
    } catch {
      this.fallbackPeer(peer, "send-failed");
      return false;
    }
  }

  private sendSocket(frame: string | ArrayBuffer) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(frame);
    return true;
  }

  private flushReliable() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.reliable.forEach(({ frame }) => this.socket?.send(frame));
  }

  private sendSignal(value: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private createPeer(key: string, userId: string, initiator: boolean) {
    const existing = this.peers.get(key);
    if (existing) this.stopPeer(existing);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: PeerState = {
      key,
      userId,
      pc,
      control: null,
      bulk: null,
      candidates: [],
      probes: new Map(),
      qualificationRtts: [],
      healthOutcomes: [],
      healthRtts: [],
      healthTimer: null,
      qualificationStartedAt: 0,
      disconnectedAt: 0,
      degradedSince: 0,
      localReadyEpoch: 0,
      remoteReadyEpoch: 0,
      primary: false,
      fallingBack: false,
    };
    this.peers.set(key, peer);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.sendSignal({
        type: "webrtcIceCandidate",
        targetRole: this.workspace.role === "collaborator" ? "owner" : undefined,
        targetUserId: this.workspace.role === "owner" ? peer.userId : undefined,
        candidate: candidate.toJSON(),
      });
    };
    pc.ondatachannel = ({ channel }) => this.attachChannel(peer, channel);
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        this.fallbackPeer(peer, "peer-failed");
      } else if (pc.connectionState === "connected") {
        peer.disconnectedAt = 0;
        this.startQualification(peer);
      }
    };
    if (initiator) {
      this.attachChannel(peer, pc.createDataChannel("workspace-control", { ordered: true }));
      this.attachChannel(peer, pc.createDataChannel("workspace-bulk", { ordered: true }));
    }
    return peer;
  }

  private offerOwner() {
    if (this.workspace.role !== "collaborator"
      || !this.ownerOnline
      || this.socket?.readyState !== WebSocket.OPEN) return;
    const current = this.peers.get("owner");
    if (current && !current.fallingBack && current.pc.connectionState !== "closed") return;
    const peer = this.createPeer("owner", "owner", true);
    void (async () => {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.sendSignal({ type: "webrtcOffer", description: offer, targetRole: "owner" });
    })().catch(() => this.fallbackPeer(peer, "offer-failed"));
  }

  private async handleSignal(value: Record<string, unknown>) {
    const senderId = typeof value.senderId === "string" ? value.senderId : "";
    if (!senderId) return;
    const key = this.peerKey(senderId);
    if (!key) return;
    if (value.type === "webrtcOffer") {
      if (this.workspace.role !== "owner") return;
      this.onlineCollaborators.add(senderId);
      const description = this.description(value, "offer");
      if (!description) return;
      const peer = this.createPeer(key, senderId, false);
      await peer.pc.setRemoteDescription(description);
      await this.flushCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.sendSignal({ type: "webrtcAnswer", description: answer, targetUserId: senderId });
      return;
    }
    const peer = this.peers.get(key);
    if (!peer) return;
    if (value.type === "webrtcAnswer") {
      const description = this.description(value, "answer");
      if (!description) return;
      await peer.pc.setRemoteDescription(description);
      await this.flushCandidates(peer);
    } else if (value.type === "webrtcIceCandidate" && value.candidate) {
      const candidate = value.candidate as RTCIceCandidateInit;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate);
      else peer.candidates.push(candidate);
    }
  }

  private description(value: Record<string, unknown>, type: "offer" | "answer") {
    if (value.description && typeof value.description === "object") {
      return value.description as RTCSessionDescriptionInit;
    }
    return typeof value.sdp === "string" ? { type, sdp: value.sdp } : null;
  }

  private async flushCandidates(peer: PeerState) {
    for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
  }

  private attachChannel(peer: PeerState, channel: RTCDataChannel) {
    if (channel.label === "workspace-control") peer.control = channel;
    else if (channel.label === "workspace-bulk") peer.bulk = channel;
    else {
      channel.close();
      return;
    }
    channel.binaryType = "arraybuffer";
    channel.onmessage = (message) => {
      this.receive(message.data as string | ArrayBuffer, "rtc", peer);
    };
    channel.onclose = () => this.fallbackPeer(peer, "channel-closed");
    channel.onopen = () => this.startQualification(peer);
  }

  private startQualification(peer: PeerState) {
    if (peer.qualificationStartedAt
      || peer.control?.readyState !== "open"
      || peer.bulk?.readyState !== "open") return;
    peer.qualificationStartedAt = Date.now();
    for (let index = 0; index < RTC_QUALITY.requiredQualificationProbes; index += 1) {
      this.schedule(() => this.sendProbe(peer, true), index * 300);
    }
    this.schedule(() => this.qualifyPeer(peer), RTC_QUALITY.minimumStableMs + 100);
    this.schedule(() => {
      if (!peer.primary) this.fallbackPeer(peer, "qualification-failed");
    }, 6_000);
  }

  private sendProbe(peer: PeerState, qualification: boolean) {
    if (peer.control?.readyState !== "open") return;
    const probeId = crypto.randomUUID();
    const sentAt = Date.now();
    const timeout = this.schedule(() => {
      if (!peer.probes.delete(probeId)) return;
      if (!qualification) {
        this.pushHealth(peer, false);
        this.evaluateHealth(peer);
      }
    }, RTC_QUALITY.probeTimeoutMs);
    peer.probes.set(probeId, { sentAt, qualification, timeout });
    this.sendPeerControl(peer, { type: "rtcProbe", probeId });
  }

  private ackProbe(peer: PeerState, probeId: string) {
    const probe = peer.probes.get(probeId);
    if (!probe) return;
    window.clearTimeout(probe.timeout);
    this.timers.delete(probe.timeout);
    peer.probes.delete(probeId);
    const rtt = Math.max(0, Date.now() - probe.sentAt);
    if (probe.qualification) {
      peer.qualificationRtts.push(rtt);
      this.qualifyPeer(peer);
    } else {
      this.pushHealth(peer, true, rtt);
      this.evaluateHealth(peer);
    }
  }

  private qualifyPeer(peer: PeerState) {
    if (peer.localReadyEpoch
      || peer.control?.readyState !== "open"
      || peer.bulk?.readyState !== "open"
      || peer.qualificationRtts.length < RTC_QUALITY.requiredQualificationProbes
      || Math.max(...peer.qualificationRtts) > RTC_QUALITY.maximumQualificationRttMs
      || Date.now() - peer.qualificationStartedAt < RTC_QUALITY.minimumStableMs
      || this.reliable.size > 0) return;
    const epoch = peer.remoteReadyEpoch
      || (this.workspace.role === "collaborator" ? Math.max(1, Date.now()) : 0);
    if (!epoch) return;
    this.sendTransportReady(peer, epoch);
  }

  private sendTransportReady(peer: PeerState, epoch: number) {
    peer.localReadyEpoch = epoch;
    const message = {
      type: "transportReady",
      transportEpoch: epoch,
      transport: "webRtcDataChannel",
      targetRole: this.workspace.role === "collaborator" ? "owner" : undefined,
      targetUserId: this.workspace.role === "owner" ? peer.userId : undefined,
    };
    this.sendSignal(message);
    this.sendPeerControl(peer, message);
    this.promotePeer(peer);
  }

  private handleTransportReady(peer: PeerState, value: Record<string, unknown>) {
    const epoch = Number(value.transportEpoch);
    if (!Number.isSafeInteger(epoch) || epoch < 1) return;
    peer.remoteReadyEpoch = epoch;
    if (!peer.localReadyEpoch) this.qualifyPeer(peer);
    this.promotePeer(peer);
  }

  private promotePeer(peer: PeerState) {
    if (peer.primary
      || !peer.localReadyEpoch
      || peer.localReadyEpoch !== peer.remoteReadyEpoch) return;
    peer.primary = true;
    this.state = "rtc";
    this.emit({ type: "peerTransportChanged", userId: peer.userId, transport: "rtc" });
    this.startHealthChecks(peer);
  }

  private startHealthChecks(peer: PeerState) {
    if (peer.healthTimer !== null) window.clearInterval(peer.healthTimer);
    peer.healthTimer = window.setInterval(() => {
      if (peer.pc.connectionState === "disconnected") {
        peer.disconnectedAt ||= Date.now();
        if (Date.now() - peer.disconnectedAt >= RTC_QUALITY.disconnectedFallbackMs) {
          this.fallbackPeer(peer, "peer-disconnected");
          return;
        }
      } else {
        peer.disconnectedAt = 0;
      }
      if (peer.control?.readyState !== "open" || peer.bulk?.readyState !== "open") {
        this.fallbackPeer(peer, "channel-closed");
        return;
      }
      this.sendProbe(peer, false);
    }, RTC_QUALITY.healthIntervalMs);
  }

  private pushHealth(peer: PeerState, success: boolean, rtt?: number) {
    peer.healthOutcomes.push(success);
    if (peer.healthOutcomes.length > RTC_QUALITY.healthWindowSize) peer.healthOutcomes.shift();
    if (rtt !== undefined) {
      peer.healthRtts.push(rtt);
      if (peer.healthRtts.length > RTC_QUALITY.healthWindowSize) peer.healthRtts.shift();
    }
  }

  private evaluateHealth(peer: PeerState) {
    const lossRate = peer.healthOutcomes.length
      ? peer.healthOutcomes.filter((success) => !success).length / peer.healthOutcomes.length
      : 0;
    const averageRtt = peer.healthRtts.length
      ? peer.healthRtts.reduce((sum, value) => sum + value, 0) / peer.healthRtts.length
      : 0;
    const buffered = Math.max(peer.control?.bufferedAmount || 0, peer.bulk?.bufferedAmount || 0);
    const degraded = (peer.healthOutcomes.length >= 5 && lossRate >= RTC_QUALITY.maximumLossRate)
      || averageRtt >= RTC_QUALITY.degradedRttMs
      || buffered >= RTC_QUALITY.maximumBufferedBytes;
    if (!degraded) {
      peer.degradedSince = 0;
      return;
    }
    peer.degradedSince ||= Date.now();
    if (Date.now() - peer.degradedSince >= RTC_QUALITY.degradedWindowMs) {
      this.fallbackPeer(peer, "health-degraded");
    }
  }

  private sendPeerControl(peer: PeerState, value: Record<string, unknown>) {
    if (peer.control?.readyState === "open") peer.control.send(JSON.stringify(value));
  }

  private fallbackPeer(peer: PeerState, reason: string, notifyPeer = true) {
    if (this.disposed || peer.fallingBack || this.peers.get(peer.key) !== peer) return;
    peer.fallingBack = true;
    if (notifyPeer) {
      const message = {
        type: "transportFallback",
        transportEpoch: peer.localReadyEpoch || peer.remoteReadyEpoch || 1,
        reason,
        targetRole: this.workspace.role === "collaborator" ? "owner" : undefined,
        targetUserId: this.workspace.role === "owner" ? peer.userId : undefined,
      };
      this.sendSignal(message);
      this.sendPeerControl(peer, message);
    }
    this.peers.delete(peer.key);
    this.stopPeer(peer);
    this.state = this.hasPrimaryPeer()
      ? "rtc"
      : this.socket?.readyState === WebSocket.OPEN ? "socket" : "unavailable";
    this.emit({ type: "peerTransportChanged", userId: peer.userId, transport: "socket", reason });
    this.flushReliable();
    if (this.workspace.role === "collaborator" && this.ownerOnline) {
      this.schedule(() => this.offerOwner(), 1_000);
    }
  }

  private stopPeer(peer: PeerState) {
    if (peer.healthTimer !== null) window.clearInterval(peer.healthTimer);
    peer.healthTimer = null;
    for (const probe of peer.probes.values()) {
      window.clearTimeout(probe.timeout);
      this.timers.delete(probe.timeout);
    }
    peer.probes.clear();
    if (peer.control) peer.control.onclose = null;
    if (peer.bulk) peer.bulk.onclose = null;
    peer.control?.close();
    peer.bulk?.close();
    peer.pc.close();
  }

  private hasPrimaryPeer() {
    return [...this.peers.values()].some((peer) => peer.primary);
  }

  disconnect() {
    this.disposed = true;
    this.peers.forEach((peer) => this.sendPeerControl(peer, { type: "peerLeaving" }));
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
    this.peers.forEach((peer) => this.stopPeer(peer));
    this.peers.clear();
    this.socket?.close(1000, "page-left");
    this.socket = null;
    this.listeners.clear();
    this.onlineCollaborators.clear();
    this.ownerOnline = false;
  }
}
