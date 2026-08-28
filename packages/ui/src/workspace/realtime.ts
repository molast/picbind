import { realtimeTicket } from "./api";
import {
  REALTIME_LIMITS,
  REALTIME_QUALITY,
  RealtimeTransportError,
  realtimeFrameBytes,
  toRealtimeError,
  type RealtimeFrame,
  type RealtimeIceCandidate,
  type RealtimePeer,
  type RealtimePeerConnectionState,
  type RealtimePeerFactory,
  type RealtimeSendOptions,
  type RealtimeSession,
  type RealtimeSessionEvent,
  type RealtimeSessionState,
  type RealtimeSocket,
  type RealtimeSocketFactory,
} from "@picbind/shared";
import {
  decodeBinaryRelay,
  encodeBinaryRelay,
  streamId,
  type RelayDelivery,
  type RelayRoute,
  WorkspaceEventGate,
} from "./realtime-protocol";
import type { WorkspaceEvent } from "./types";

type Listener = (event: RealtimeSessionEvent) => void;
type Transport = "socket" | "rtc";
type SendOptions = RealtimeSendOptions;
type PendingFrame = {
  frame: RealtimeFrame;
  bytes: number;
  delivery: RelayDelivery;
  dataClass: WorkspaceEvent["dataClass"];
};
type Probe = { sentAt: number; qualification: boolean; timeout: number };
type PeerState = {
  key: string;
  userId: string;
  peer: RealtimePeer;
  unsubscribe: () => void;
  connectionState: RealtimePeerConnectionState;
  controlOpen: boolean;
  bulkOpen: boolean;
  candidates: RealtimeIceCandidate[];
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

export type WorkspaceRealtimeDependencies = {
  socketFactory: RealtimeSocketFactory;
  peerFactory: RealtimePeerFactory;
};

export type WorkspaceRealtimeIdentity = {
  workspaceId: string;
  role: "owner" | "collaborator";
  shareToken: string | null;
  ownerCapability: string | null;
};

export class WorkspaceRealtimeClient implements RealtimeSession {
  readonly id = crypto.randomUUID();
  private socket: RealtimeSocket | null = null;
  private socketUnsubscribe: (() => void) | null = null;
  private socketGeneration = 0;
  private readonly peers = new Map<string, PeerState>();
  private readonly pendingCandidates = new Map<string, RealtimeIceCandidate[]>();
  private readonly listeners = new Set<Listener>();
  private readonly reliable = new Map<string, PendingFrame>();
  private readonly reliableTypes = new Map<string, string>();
  private readonly sequences = new Map<string, number>();
  private readonly eventGate = new WorkspaceEventGate();
  private readonly timers = new Set<number>();
  private readonly onlineCollaborators = new Set<string>();
  private readonly localUserId: string;
  private reliableBytes = 0;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private disposed = false;
  private ownerOnline = false;
  private iceServers: import("@picbind/shared").RealtimeIceServer[] = [];
  private currentState: RealtimeSessionState = "idle";
  private connectPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(
    private workspace: WorkspaceRealtimeIdentity,
    private readonly dependencies: WorkspaceRealtimeDependencies,
    private readonly localClientId: string,
  ) {
    this.localUserId = `${workspace.role === "owner" ? "owner" : "guest"}-${this.localClientId}`;
  }

  get state() {
    return this.currentState;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(value: RealtimeSessionEvent) {
    this.listeners.forEach((listener) => listener(value));
  }

  private setState(state: RealtimeSessionState) {
    if (this.currentState === state) return;
    this.currentState = state;
    this.emit({ type: "stateChanged", state });
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
    if (this.disposed) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = (async () => {
      try {
        await this.connectTransport();
      } catch (error) {
        if (this.disposed) return;
        this.emit({
          type: "error",
          error: toRealtimeError(error, {
            code: "socketConnectFailed",
            message: "Realtime connection failed",
            retryable: true,
          }),
        });
        this.setState(this.hasPrimaryPeer() ? "rtc" : "unavailable");
        this.scheduleReconnect();
      }
    })().finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  private async connectTransport() {
    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const ticket = await realtimeTicket(this.workspace, this.localClientId).catch((error) => {
      throw new RealtimeTransportError("ticketFailed", "Realtime ticket request failed", true, error);
    });
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
    const generation = ++this.socketGeneration;
    const socket = await this.dependencies.socketFactory.connect({ url: url.toString() }).catch((error) => {
      throw new RealtimeTransportError("socketConnectFailed", "Realtime socket connection failed", true, error);
    });
    if (this.disposed || generation !== this.socketGeneration) {
      await socket.close(1000, "stale-generation");
      return;
    }
    this.socketUnsubscribe?.();
    this.socket = socket;
    const open = () => {
      this.reconnectAttempt = 0;
      this.setState(this.hasPrimaryPeer() ? "rtc" : "socket");
      this.flushReliable();
    };
    this.socketUnsubscribe = socket.subscribe((event) => {
      if (generation !== this.socketGeneration || this.socket !== socket) return;
      if (event.type === "open") open();
      else if (event.type === "message") this.receive(event.frame, "socket");
      else if (event.type === "error") {
        this.emit({ type: "error", error: event.error });
        if (!this.hasPrimaryPeer()) this.setState("unavailable");
      } else if (event.type === "close") {
        this.socketUnsubscribe?.();
        this.socketUnsubscribe = null;
        if (this.socket === socket) this.socket = null;
        if (this.disposed) return;
        this.setState(this.hasPrimaryPeer() ? "rtc" : "unavailable");
        this.scheduleReconnect();
      }
    });
    if (socket.state === "open") open();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.disposed) return;
    const baseDelay = Math.min(
      REALTIME_QUALITY.reconnectInitialDelayMs * (2 ** this.reconnectAttempt),
      REALTIME_QUALITY.reconnectMaximumDelayMs,
    );
    const delay = Math.floor(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private peerKey(senderId?: string) {
    return this.workspace.role === "collaborator" ? "owner" : senderId || "";
  }

  private receive(frame: RealtimeFrame, transport: Transport, rtcPeer?: PeerState) {
    let value: Record<string, unknown>;
    if (frame.kind === "binary") {
      const decoded = decodeBinaryRelay(frame.data);
      if (!decoded) return;
      value = { type: "workspaceRelay", event: { ...decoded.event, bytes: decoded.bytes } };
    } else {
      try {
        value = JSON.parse(frame.data) as Record<string, unknown>;
      } catch {
        this.emit({
          type: "error",
          error: new RealtimeTransportError(
            "invalidFrame",
            "Realtime text frame is not valid JSON",
            false,
          ).toRealtimeError(),
        });
        return;
      }
    }

    if (value.type === "eventAck" && typeof value.eventId === "string") {
      const pending = this.reliable.get(value.eventId);
      if (pending) this.reliableBytes -= pending.bytes;
      this.reliable.delete(value.eventId);
      this.reliableTypes.delete(value.eventId);
      this.peers.forEach((peer) => this.qualifyPeer(peer));
      return;
    }
    if (value.type === "eventNack" && typeof value.eventId === "string") {
      const eventType = this.reliableTypes.get(value.eventId);
      const pending = this.reliable.get(value.eventId);
      if (pending) this.reliableBytes -= pending.bytes;
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
    this.emit({ ...value, type: typeof value.type === "string" ? value.type : "message", transport });
  }

  private nextEvent(type: string, payload: Record<string, unknown>, options: SendOptions) {
    const route = options.route || "workspace";
    const eventStream = streamId(route, options.targetUserId);
    const reliability = options.delivery || "reliable";
    const sequenceStream = `${reliability}:${eventStream}`;
    const sequence = (this.sequences.get(sequenceStream) || 0) + 1;
    this.sequences.set(sequenceStream, sequence);
    return {
      eventId: crypto.randomUUID(),
      sequence,
      timestamp: Date.now(),
      dataClass: options.dataClass || "collaborationEvent",
      reliability,
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
    if (!this.rememberReliable(event, frame, options)) return event.eventId;
    this.routeFrame(frame, event, options);
    return event.eventId;
  }

  async removeCollaborator(userId: string) {
    if (this.workspace.role !== "owner" || !userId || this.socket?.state !== "open") return false;
    await this.socket.send({
      kind: "text",
      data: JSON.stringify({ type: "memberKick", targetUserId: userId }),
    });
    return true;
  }

  sendBinary(
    type: string,
    payload: Record<string, unknown>,
    binary: ArrayBuffer,
    options: Omit<SendOptions, "delivery"> & { delivery?: "reliable" | "bulk" } = {},
  ) {
    const event = this.nextEvent(type, payload, options);
    let frame: RealtimeFrame;
    try {
      frame = { kind: "binary", data: encodeBinaryRelay({
        route: options.route || "workspace",
        targetUserId: options.targetUserId,
        delivery: options.delivery || "bulk",
        event,
        bytes: binary,
      }) };
    } catch (error) {
      this.emit({ type: "deliveryFailed", eventId: event.eventId, eventType: type });
      this.emit({
        type: "error",
        error: toRealtimeError(error, {
          code: "invalidFrame",
          message: "Workspace binary event is too large",
          retryable: false,
        }),
      });
      return event.eventId;
    }
    if (!this.rememberReliable(event, frame, options)) return event.eventId;
    this.routeFrame(frame, event, options);
    return event.eventId;
  }

  private encodeJsonFrame(event: WorkspaceEvent, route: RelayRoute, targetUserId?: string) {
    return {
      kind: "text",
      data: JSON.stringify({
        type: "workspaceRelay",
        version: 1,
        route,
        targetUserId,
        delivery: event.reliability,
        event,
      }),
    } satisfies RealtimeFrame;
  }

  private rememberReliable(event: WorkspaceEvent, frame: RealtimeFrame, options: SendOptions) {
    if (event.reliability !== "reliable") return true;
    const bytes = realtimeFrameBytes(frame);
    if (this.reliable.size >= REALTIME_LIMITS.maximumReliableEvents
      || this.reliableBytes + bytes > REALTIME_LIMITS.maximumReliableBytes) {
      const error = new RealtimeTransportError(
        "socketQueueFull",
        "Workspace reliable event queue is full",
        true,
      ).toRealtimeError();
      this.emit({ type: "deliveryFailed", eventId: event.eventId, eventType: event.type });
      this.emit({ type: "error", error });
      return false;
    }
    this.reliable.set(event.eventId, {
      frame,
      bytes,
      delivery: options.delivery || "reliable",
      dataClass: event.dataClass,
    });
    this.reliableBytes += bytes;
    this.reliableTypes.set(event.eventId, event.type);
    return true;
  }

  private routeFrame(frame: RealtimeFrame, event: WorkspaceEvent, options: SendOptions) {
    if (this.workspace.role === "collaborator") {
      const peer = this.peers.get("owner");
      if (peer?.primary && this.sendPeerFrame(peer, frame, event, frame)) return;
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
      const socketFallback = this.targetFrame(frame, userId);
      if (peer?.primary && this.sendPeerFrame(peer, frame, event, socketFallback)) continue;
      this.sendSocket(socketFallback);
    }
  }

  private targetFrame(frame: RealtimeFrame, targetUserId: string): RealtimeFrame {
    if (frame.kind === "text") {
      const envelope = JSON.parse(frame.data) as { event: WorkspaceEvent };
      return this.encodeJsonFrame(envelope.event, "user", targetUserId);
    }
    const decoded = decodeBinaryRelay(frame.data);
    if (!decoded) return frame;
    return {
      kind: "binary",
      data: encodeBinaryRelay({
        route: "user",
        targetUserId,
        delivery: decoded.event.reliability === "reliable" ? "reliable" : "bulk",
        event: decoded.event,
        bytes: decoded.bytes,
      }),
    } satisfies RealtimeFrame;
  }

  private sendPeerFrame(
    peer: PeerState,
    frame: RealtimeFrame,
    event: WorkspaceEvent,
    socketFallback = frame,
  ) {
    const channel = frame.kind === "binary"
      || event.reliability === "bulk"
      || event.dataClass === "preview"
      ? "bulk"
      : "control";
    if (channel === "bulk" ? !peer.bulkOpen : !peer.controlOpen) return false;
    void peer.peer.send(channel, frame).catch((error) => {
      const realtimeError = toRealtimeError(error, {
        code: "rtcDataChannelFailed",
        message: "RTC DataChannel send failed",
        retryable: true,
      });
      if (realtimeError.code === "rtcBackpressure") {
        this.sendSocket(socketFallback);
        return;
      }
      this.emit({
        type: "error",
        error: realtimeError,
      });
      this.fallbackPeer(peer, "send-failed");
      this.sendSocket(socketFallback);
    });
    return true;
  }

  private sendSocket(frame: RealtimeFrame) {
    if (this.socket?.state !== "open") return false;
    void this.socket.send(frame).catch((error) => {
      this.emit({
        type: "error",
        error: toRealtimeError(error, {
          code: "socketClosed",
          message: "Realtime socket send failed",
          retryable: true,
        }),
      });
      if (!this.hasPrimaryPeer()) this.setState("unavailable");
    });
    return true;
  }

  private flushReliable() {
    if (this.socket?.state !== "open") return;
    this.reliable.forEach(({ frame }) => this.sendSocket(frame));
  }

  private sendSignal(value: Record<string, unknown>) {
    this.sendSocket({ kind: "text", data: JSON.stringify(value) });
  }

  private async createPeer(key: string, userId: string, initiator: boolean) {
    const existing = this.peers.get(key);
    if (existing) this.stopPeer(existing);
    const nativePeer = await this.dependencies.peerFactory.create({
      sessionId: this.id,
      peerId: key,
      iceServers: this.iceServers,
      initiator,
    });
    const peer: PeerState = {
      key,
      userId,
      peer: nativePeer,
      unsubscribe: () => undefined,
      connectionState: "new",
      controlOpen: false,
      bulkOpen: false,
      candidates: this.pendingCandidates.get(key) || [],
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
    this.pendingCandidates.delete(key);
    this.peers.set(key, peer);
    peer.unsubscribe = nativePeer.subscribe((event) => {
      if (this.peers.get(key) !== peer) return;
      if (event.type === "iceCandidate") {
        this.sendSignal({
          type: "webrtcIceCandidate",
          targetRole: this.workspace.role === "collaborator" ? "owner" : undefined,
          targetUserId: this.workspace.role === "owner" ? peer.userId : undefined,
          candidate: event.candidate,
        });
      } else if (event.type === "connectionState") {
        peer.connectionState = event.state;
        if (["failed", "closed"].includes(event.state)) {
          this.fallbackPeer(peer, "peer-failed");
        } else if (event.state === "connected") {
          peer.disconnectedAt = 0;
          this.startQualification(peer);
        }
      } else if (event.type === "channelState") {
        if (event.channel === "control") peer.controlOpen = event.state === "open";
        else peer.bulkOpen = event.state === "open";
        if (event.state === "closed") this.fallbackPeer(peer, "channel-closed");
        else this.startQualification(peer);
      } else if (event.type === "message") {
        this.receive(event.frame, "rtc", peer);
      } else if (event.type === "error") {
        this.emit({ type: "error", error: event.error });
        this.fallbackPeer(peer, "peer-error");
      }
    });
    return peer;
  }

  private offerOwner() {
    if (this.workspace.role !== "collaborator"
      || !this.ownerOnline
      || this.socket?.state !== "open") return;
    const current = this.peers.get("owner");
    if (current && !current.fallingBack && current.connectionState !== "closed") return;
    void (async () => {
      const peer = await this.createPeer("owner", "owner", true);
      const offer = await peer.peer.createOffer();
      await peer.peer.setLocalDescription(offer);
      this.sendSignal({ type: "webrtcOffer", description: offer, targetRole: "owner" });
    })().catch((error) => {
      const peer = this.peers.get("owner");
      if (peer) this.fallbackPeer(peer, "offer-failed");
      this.emit({
        type: "error",
        error: toRealtimeError(error, {
          code: "rtcSignalFailed",
          message: "RTC offer creation failed",
          retryable: true,
        }),
      });
    });
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
      const peer = await this.createPeer(key, senderId, false);
      await peer.peer.setRemoteDescription(description);
      await this.flushCandidates(peer);
      const answer = await peer.peer.createAnswer();
      await peer.peer.setLocalDescription(answer);
      this.sendSignal({ type: "webrtcAnswer", description: answer, targetUserId: senderId });
      return;
    }
    const peer = this.peers.get(key);
    if (!peer) {
      if (value.type === "webrtcIceCandidate" && value.candidate) {
        const candidates = this.pendingCandidates.get(key) || [];
        if (candidates.length < 256) candidates.push(value.candidate as RealtimeIceCandidate);
        this.pendingCandidates.set(key, candidates);
      }
      return;
    }
    if (value.type === "webrtcAnswer") {
      const description = this.description(value, "answer");
      if (!description) return;
      await peer.peer.setRemoteDescription(description);
      await this.flushCandidates(peer);
    } else if (value.type === "webrtcIceCandidate" && value.candidate) {
      await peer.peer.addIceCandidate(value.candidate as RealtimeIceCandidate);
    }
  }

  private description(value: Record<string, unknown>, type: "offer" | "answer") {
    if (value.description && typeof value.description === "object") {
      const description = value.description as Partial<import("@picbind/shared").RealtimeSessionDescription>;
      return description.type === type && typeof description.sdp === "string"
        ? { type, sdp: description.sdp }
        : null;
    }
    return typeof value.sdp === "string" ? { type, sdp: value.sdp } : null;
  }

  private async flushCandidates(peer: PeerState) {
    for (const candidate of peer.candidates.splice(0)) await peer.peer.addIceCandidate(candidate);
  }

  private startQualification(peer: PeerState) {
    if (peer.qualificationStartedAt
      || !peer.controlOpen
      || !peer.bulkOpen) return;
    peer.qualificationStartedAt = Date.now();
    for (let index = 0; index < REALTIME_QUALITY.requiredQualificationProbes; index += 1) {
      this.schedule(() => this.sendProbe(peer, true), index * 300);
    }
    this.schedule(() => this.qualifyPeer(peer), REALTIME_QUALITY.minimumStableMs + 100);
    this.schedule(() => {
      if (!peer.primary) this.fallbackPeer(peer, "qualification-failed");
    }, 6_000);
  }

  private sendProbe(peer: PeerState, qualification: boolean) {
    if (!peer.controlOpen) return;
    const probeId = crypto.randomUUID();
    const sentAt = Date.now();
    const timeout = this.schedule(() => {
      if (!peer.probes.delete(probeId)) return;
      if (!qualification) {
        this.pushHealth(peer, false);
        this.evaluateHealth(peer);
      }
    }, REALTIME_QUALITY.probeTimeoutMs);
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
      || !peer.controlOpen
      || !peer.bulkOpen
      || peer.qualificationRtts.length < REALTIME_QUALITY.requiredQualificationProbes
      || Math.max(...peer.qualificationRtts) > REALTIME_QUALITY.maximumQualificationRttMs
      || Date.now() - peer.qualificationStartedAt < REALTIME_QUALITY.minimumStableMs
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
    this.setState("rtc");
    this.emit({ type: "peerTransportChanged", userId: peer.userId, transport: "rtc" });
    this.startHealthChecks(peer);
  }

  private startHealthChecks(peer: PeerState) {
    if (peer.healthTimer !== null) window.clearInterval(peer.healthTimer);
    peer.healthTimer = window.setInterval(() => {
      if (peer.connectionState === "disconnected") {
        peer.disconnectedAt ||= Date.now();
        if (Date.now() - peer.disconnectedAt >= REALTIME_QUALITY.disconnectedFallbackMs) {
          this.fallbackPeer(peer, "peer-disconnected");
          return;
        }
      } else {
        peer.disconnectedAt = 0;
      }
      if (!peer.controlOpen || !peer.bulkOpen) {
        this.fallbackPeer(peer, "channel-closed");
        return;
      }
      this.sendProbe(peer, false);
      void Promise.all([
        peer.peer.bufferedAmount("control"),
        peer.peer.bufferedAmount("bulk"),
      ]).then(([control, bulk]) => this.evaluateHealth(peer, Math.max(control, bulk))).catch(() => {
        this.fallbackPeer(peer, "buffered-amount-failed");
      });
    }, REALTIME_QUALITY.healthIntervalMs);
  }

  private pushHealth(peer: PeerState, success: boolean, rtt?: number) {
    peer.healthOutcomes.push(success);
    if (peer.healthOutcomes.length > REALTIME_QUALITY.healthWindowSize) peer.healthOutcomes.shift();
    if (rtt !== undefined) {
      peer.healthRtts.push(rtt);
      if (peer.healthRtts.length > REALTIME_QUALITY.healthWindowSize) peer.healthRtts.shift();
    }
  }

  private evaluateHealth(peer: PeerState, buffered = 0) {
    const lossRate = peer.healthOutcomes.length
      ? peer.healthOutcomes.filter((success) => !success).length / peer.healthOutcomes.length
      : 0;
    const averageRtt = peer.healthRtts.length
      ? peer.healthRtts.reduce((sum, value) => sum + value, 0) / peer.healthRtts.length
      : 0;
    const degraded = (peer.healthOutcomes.length >= 5 && lossRate >= REALTIME_QUALITY.maximumLossRate)
      || averageRtt >= REALTIME_QUALITY.degradedRttMs
      || buffered >= REALTIME_LIMITS.maximumRtcBulkBufferedBytes;
    if (!degraded) {
      peer.degradedSince = 0;
      return;
    }
    peer.degradedSince ||= Date.now();
    if (Date.now() - peer.degradedSince >= REALTIME_QUALITY.degradedWindowMs) {
      this.fallbackPeer(peer, "health-degraded");
    }
  }

  private sendPeerControl(peer: PeerState, value: Record<string, unknown>) {
    if (!peer.controlOpen) return;
    void peer.peer.send("control", {
      kind: "text",
      data: JSON.stringify(value),
    }).catch(() => this.fallbackPeer(peer, "control-send-failed"));
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
    this.setState(this.hasPrimaryPeer()
      ? "rtc"
      : this.socket?.state === "open" ? "socket" : "unavailable");
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
    peer.unsubscribe();
    peer.controlOpen = false;
    peer.bulkOpen = false;
    void peer.peer.close();
  }

  private hasPrimaryPeer() {
    return [...this.peers.values()].some((peer) => peer.primary);
  }

  async close(reason = "page-left") {
    this.closePromise ??= (async () => {
      this.disposed = true;
      this.setState("closed");
      this.peers.forEach((peer) => this.sendPeerControl(peer, { type: "peerLeaving" }));
      if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.reconnectAttempt = 0;
      this.timers.forEach((timer) => window.clearTimeout(timer));
      this.timers.clear();
      this.peers.forEach((peer) => this.stopPeer(peer));
      this.peers.clear();
      this.pendingCandidates.clear();
      this.socketGeneration += 1;
      this.socketUnsubscribe?.();
      this.socketUnsubscribe = null;
      await this.socket?.close(1000, reason);
      this.socket = null;
      this.listeners.clear();
      this.onlineCollaborators.clear();
      this.ownerOnline = false;
    })();
    return this.closePromise;
  }
}
