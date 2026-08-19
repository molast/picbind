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
// Frozen V1 compatibility lists. New Workspace business events use workspaceRelay.
const OWNER_MESSAGE_TYPES = new Set([
  "previewSnapshot",
  "placeholderUpsert",
  "previewUpsert",
  "previewRemove",
  "commitCreated",
]);
const OWNER_STYLE_MESSAGE_TYPES = new Set(["styleSnapshot", "styleUpdated"]);
const OWNER_TARGETED_MESSAGE_TYPES = new Set([
  "sourceResponse",
  "sourceStart",
  "sourceChunk",
  "sourceComplete",
  "proposalDecision",
]);
const COLLABORATOR_MESSAGE_TYPES = new Set(["sourceRequest", "proposalSubmit", "stateRequest"]);
const WEBRTC_SIGNAL_TYPES = new Set([
  "webrtcOffer",
  "webrtcAnswer",
  "webrtcIceCandidate",
]);
const TRANSPORT_SIGNAL_TYPES = new Set(["transportReady", "transportFallback"]);
const OPERATION_TYPES = new Set([
  "convert",
  "compression",
  "crop",
  "resize",
  "rotate",
  "adjust",
  "other",
]);

function nonEmptyString(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function dataClassFor(type: string) {
  if (["presence", "reaction", "typing"].includes(type)) return "presence";
  if (["previewSnapshot", "placeholderUpsert", "previewUpsert", "previewRemove"].includes(type)) {
    return "preview";
  }
  if (["sourceStart", "sourceChunk", "sourceComplete", "commitCreated"].includes(type)) {
    return "sourceOrCommit";
  }
  return "collaborationEvent";
}

function reliabilityFor(type: string) {
  if (["presence", "reaction", "typing", "previewSnapshot"].includes(type)) return "ephemeral";
  if (["previewUpsert", "sourceStart", "sourceChunk", "sourceComplete"].includes(type)) {
    return "bulk";
  }
  return "reliable";
}

function trustedRelayPayload(
  payload: Record<string, unknown>,
  type: string,
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
    dataClass: dataClassFor(type),
    reliability: reliabilityFor(type),
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

function trustedWorkspaceStyle(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const style = value as Record<string, unknown>;
  const header = style.header as Record<string, unknown> | null;
  const background = header?.background as Record<string, unknown> | null;
  const text = header?.text as Record<string, unknown> | null;
  const color = (value: unknown) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
  const backgroundValid = background?.type === "solid"
    ? color(background.color)
    : background?.type === "gradient"
      && color(background.from)
      && color(background.to)
      && ["right", "down", "downRight"].includes(String(background.direction));
  if (
    style.version !== 1
    || typeof style.revision !== "number"
    || !Number.isSafeInteger(style.revision)
    || Number(style.revision) < 0
    || !backgroundValid
    || !nonEmptyString(text?.content, 160)
    || !color(text?.color)
    || !["inter", "system", "serif", "monospace"].includes(String(text?.fontFamily))
    || typeof text?.fontSize !== "number"
    || !Number.isInteger(text.fontSize)
    || Number(text?.fontSize) < 12
    || Number(text?.fontSize) > 32
    || typeof text?.fontWeight !== "number"
    || ![400, 500, 600, 700].includes(text.fontWeight)
  ) return null;
  return style;
}

function trustedProposal(
  value: unknown,
  attachment: WorkspaceSocketAttachment,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = value as Record<string, unknown>;
  if (
    !nonEmptyString(proposal.proposalId) ||
    proposal.workspaceId !== attachment.workspaceId ||
    !nonEmptyString(proposal.imageId) ||
    !nonEmptyString(proposal.baseCommitId) ||
    !Array.isArray(proposal.operations) ||
    proposal.operations.length === 0 ||
    proposal.operations.length > 64 ||
    typeof proposal.createdAt !== "number" ||
    !Number.isFinite(proposal.createdAt)
  ) return null;
  const operations = proposal.operations.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const operation = value as Record<string, unknown>;
    if (
      !nonEmptyString(operation.operationId) ||
      operation.imageId !== proposal.imageId ||
      operation.baseCommitId !== proposal.baseCommitId ||
      !OPERATION_TYPES.has(typeof operation.type === "string" ? operation.type : "") ||
      !operation.parameters ||
      typeof operation.parameters !== "object" ||
      Array.isArray(operation.parameters) ||
      typeof operation.createdAt !== "number" ||
      !Number.isFinite(operation.createdAt)
    ) return null;
    return { ...operation, authorId: attachment.userId };
  });
  if (operations.some((operation) => operation === null)) return null;
  return {
    ...proposal,
    authorId: attachment.userId,
    authorName: attachment.userName,
    operations,
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
      headers: isV2 ? { "sec-websocket-protocol": WORKSPACE_REALTIME_PROTOCOL } : undefined,
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
    if (!attachment || typeof message !== "string") return;
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
    if (type === "presence") {
      const operation = payload.operation;
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) return;
      this.broadcast(trustedRelayPayload({
        ...payload,
        userId: attachment.userId,
        userName: attachment.userName,
        role: attachment.role,
        online: true,
        operation,
      }, type, attachment), socket);
      return;
    }
    if (attachment.role === "owner" && OWNER_STYLE_MESSAGE_TYPES.has(type)) {
      const style = trustedWorkspaceStyle(payload.style);
      if (style) {
        const delivered = this.broadcast(
          trustedRelayPayload({ ...payload, type, style }, type, attachment),
          socket,
        );
        this.ackReliable(socket, payload, type, delivered);
      }
      return;
    }
    if (attachment.role === "owner" && OWNER_MESSAGE_TYPES.has(type)) {
      const delivered = this.broadcast(trustedRelayPayload(payload, type, attachment), socket);
      this.ackReliable(socket, payload, type, delivered);
      return;
    }
    if (attachment.role === "owner" && OWNER_TARGETED_MESSAGE_TYPES.has(type)) {
      const targetUserId = typeof payload.targetUserId === "string"
        ? payload.targetUserId
        : "";
      if (!targetUserId) return;
      const delivered = this.sendToUser(
        targetUserId,
        trustedRelayPayload(payload, type, attachment),
      );
      this.ackReliable(socket, payload, type, delivered);
      return;
    }
    if (attachment.role === "collaborator" && COLLABORATOR_MESSAGE_TYPES.has(type)) {
      if (type === "proposalSubmit") {
        const proposal = trustedProposal(payload.proposal, attachment);
        const proposalId = proposal?.proposalId as string || "";
        if (!proposal || this.state.getWebSockets("role:owner").length === 0) {
          socket.send(JSON.stringify({ type: "proposalSubmitFailed", proposalId }));
          return;
        }
        const delivered = this.sendToRole(
          "owner",
          trustedRelayPayload({
            ...payload,
            type,
            proposal,
            submitterId: attachment.userId,
            submitterName: attachment.userName,
          }, type, attachment),
        );
        this.ackReliable(socket, payload, type, delivered);
        socket.send(JSON.stringify({ type: "proposalSubmitted", proposalId }));
        return;
      }
      const delivered = this.sendToRole(
        "owner",
        trustedRelayPayload({
          ...payload,
          requesterId: attachment.userId,
          requesterName: attachment.userName,
        }, type, attachment),
      );
      this.ackReliable(socket, payload, type, delivered);
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

  private ackReliable(
    socket: WebSocket,
    payload: Record<string, unknown>,
    type: string,
    delivered: number,
  ) {
    if (delivered <= 0 || reliabilityFor(type) !== "reliable") return;
    const eventId = nonEmptyString(payload.eventId, 128) ? payload.eventId : "";
    if (!eventId) return;
    try {
      socket.send(JSON.stringify({ type: "eventAck", eventId }));
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
