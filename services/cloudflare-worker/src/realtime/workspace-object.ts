import { WORKSPACE_REALTIME_PROTOCOL } from "./workspace-v2-protocol";

type WorkspaceSocketAttachment = {
  userId: string;
  userName: string;
  workspaceId: string;
  role: "owner" | "collaborator";
  socketKind?: "v1" | "ownerControl" | "collaboratorBootstrap";
};

type StoredWorkspaceTicket = {
  ticketHash: string;
  nonce: string;
  userId: string;
  shareId?: string;
  workspaceId: string;
  role: "owner" | "collaborator";
  displayName: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

const MAX_MESSAGE_BYTES = 96 * 1024;
const MAX_BINARY_BYTES = 4 * 1024 * 1024;
const MAX_BINARY_HEADER_BYTES = 32 * 1024;
const BINARY_MAGIC = [0x50, 0x42, 0x57, 0x31] as const;
const MAX_ACTIVE_TICKETS = 256;
const TICKET_KEY_PREFIX = "ticket:";
const RELAY_TYPE = "workspaceRelay";
const RELAY_VERSION = 1;
const RELAY_ROUTES = new Set(["workspace", "owner", "user"]);
const RELAY_DELIVERIES = new Set(["ephemeral", "reliable", "bulk"]);
const RESERVED_RELAY_EVENT_TYPES = new Set([
  RELAY_TYPE,
  "connected",
  "eventAck",
  "eventNack",
  "memberJoined",
  "memberLeft",
  "memberTransportChanged",
  "ownerPresence",
  "webrtcOffer",
  "webrtcAnswer",
  "webrtcIceCandidate",
  "transportReady",
  "transportFallback",
]);
const WEBRTC_SIGNAL_TYPES = new Set([
  "webrtcOffer",
  "webrtcAnswer",
  "webrtcIceCandidate",
]);
const TRANSPORT_SIGNAL_TYPES = new Set(["transportReady", "transportFallback"]);

function nonEmptyString(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function trustedRelayPayload(
  payload: Record<string, unknown>,
  _type: string,
  attachment: WorkspaceSocketAttachment,
) {
  const eventId = nonEmptyString(payload.eventId, 128) ? payload.eventId : crypto.randomUUID();
  const sequence = typeof payload.sequence === "number"
    && Number.isSafeInteger(payload.sequence)
    && payload.sequence >= 0
    ? payload.sequence
    : 0;
  const transport = payload.transport === "webRtcDataChannel"
    ? "webRtcDataChannel"
    : "webSocketRelay";
  return {
    ...payload,
    eventId,
    sequence,
    timestamp: Date.now(),
    transport,
    senderId: attachment.userId,
    senderName: attachment.userName,
    senderRole: attachment.role,
  };
}

function trustedGenericRelayEvent(
  event: Record<string, unknown>,
  delivery: string,
  attachment: WorkspaceSocketAttachment,
) {
  const eventId = nonEmptyString(event.eventId, 128) ? event.eventId : crypto.randomUUID();
  const sequence = typeof event.sequence === "number"
    && Number.isSafeInteger(event.sequence)
    && event.sequence >= 0
    ? event.sequence
    : 0;
  return {
    ...event,
    eventId,
    sequence,
    timestamp: Date.now(),
    dataClass: nonEmptyString(event.dataClass, 64) ? event.dataClass : "collaborationEvent",
    reliability: delivery,
    transport: "webSocketRelay",
    senderId: attachment.userId,
    senderName: attachment.userName,
    senderRole: attachment.role,
  };
}

export class WorkspaceRealtimeObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/tickets/register") return this.registerTicket(request);
    if (pathname === "/tickets/consume") return this.consumeTicket(request);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const userId = request.headers.get("x-picbind-user-id") || "";
    const userName = decodeURIComponent(request.headers.get("x-picbind-user-name") || "");
    const workspaceId = request.headers.get("x-picbind-workspace-id") || "";
    const role = request.headers.get("x-picbind-workspace-role");
    const isV2 = request.headers.get("x-picbind-workspace-v2") === "1";
    const selectsProtocol = request.headers.get("x-picbind-workspace-select-protocol") === "1";
    if (!userId || !workspaceId || (role !== "owner" && role !== "collaborator")) {
      return new Response("Invalid workspace identity", { status: 403 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: WorkspaceSocketAttachment = {
      userId,
      userName,
      workspaceId,
      role,
      socketKind: isV2 ? (role === "owner" ? "ownerControl" : "collaboratorBootstrap") : "v1",
    };
    this.state.acceptWebSocket(server, [`user:${userId}`, `role:${role}`]);
    server.serializeAttachment(attachment);
    this.broadcast({ type: "memberJoined", userId, userName, role }, server);
    if (role === "owner") {
      this.broadcast({ type: "ownerPresence", online: true }, server);
    }
    const members = this.state.getWebSockets().flatMap((candidate) => {
      if (candidate === server) return [];
      const member = candidate.deserializeAttachment() as WorkspaceSocketAttachment | null;
      return member ? [{
        userId: member.userId,
        userName: member.userName,
        role: member.role,
      }] : [];
    });
    server.send(JSON.stringify({
      type: "connected",
      userId,
      role,
      members,
      ownerOnline: this.state.getWebSockets("role:owner").length > 0,
    }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: isV2 && selectsProtocol
        ? { "sec-websocket-protocol": WORKSPACE_REALTIME_PROTOCOL }
        : undefined,
    });
  }

  async alarm() {
    await this.pruneTickets(Date.now());
  }

  private ticketKey(ticketHash: string) {
    return `${TICKET_KEY_PREFIX}${ticketHash}`;
  }

  private validTicket(value: unknown): value is StoredWorkspaceTicket {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const ticket = value as Partial<StoredWorkspaceTicket>;
    return typeof ticket.ticketHash === "string"
      && /^[A-Za-z0-9_-]{43}$/.test(ticket.ticketHash)
      && typeof ticket.nonce === "string"
      && ticket.nonce.length >= 16
      && ticket.nonce.length <= 128
      && typeof ticket.userId === "string"
      && ticket.userId.length > 0
      && ticket.userId.length <= 128
      && typeof ticket.workspaceId === "string"
      && ticket.workspaceId.length > 0
      && ticket.workspaceId.length <= 128
      && (ticket.role === "owner" || ticket.role === "collaborator")
      && typeof ticket.displayName === "string"
      && ticket.displayName.length <= 80
      && typeof ticket.origin === "string"
      && ticket.origin.length <= 512
      && Number.isSafeInteger(ticket.issuedAt)
      && Number.isSafeInteger(ticket.expiresAt)
      && Number(ticket.expiresAt) > Number(ticket.issuedAt)
      && Number(ticket.expiresAt) - Number(ticket.issuedAt) <= 60_000
      && ticket.consumedAt === null;
  }

  private async registerTicket(request: Request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const ticket = await request.json().catch(() => null);
    if (!this.validTicket(ticket)) return new Response("Invalid ticket metadata", { status: 400 });
    const now = Date.now();
    if (ticket.issuedAt > now + 30_000 || ticket.expiresAt <= now) {
      return new Response("Invalid ticket lifetime", { status: 400 });
    }
    const tickets = await this.state.storage.list<StoredWorkspaceTicket>({ prefix: TICKET_KEY_PREFIX });
    const expiredKeys: string[] = [];
    let activeCount = 0;
    for (const [key, stored] of tickets) {
      if (stored.expiresAt <= now) expiredKeys.push(key);
      else activeCount += 1;
    }
    if (expiredKeys.length) await this.state.storage.delete(expiredKeys);
    if (activeCount >= MAX_ACTIVE_TICKETS) return new Response("Too many active tickets", { status: 429 });
    await this.state.storage.put(this.ticketKey(ticket.ticketHash), ticket);
    const alarm = await this.state.storage.getAlarm();
    if (alarm === null || ticket.expiresAt < alarm) await this.state.storage.setAlarm(ticket.expiresAt);
    return new Response(null, { status: 201 });
  }

  private async consumeTicket(request: Request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const ticketHash = typeof body?.ticketHash === "string" ? body.ticketHash : "";
    const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
    const origin = typeof body?.origin === "string" ? body.origin : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticketHash) || !workspaceId || !origin) {
      return new Response("Invalid ticket", { status: 401 });
    }
    const now = Date.now();
    let result:
      | { status: 200; ticket: StoredWorkspaceTicket }
      | { status: 401 | 403 | 409; message: string } = { status: 401, message: "Invalid ticket" };
    await this.state.storage.transaction(async (transaction) => {
      const key = this.ticketKey(ticketHash);
      const stored = await transaction.get<StoredWorkspaceTicket>(key);
      if (!stored) return;
      if (stored.consumedAt !== null) {
        result = { status: 409, message: "Ticket already used" };
        return;
      }
      if (stored.expiresAt <= now) {
        result = { status: 401, message: "Ticket expired" };
        return;
      }
      if (stored.workspaceId !== workspaceId || stored.origin !== origin) {
        result = { status: 403, message: "Ticket binding mismatch" };
        return;
      }
      const consumed = { ...stored, consumedAt: now };
      await transaction.put(key, consumed);
      result = { status: 200, ticket: consumed };
    });
    return "ticket" in result
      ? new Response(JSON.stringify(result.ticket), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
      : new Response(result.message, { status: result.status });
  }

  private async pruneTickets(now: number) {
    const tickets = await this.state.storage.list<StoredWorkspaceTicket>({ prefix: TICKET_KEY_PREFIX });
    const expiredKeys: string[] = [];
    let nextExpiry: number | null = null;
    for (const [key, ticket] of tickets) {
      if (ticket.expiresAt <= now) expiredKeys.push(key);
      else nextExpiry = nextExpiry === null ? ticket.expiresAt : Math.min(nextExpiry, ticket.expiresAt);
    }
    if (expiredKeys.length) await this.state.storage.delete(expiredKeys);
    if (nextExpiry !== null) await this.state.storage.setAlarm(nextExpiry);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socket.deserializeAttachment() as WorkspaceSocketAttachment | null;
    if (!attachment) return;
    if (message instanceof ArrayBuffer) {
      this.relayBinaryEvent(socket, message, attachment);
      return;
    }
    if (new TextEncoder().encode(message).byteLength > MAX_MESSAGE_BYTES) {
      socket.close(1009, "Workspace message is too large");
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "memberKick") {
      if (attachment.role !== "owner" || !nonEmptyString(payload.targetUserId, 128)) return;
      const targetUserId = payload.targetUserId;
      const targets = this.state.getWebSockets(`user:${targetUserId}`);
      if (!targets.length) return;
      this.sendToSockets(targets, {
        type: "memberRemoved",
        userId: targetUserId,
        reason: "Removed by Owner",
      });
      for (const target of targets) {
        try { target.close(4003, "Removed by Owner"); } catch { /* Closing sockets are ignored. */ }
      }
      return;
    }
    if (type === RELAY_TYPE) {
      this.relayGenericEvent(socket, payload, attachment);
      return;
    }
    if (WEBRTC_SIGNAL_TYPES.has(type) || TRANSPORT_SIGNAL_TYPES.has(type)) {
      if (
        TRANSPORT_SIGNAL_TYPES.has(type)
        && (
          typeof payload.transportEpoch !== "number"
          || !Number.isSafeInteger(payload.transportEpoch)
          || payload.transportEpoch < 1
        )
      ) return;
      const relay = trustedRelayPayload(payload, type, attachment);
      if (attachment.role === "collaborator" && payload.targetRole === "owner") {
        this.sendToRole("owner", relay);
      } else if (attachment.role === "owner" && nonEmptyString(payload.targetUserId)) {
        this.sendToUser(payload.targetUserId, relay);
      } else if (
        attachment.role === "collaborator"
        && nonEmptyString(payload.targetUserId)
      ) {
        this.sendToUser(payload.targetUserId, relay);
      }
      return;
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    const attachment = socket.deserializeAttachment() as WorkspaceSocketAttachment | null;
    if (attachment) {
      if (
        attachment.socketKind === "collaboratorBootstrap"
        && code === 1000
        && reason === "rtc-promoted"
      ) {
        this.broadcast({
          type: "memberTransportChanged",
          userId: attachment.userId,
          role: attachment.role,
          transport: "webRtcDataChannel",
        }, socket);
        return;
      }
      this.broadcast({
        type: "memberLeft",
        userId: attachment.userId,
        role: attachment.role,
      }, socket);
      if (
        attachment.role === "owner" &&
        this.state.getWebSockets("role:owner").every((candidate) => candidate === socket)
      ) {
        this.broadcast({ type: "ownerPresence", online: false }, socket);
      }
    }
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "Workspace realtime connection failed");
  }

  private relayGenericEvent(
    socket: WebSocket,
    payload: Record<string, unknown>,
    attachment: WorkspaceSocketAttachment,
  ) {
    if (payload.version !== RELAY_VERSION) return;
    const route = typeof payload.route === "string" ? payload.route : "";
    const delivery = typeof payload.delivery === "string" ? payload.delivery : "";
    const event = payload.event;
    if (
      !RELAY_ROUTES.has(route)
      || !RELAY_DELIVERIES.has(delivery)
      || !event
      || typeof event !== "object"
      || Array.isArray(event)
    ) return;
    const eventRecord = event as Record<string, unknown>;
    const eventType = typeof eventRecord.type === "string" ? eventRecord.type : "";
    if (!nonEmptyString(eventType, 128) || RESERVED_RELAY_EVENT_TYPES.has(eventType)) return;

    const relay = {
      type: RELAY_TYPE,
      version: RELAY_VERSION,
      event: trustedGenericRelayEvent(eventRecord, delivery, attachment),
    };
    let delivered = 0;
    if (route === "workspace") {
      delivered = this.broadcast(relay, socket);
    } else if (route === "owner") {
      delivered = this.sendToRole("owner", relay);
    } else if (route === "user" && nonEmptyString(payload.targetUserId, 128)) {
      delivered = this.sendToUser(payload.targetUserId, relay);
    }
    this.ackDelivery(socket, eventRecord, delivery, delivered);
  }

  private relayBinaryEvent(
    socket: WebSocket,
    frame: ArrayBuffer,
    attachment: WorkspaceSocketAttachment,
  ) {
    if (frame.byteLength < 9 || frame.byteLength > MAX_BINARY_BYTES) return;
    const bytes = new Uint8Array(frame);
    if (BINARY_MAGIC.some((value, index) => bytes[index] !== value)) return;
    const headerLength = new DataView(frame).getUint32(4, false);
    if (headerLength < 2 || headerLength > MAX_BINARY_HEADER_BYTES || 8 + headerLength >= frame.byteLength) return;
    let header: Record<string, unknown>;
    try {
      header = JSON.parse(new TextDecoder().decode(bytes.slice(8, 8 + headerLength))) as Record<string, unknown>;
    } catch {
      return;
    }
    const route = typeof header.route === "string" ? header.route : "";
    const delivery = typeof header.delivery === "string" ? header.delivery : "";
    const event = header.event;
    if (!RELAY_ROUTES.has(route) || !RELAY_DELIVERIES.has(delivery) || !event || typeof event !== "object" || Array.isArray(event)) return;
    const eventRecord = event as Record<string, unknown>;
    const eventType = typeof eventRecord.type === "string" ? eventRecord.type : "";
    if (!nonEmptyString(eventType, 128) || RESERVED_RELAY_EVENT_TYPES.has(eventType)) return;
    const trustedHeader = new TextEncoder().encode(JSON.stringify({
      type: "workspaceBinary",
      version: RELAY_VERSION,
      event: trustedGenericRelayEvent(eventRecord, delivery, attachment),
    }));
    if (trustedHeader.byteLength > MAX_BINARY_HEADER_BYTES) return;
    const relayed = new Uint8Array(8 + trustedHeader.byteLength + frame.byteLength - 8 - headerLength);
    relayed.set(BINARY_MAGIC, 0);
    new DataView(relayed.buffer).setUint32(4, trustedHeader.byteLength, false);
    relayed.set(trustedHeader, 8);
    relayed.set(bytes.slice(8 + headerLength), 8 + trustedHeader.byteLength);
    let delivered = 0;
    if (route === "workspace") delivered = this.sendBinary(this.state.getWebSockets().filter((candidate) => candidate !== socket), relayed.buffer);
    else if (route === "owner") delivered = this.sendBinary(this.state.getWebSockets("role:owner"), relayed.buffer);
    else if (route === "user" && nonEmptyString(header.targetUserId, 128)) delivered = this.sendBinary(this.state.getWebSockets(`user:${header.targetUserId}`), relayed.buffer);
    this.ackDelivery(socket, eventRecord, delivery, delivered);
  }

  private sendBinary(sockets: WebSocket[], frame: ArrayBuffer) {
    let delivered = 0;
    for (const socket of sockets) {
      try { socket.send(frame); delivered += 1; } catch { /* Closing sockets are ignored. */ }
    }
    return delivered;
  }

  private ackDelivery(
    socket: WebSocket,
    event: Record<string, unknown>,
    delivery: string,
    delivered: number,
  ) {
    if (delivery !== "reliable") return;
    const eventId = nonEmptyString(event.eventId, 128) ? event.eventId : "";
    if (!eventId) return;
    try {
      socket.send(JSON.stringify({ type: delivered > 0 ? "eventAck" : "eventNack", eventId }));
    } catch {
      // The sender will retain and retry the event after reconnecting.
    }
  }

  private broadcast(payload: Record<string, unknown>, excluded?: WebSocket) {
    const message = JSON.stringify(payload);
    let delivered = 0;
    for (const socket of this.state.getWebSockets()) {
      if (socket === excluded) continue;
      try {
        socket.send(message);
        delivered += 1;
      } catch {
        // Closing sockets disappear from the hibernation API's active set.
      }
    }
    return delivered;
  }

  private sendToRole(role: WorkspaceSocketAttachment["role"], payload: Record<string, unknown>) {
    return this.sendToSockets(this.state.getWebSockets(`role:${role}`), payload);
  }

  private sendToUser(userId: string, payload: Record<string, unknown>) {
    return this.sendToSockets(this.state.getWebSockets(`user:${userId}`), payload);
  }

  private sendToSockets(sockets: WebSocket[], payload: Record<string, unknown>) {
    const message = JSON.stringify(payload);
    let delivered = 0;
    for (const socket of sockets) {
      try {
        socket.send(message);
        delivered += 1;
      } catch {
        // Closing sockets disappear from the hibernation API's active set.
      }
    }
    return delivered;
  }
}
