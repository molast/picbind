export const SHARE_ROOM_TTL_MS = 30 * 60 * 1000;
export const SHARE_ROOM_PRESENCE_TIMEOUT_MS = 90 * 1000;

export type ShareRoomRole = "owner" | "guest";

export type ShareRoomMember = {
  clientId: string;
  sessionId: string;
  role: ShareRoomRole;
  ready: boolean;
  lastSeen: number;
  status: "online" | "offline";
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
  let ownerTimedOut = false;
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
      if (member.role === "owner") {
        ownerTimedOut = true;
      }
    }
  }
  if (changed) {
    delete room.signal;
  }
  return { changed, ownerTimedOut };
}

function onlineMembers(room: ShareRoomState) {
  return normalizeMembers(room).filter((member) => member.status === "online");
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
  constructor(private readonly state: DurableObjectState) {}

  private async destroy() {
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }

  private async persistAndSchedule(room: ShareRoomState) {
    const activeMembers = onlineMembers(room);
    const hasOwner = activeMembers.some((member) => member.role === "owner");
    const ownerLeftPermanently =
      room.hadOwner && !hasOwner && !room.ownerTemporarilyAway;
    const roomBecameEmpty =
      room.hadParticipant &&
      activeMembers.length === 0 &&
      !room.ownerTemporarilyAway;
    if (ownerLeftPermanently || roomBecameEmpty) {
      await this.destroy();
      return false;
    }

    await this.state.storage.put("room", room);
    const deadlines = [
      Date.parse(room.expiresAt),
      ...activeMembers.map(
        (member) =>
          member.lastSeen + SHARE_ROOM_PRESENCE_TIMEOUT_MS + 1,
      ),
    ];
    await this.state.storage.setAlarm(Math.min(...deadlines));
    return true;
  }

  async fetch(request: Request) {
    const { pathname } = new URL(request.url);

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
      if (presence.ownerTimedOut && !room.ownerTemporarilyAway) {
        await this.destroy();
        return json({ error: "Room not found" }, { status: 404 });
      }
      if (presence.changed) {
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

      const presence = pruneStaleMembers(room);
      if (
        presence.ownerTimedOut &&
        room.hadOwner &&
        !room.ownerTemporarilyAway
      ) {
        await this.destroy();
        return json({ error: "Room not found" }, { status: 404 });
      }

      const members = normalizeMembers(room);
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
      sender.lastSeen = Date.now();
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
      sender.lastSeen = Date.now();
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
      member.ready = true;
      member.lastSeen = Date.now();
      member.status = "online";
      delete member.leftAt;
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
      member.lastSeen = Date.now();
      member.status = "online";
      delete member.leftAt;
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
      delete room.signal;
      const retained = await this.persistAndSchedule(room);
      return json({ ok: true, roomRetained: retained });
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

  async alarm() {
    const room = await this.state.storage.get<ShareRoomState>("room");
    if (!room || Date.parse(room.expiresAt) <= Date.now()) {
      await this.destroy();
      return;
    }
    const presence = pruneStaleMembers(room);
    if (presence.ownerTimedOut && !room.ownerTemporarilyAway) {
      await this.destroy();
      return;
    }
    await this.persistAndSchedule(room);
  }
}
