export const SHARE_ROOM_TTL_MS = 30 * 60 * 1000;
export const SHARE_ROOM_PRESENCE_TIMEOUT_MS = 120 * 1000;
export const SHARE_ROOM_RECOVERY_GRACE_MS = 10 * 60 * 1000;
const MAX_ACTIVE_R2_OBJECTS_PER_ROOM = 100;
const MAX_RELAY_MESSAGE_BYTES = 16 * 1024;

export type ShareRoomRole = "owner" | "guest";

export type ShareRoomMember = {
  clientId: string;
  sessionId: string;
  role: ShareRoomRole;
  ready: boolean;
  lastSeen: number;
  status: "online" | "offline" | "kicked";
  leftAt?: number;
};

export type ShareRoomSignal = {
  ownerSessionId: string;
  guestSessionId: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  ownerCandidates?: RTCIceCandidateInit[];
  guestCandidates?: RTCIceCandidateInit[];
};

export type ShareRoomR2ObjectStatus =
  | "uploaded"
  | "shared"
  | "downloading"
  | "downloaded"
  | "expired"
  | "deleted";

export type ShareRoomR2Object = {
  objectKey: string;
  imageId: string;
  name: string;
  type: string;
  size: number;
  uploadedBySessionId: string;
  downloadedBySessionId?: string;
  status: ShareRoomR2ObjectStatus;
  uploadedAt: number;
  sharedAt?: number;
  downloadingAt?: number;
  downloadedAt?: number;
  expiresAt: number;
  expiredAt?: number;
  deletedAt?: number;
};

export type ShareRoomState = {
  roomId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: "waiting";
  members?: ShareRoomMember[];
  hadParticipant?: boolean;
  hadOwner?: boolean;
  ownerTemporarilyAway?: boolean;
  signal?: ShareRoomSignal;
  r2Objects?: ShareRoomR2Object[];

  // Legacy V1 fields are migrated into members on first access.
  ownerSessionId?: string;
  guestSessionId?: string;
  ownerClientId?: string;
  guestClientId?: string;
  ownerReady?: boolean;
  guestReady?: boolean;
  ownerLastSeen?: number;
  guestLastSeen?: number;
};

function normalizeMembers(room: ShareRoomState) {
  if (!room.members) {
    room.members = [];
  }
  if (!room.members.length) {
    if (room.ownerSessionId) {
      room.members.push({
        clientId: room.ownerClientId || crypto.randomUUID().replace(/-/g, ""),
        sessionId: room.ownerSessionId,
        role: "owner",
        ready: Boolean(room.ownerReady),
        lastSeen: room.ownerLastSeen || 0,
        status: "online",
      });
      room.hadOwner = true;
    }
    if (room.guestSessionId) {
      room.members.push({
        clientId: room.guestClientId || crypto.randomUUID().replace(/-/g, ""),
        sessionId: room.guestSessionId,
        role: "guest",
        ready: Boolean(room.guestReady),
        lastSeen: room.guestLastSeen || 0,
        status: "online",
      });
    }
  }

  delete room.ownerSessionId;
  delete room.guestSessionId;
  delete room.ownerClientId;
  delete room.guestClientId;
  delete room.ownerReady;
  delete room.guestReady;
  delete room.ownerLastSeen;
  delete room.guestLastSeen;
  return room.members;
}

function pruneStaleMembers(room: ShareRoomState, now = Date.now()) {
  const members = normalizeMembers(room);
  let changed = false;
  for (const member of members) {
    const timedOut =
      member.status === "online" &&
      now - member.lastSeen > SHARE_ROOM_PRESENCE_TIMEOUT_MS;
    if (timedOut) {
      member.status = "offline";
      member.ready = false;
      member.leftAt = now;
      changed = true;
    }
  }
  if (changed) {
    delete room.signal;
  }
  return { changed };
}

function onlineMembers(room: ShareRoomState) {
  return normalizeMembers(room).filter((member) => member.status === "online");
}

function extendRoomExpiry(room: ShareRoomState, now = Date.now()) {
  room.expiresAt = new Date(now + SHARE_ROOM_TTL_MS).toISOString();
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

export class ShareRoomObject {
  private readonly socketPresencePersistedAt = new Map<string, number>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: { SHARE_IMAGES_R2: R2Bucket },
  ) {}

  private socketSessionTag(sessionId: string) {
    return `session:${sessionId}`;
  }

  private socketStateMessage() {
    const sessions = new Set(
      this.state.getWebSockets().map((socket) => {
        const attachment = socket.deserializeAttachment() as
          | { sessionId?: string }
          | null;
        return attachment?.sessionId || "";
      }),
    );
    sessions.delete("");
    const ready = sessions.size >= 2;
    return JSON.stringify({ type: "SOCKET_STATE", ready });
  }

  private broadcastSocketState() {
    const message = this.socketStateMessage();
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // The close callback removes stale sockets from the active set.
      }
    }
  }

  private closeSessionSockets(sessionId: string, eventType?: string) {
    for (const socket of this.state.getWebSockets(this.socketSessionTag(sessionId))) {
      try {
        if (eventType) socket.send(JSON.stringify({ type: eventType }));
        socket.close(1000, eventType || "Room session ended");
      } catch {
        // Socket is already closed.
      }
    }
  }

  private closeAllSockets(eventType: string) {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(JSON.stringify({ type: eventType }));
        socket.close(1000, eventType);
      } catch {
        // Socket is already closed.
      }
    }
  }

  private notifySockets(eventType: string) {
    const message = JSON.stringify({ type: eventType });
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Socket is already closed.
      }
    }
  }

  private async destroy(room?: ShareRoomState) {
    this.closeAllSockets("ROOM_CLOSED");
    const currentRoom =
      room || (await this.state.storage.get<ShareRoomState>("room"));
    const objectKeys = (currentRoom?.r2Objects || [])
      .filter((object) => object.status !== "deleted")
      .map((object) => object.objectKey);
    if (objectKeys.length) {
      await this.env.SHARE_IMAGES_R2.delete(objectKeys).catch(() => undefined);
    }
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }

  private async expireR2Objects(room: ShareRoomState, now = Date.now()) {
    let changed = false;
    for (const object of room.r2Objects || []) {
      if (object.status === "deleted" || object.expiresAt > now) continue;
      object.status = "expired";
      object.expiredAt ||= now;
      changed = true;
      try {
        await this.env.SHARE_IMAGES_R2.delete(object.objectKey);
        object.status = "deleted";
        object.deletedAt = Date.now();
      } catch {
        // Keep the expired state so the next alarm retries deletion.
      }
    }
    return changed;
  }

  private async persistAndSchedule(room: ShareRoomState) {
    const now = Date.now();
    const members = normalizeMembers(room);
    const activeMembers = onlineMembers(room);
    const offlineOwner = members.find(
      (member) => member.role === "owner" && member.status === "offline",
    );
    const ownerRecoveryDeadline =
      room.hadOwner && offlineOwner && !room.ownerTemporarilyAway
        ? (offlineOwner.leftAt || offlineOwner.lastSeen) +
          SHARE_ROOM_RECOVERY_GRACE_MS
        : null;
    if (ownerRecoveryDeadline !== null && ownerRecoveryDeadline <= now) {
      await this.destroy(room);
      return false;
    }

    await this.state.storage.put("room", room);
    const deadlines = [
      Date.parse(room.expiresAt),
      ...activeMembers.map(
        (member) =>
          member.lastSeen + SHARE_ROOM_PRESENCE_TIMEOUT_MS + 1,
      ),
      ...(ownerRecoveryDeadline === null ? [] : [ownerRecoveryDeadline]),
      ...(room.r2Objects || [])
        .filter((object) => object.status !== "deleted")
        .map((object) =>
          object.status === "expired"
            ? Date.now() + 60_000
            : object.expiresAt,
        ),
    ];
    await this.state.storage.setAlarm(Math.min(...deadlines));
    return true;
  }

  async fetch(request: Request) {
    const { pathname } = new URL(request.url);

    if (
      request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
      pathname === "/socket"
    ) {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const sessionId = new URL(request.url).searchParams.get("sessionId") || "";
      const member = room
        ? normalizeMembers(room).find(
            (candidate) =>
              candidate.sessionId === sessionId && candidate.status === "online",
          )
        : null;
      if (!room || !member) {
        return json({ error: "Invalid room WebSocket session" }, { status: 403 });
      }

      this.closeSessionSockets(sessionId);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server, [this.socketSessionTag(sessionId)]);
      server.serializeAttachment({ sessionId });
      const now = Date.now();
      member.lastSeen = now;
      extendRoomExpiry(room, now);
      this.socketPresencePersistedAt.set(sessionId, now);
      await this.persistAndSchedule(room);
      this.broadcastSocketState();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && pathname === "/initialize") {
      const existing = await this.state.storage.get<ShareRoomState>("room");
      if (existing) {
        return json({ error: "Room already exists" }, { status: 409 });
      }

      const room = (await request.json()) as ShareRoomState;
      if (
        !room.roomId ||
        !room.ownerTokenHash ||
        !room.createdAt ||
        !room.expiresAt
      ) {
        return json({ error: "Invalid room metadata" }, { status: 400 });
      }
      room.members = [];
      await this.state.storage.put("room", room);
      await this.state.storage.setAlarm(Date.parse(room.expiresAt));
      return json(room, { status: 201 });
    }

    if (request.method === "GET" && pathname === "/state") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      if (!room || Date.parse(room.expiresAt) <= Date.now()) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      const presence = pruneStaleMembers(room);
      const r2Changed = await this.expireR2Objects(room);
      if (presence.changed) {
        this.notifySockets("PEER_UNAVAILABLE");
      }
      if (presence.changed || r2Changed) {
        const retained = await this.persistAndSchedule(room);
        if (!retained) {
          return json({ error: "Room not found" }, { status: 404 });
        }
      }
      return json(room);
    }

    if (request.method === "POST" && pathname === "/join") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      if (!room || Date.parse(room.expiresAt) <= Date.now()) {
        return json({ error: "Room not found" }, { status: 404 });
      }

      const body = (await request.json()) as {
        role?: ShareRoomRole;
        sessionId?: string;
        clientId?: string;
      };
      if (
        !body.sessionId ||
        !body.clientId ||
        !/^[a-f0-9]{32}$/.test(body.clientId) ||
        (body.role !== "owner" && body.role !== "guest")
      ) {
        return json({ error: "Invalid join request" }, { status: 400 });
      }

      pruneStaleMembers(room);
      const members = normalizeMembers(room);
      const blockedMember = members.find(
        (member) =>
          member.role === body.role &&
          member.clientId === body.clientId &&
          member.status === "kicked",
      );
      if (blockedMember) {
        return json({ error: "You were removed from this room" }, { status: 403 });
      }
      if (
        body.role === "guest" &&
        members.some(
          (member) =>
            member.role === "guest" &&
            member.status === "online" &&
            member.clientId !== body.clientId,
        )
      ) {
        return json({ error: "Room already has a guest" }, { status: 409 });
      }

      const now = Date.now();
      const existingMember = members.find(
        (member) =>
          member.role === body.role && member.clientId === body.clientId,
      );
      if (existingMember) {
        existingMember.sessionId = body.sessionId;
        existingMember.ready = true;
        existingMember.lastSeen = now;
        existingMember.status = "online";
        delete existingMember.leftAt;
      } else {
        members.push({
          clientId: body.clientId,
          sessionId: body.sessionId,
          role: body.role,
          ready: true,
          lastSeen: now,
          status: "online",
        });
      }
      room.hadParticipant = true;
      if (body.role === "owner") {
        room.hadOwner = true;
        room.ownerTemporarilyAway = false;
      }
      extendRoomExpiry(room, now);
      delete room.signal;
      await this.persistAndSchedule(room);
      return json(room);
    }

    if (request.method === "POST" && pathname === "/signal") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        sessionId?: string;
        description?: RTCSessionDescriptionInit;
      };
      if (!room || !body.sessionId || !body.description?.sdp) {
        return json({ error: "Invalid signaling request" }, { status: 400 });
      }
      if (body.description.sdp.length > 1024 * 1024) {
        return json({ error: "Session description is too large" }, { status: 413 });
      }
      const members = normalizeMembers(room);
      const sender = members.find(
        (member) =>
          member.sessionId === body.sessionId && member.status === "online",
      );
      const owner = members.find(
        (member) => member.role === "owner" && member.status === "online",
      );
      const guest = members.find(
        (member) => member.role === "guest" && member.status === "online",
      );
      if (!sender || !owner || !guest) {
        return json({ error: "Peer is not available" }, { status: 409 });
      }
      if (sender.role === "owner" && body.description.type === "offer") {
        room.signal = {
          ownerSessionId: owner.sessionId,
          guestSessionId: guest.sessionId,
          offer: body.description,
          ownerCandidates: [],
          guestCandidates: [],
        };
      } else if (
        sender.role === "guest" &&
        body.description.type === "answer" &&
        room.signal?.ownerSessionId === owner.sessionId &&
        room.signal.guestSessionId === guest.sessionId &&
        room.signal.offer
      ) {
        room.signal.answer = body.description;
      } else {
        return json({ error: "Unexpected session description" }, { status: 409 });
      }
      const now = Date.now();
      sender.lastSeen = now;
      extendRoomExpiry(room, now);
      await this.persistAndSchedule(room);
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname === "/candidate") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        sessionId?: string;
        candidate?: RTCIceCandidateInit;
      };
      if (
        !room ||
        !body.sessionId ||
        typeof body.candidate?.candidate !== "string" ||
        body.candidate.candidate.length > 4096
      ) {
        return json({ error: "Invalid ICE candidate" }, { status: 400 });
      }
      const members = normalizeMembers(room);
      const sender = members.find(
        (member) =>
          member.sessionId === body.sessionId && member.status === "online",
      );
      const owner = members.find(
        (member) => member.role === "owner" && member.status === "online",
      );
      const guest = members.find(
        (member) => member.role === "guest" && member.status === "online",
      );
      if (
        !sender ||
        !owner ||
        !guest ||
        room.signal?.ownerSessionId !== owner.sessionId ||
        room.signal.guestSessionId !== guest.sessionId
      ) {
        return json({ error: "Signaling session is not ready" }, { status: 409 });
      }
      const candidates =
        sender.role === "owner"
          ? (room.signal.ownerCandidates ||= [])
          : (room.signal.guestCandidates ||= []);
      if (
        candidates.length < 64 &&
        !candidates.some(
          (candidate) => candidate.candidate === body.candidate?.candidate,
        )
      ) {
        candidates.push(body.candidate);
      }
      const now = Date.now();
      sender.lastSeen = now;
      extendRoomExpiry(room, now);
      await this.persistAndSchedule(room);
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname === "/ready") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        role?: ShareRoomRole;
        sessionId?: string;
      };
      if (!room) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      const member = normalizeMembers(room).find(
        (candidate) =>
          candidate.role === body.role && candidate.sessionId === body.sessionId,
      );
      if (!member) {
        return json({ error: "Session not found" }, { status: 404 });
      }
      if (member.status === "kicked") {
        return json({ error: "Room access was revoked" }, { status: 403 });
      }
      const now = Date.now();
      member.ready = true;
      member.lastSeen = now;
      member.status = "online";
      delete member.leftAt;
      extendRoomExpiry(room, now);
      await this.persistAndSchedule(room);
      return json(room);
    }

    if (request.method === "POST" && pathname === "/heartbeat") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        role?: ShareRoomRole;
        sessionId?: string;
      };
      if (!room) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      const member = normalizeMembers(room).find(
        (candidate) =>
          candidate.role === body.role && candidate.sessionId === body.sessionId,
      );
      if (!member) {
        return json({ error: "Session not found" }, { status: 404 });
      }
      if (member.status === "kicked") {
        return json({ error: "Room access was revoked" }, { status: 403 });
      }
      const now = Date.now();
      member.lastSeen = now;
      member.status = "online";
      member.ready = true;
      delete member.leftAt;
      extendRoomExpiry(room, now);
      await this.persistAndSchedule(room);
      return json(room);
    }

    if (request.method === "POST" && pathname === "/leave") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as { sessionId?: string };
      if (!room || !body.sessionId) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      const members = normalizeMembers(room);
      const leavingMember = members.find(
        (member) => member.sessionId === body.sessionId,
      );
      if (!leavingMember) {
        return json({ ok: true });
      }
      leavingMember.status = "offline";
      leavingMember.ready = false;
      leavingMember.leftAt = Date.now();
      this.closeSessionSockets(leavingMember.sessionId);
      this.notifySockets("PEER_UNAVAILABLE");
      delete room.signal;
      const retained = await this.persistAndSchedule(room);
      return json({ ok: true, roomRetained: retained });
    }

    if (request.method === "POST" && pathname === "/r2-uploaded") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as Partial<ShareRoomR2Object> & {
        sessionId?: string;
      };
      const member = room
        ? normalizeMembers(room).find(
            (candidate) =>
              candidate.sessionId === body.sessionId &&
              candidate.status === "online",
          )
        : null;
      if (
        !room ||
        !member ||
        typeof body.objectKey !== "string" ||
        typeof body.imageId !== "string" ||
        !/^[a-f0-9]{32}$/.test(body.imageId) ||
        !body.objectKey.startsWith(`${room.roomId}/${body.imageId}/`) ||
        typeof body.name !== "string" ||
        body.name.length < 1 ||
        body.name.length > 255 ||
        typeof body.type !== "string" ||
        !body.type.startsWith("image/") ||
        typeof body.size !== "number" ||
        !Number.isSafeInteger(body.size) ||
        body.size < 0 ||
        typeof body.expiresAt !== "number" ||
        !Number.isSafeInteger(body.expiresAt) ||
        body.expiresAt <= Date.now() ||
        body.expiresAt > Date.parse(room.expiresAt)
      ) {
        return json({ error: "Invalid uploaded object metadata" }, { status: 400 });
      }
      const objects = (room.r2Objects ||= []);
      const existing = objects.find(
        (object) => object.objectKey === body.objectKey,
      );
      if (existing) return json(existing);
      if (
        objects.filter((object) => object.status !== "deleted").length >=
        MAX_ACTIVE_R2_OBJECTS_PER_ROOM
      ) {
        return json({ error: "Room R2 object limit reached" }, { status: 429 });
      }
      const uploaded: ShareRoomR2Object = {
        objectKey: body.objectKey,
        imageId: body.imageId,
        name: body.name,
        type: body.type,
        size: Number(body.size),
        uploadedBySessionId: member.sessionId,
        status: "uploaded",
        uploadedAt: Date.now(),
        expiresAt: Number(body.expiresAt),
      };
      objects.push(uploaded);
      await this.persistAndSchedule(room);
      return json(uploaded);
    }

    if (request.method === "POST" && pathname === "/r2-shared") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        sessionId?: string;
        objectKey?: string;
      };
      const object = room?.r2Objects?.find(
        (candidate) => candidate.objectKey === body.objectKey,
      );
      if (
        !room ||
        !object ||
        object.uploadedBySessionId !== body.sessionId ||
        object.status !== "uploaded"
      ) {
        return json({ error: "Uploaded object is not shareable" }, { status: 409 });
      }
      object.status = "shared";
      object.sharedAt = Date.now();
      await this.persistAndSchedule(room);
      return json(object);
    }

    if (request.method === "POST" && pathname === "/r2-downloading") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        sessionId?: string;
        objectKey?: string;
      };
      const member = room
        ? normalizeMembers(room).find(
            (candidate) =>
              candidate.sessionId === body.sessionId &&
              candidate.status === "online",
          )
        : null;
      const object = room?.r2Objects?.find(
        (candidate) => candidate.objectKey === body.objectKey,
      );
      if (
        !room ||
        !member ||
        !object ||
        object.uploadedBySessionId === member.sessionId ||
        (object.status !== "shared" && object.status !== "downloading") ||
        object.expiresAt <= Date.now()
      ) {
        return json({ error: "Shared object is not downloadable" }, { status: 409 });
      }
      object.status = "downloading";
      object.downloadedBySessionId = member.sessionId;
      object.downloadingAt = Date.now();
      await this.persistAndSchedule(room);
      return json(object);
    }

    if (request.method === "POST" && pathname === "/r2-downloaded") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        sessionId?: string;
        objectKey?: string;
      };
      const object = room?.r2Objects?.find(
        (candidate) => candidate.objectKey === body.objectKey,
      );
      if (
        !room ||
        !object ||
        object.downloadedBySessionId !== body.sessionId ||
        (object.status !== "downloading" && object.status !== "downloaded")
      ) {
        return json({ error: "Object download is not active" }, { status: 409 });
      }
      if (object.status === "downloaded") return json(object);
      object.status = "downloaded";
      object.downloadedAt = Date.now();
      await this.persistAndSchedule(room);
      return json(object);
    }

    if (request.method === "POST" && pathname === "/kick") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        ownerSessionId?: string;
        targetClientId?: string;
      };
      if (!room || !body.ownerSessionId || !body.targetClientId) {
        return json({ error: "Invalid kick request" }, { status: 400 });
      }
      const members = normalizeMembers(room);
      const owner = members.find(
        (member) =>
          member.role === "owner" &&
          member.sessionId === body.ownerSessionId &&
          member.status === "online",
      );
      if (!owner) {
        return json({ error: "Only the Owner can remove members" }, { status: 403 });
      }
      const target = members.find(
        (member) =>
          member.role === "guest" && member.clientId === body.targetClientId,
      );
      if (!target) {
        return json({ error: "Guest not found" }, { status: 404 });
      }
      target.status = "kicked";
      target.ready = false;
      target.lastSeen = Date.now();
      target.leftAt = Date.now();
      this.closeSessionSockets(target.sessionId, "ROOM_KICKED");
      this.notifySockets("PEER_UNAVAILABLE");
      delete room.signal;
      await this.persistAndSchedule(room);
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname === "/temporary-away") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as { sessionId?: string };
      if (!room || !body.sessionId) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      const members = normalizeMembers(room);
      const owner = members.find(
        (member) =>
          member.role === "owner" && member.sessionId === body.sessionId,
      );
      if (!owner) {
        return json({ error: "Owner session not found" }, { status: 403 });
      }
      owner.status = "offline";
      owner.ready = false;
      owner.leftAt = Date.now();
      room.hadOwner = true;
      room.ownerTemporarilyAway = true;
      delete room.signal;
      await this.persistAndSchedule(room);
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname === "/close") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as { sessionId?: string };
      const owner = room
        ? normalizeMembers(room).find(
            (member) =>
              member.role === "owner" && member.sessionId === body.sessionId,
          )
        : null;
      if (!room || !owner) {
        return json({ error: "Only the Owner can close the room" }, { status: 403 });
      }
      await this.destroy();
      return json({ ok: true });
    }

    return json({ error: "Not found" }, { status: 404 });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > MAX_RELAY_MESSAGE_BYTES) {
      socket.close(1009, "Relay message is too large or not text");
      return;
    }
    let relay: { type?: unknown; channel?: unknown; payload?: unknown };
    try {
      relay = JSON.parse(message) as typeof relay;
    } catch {
      return;
    }
    if (
      relay.type !== "RELAY" ||
      (relay.channel !== "control" &&
        relay.channel !== "instruction" &&
        relay.channel !== "thumbnail") ||
      typeof relay.payload !== "string"
    ) {
      return;
    }
    for (const peer of this.state.getWebSockets()) {
      if (peer === socket) continue;
      const senderSession = (
        socket.deserializeAttachment() as { sessionId?: string } | null
      )?.sessionId;
      const peerSession = (
        peer.deserializeAttachment() as { sessionId?: string } | null
      )?.sessionId;
      if (!senderSession || !peerSession || senderSession === peerSession) continue;
      try {
        peer.send(message);
      } catch {
        // The peer will fall back to its DataChannel until Socket reconnects.
      }
    }
    await this.touchSocketPresence(socket);
  }

  private async touchSocketPresence(socket: WebSocket) {
    const sessionId = (
      socket.deserializeAttachment() as { sessionId?: string } | null
    )?.sessionId;
    if (!sessionId) return;
    const now = Date.now();
    if (now - (this.socketPresencePersistedAt.get(sessionId) || 0) < 15_000) {
      return;
    }
    const room = await this.state.storage.get<ShareRoomState>("room");
    const member = room
      ? normalizeMembers(room).find(
          (candidate) =>
            candidate.sessionId === sessionId && candidate.status !== "kicked",
        )
      : null;
    if (!room || !member || Date.parse(room.expiresAt) <= now) return;
    member.lastSeen = now;
    member.status = "online";
    member.ready = true;
    delete member.leftAt;
    extendRoomExpiry(room, now);
    this.socketPresencePersistedAt.set(sessionId, now);
    await this.persistAndSchedule(room);
  }

  async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    const sessionId = (
      socket.deserializeAttachment() as { sessionId?: string } | null
    )?.sessionId;
    if (sessionId) this.socketPresencePersistedAt.delete(sessionId);
    this.broadcastSocketState();
  }

  async alarm() {
    const room = await this.state.storage.get<ShareRoomState>("room");
    if (!room || Date.parse(room.expiresAt) <= Date.now()) {
      await this.destroy();
      return;
    }
    const presence = pruneStaleMembers(room);
    await this.expireR2Objects(room);
    if (presence.changed) this.notifySockets("PEER_UNAVAILABLE");
    await this.persistAndSchedule(room);
  }
}
