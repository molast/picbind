export const SHARE_ROOM_TTL_MS = 30 * 60 * 1000;
export const SHARE_ROOM_PRESENCE_TIMEOUT_MS = 90 * 1000;

export type ShareRoomState = {
  roomId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: "waiting";
  ownerSessionId?: string;
  guestSessionId?: string;
  ownerClientId?: string;
  guestClientId?: string;
  ownerReady?: boolean;
  guestReady?: boolean;
  ownerLastSeen?: number;
  guestLastSeen?: number;
  hadParticipant?: boolean;
  hadOwner?: boolean;
  ownerTemporarilyAway?: boolean;
};

function clearOwner(room: ShareRoomState) {
  delete room.ownerSessionId;
  delete room.ownerClientId;
  delete room.ownerReady;
  delete room.ownerLastSeen;
}

function clearGuest(room: ShareRoomState) {
  delete room.guestSessionId;
  delete room.guestClientId;
  delete room.guestReady;
  delete room.guestLastSeen;
}

function pruneStalePresence(room: ShareRoomState, now = Date.now()) {
  let changed = false;
  let ownerTimedOut = false;
  if (
    room.ownerSessionId &&
    (!room.ownerLastSeen ||
      now - room.ownerLastSeen > SHARE_ROOM_PRESENCE_TIMEOUT_MS)
  ) {
    clearOwner(room);
    changed = true;
    ownerTimedOut = true;
  }
  if (
    room.guestSessionId &&
    (!room.guestLastSeen ||
      now - room.guestLastSeen > SHARE_ROOM_PRESENCE_TIMEOUT_MS)
  ) {
    clearGuest(room);
    changed = true;
  }
  return { changed, ownerTimedOut };
}

function hasParticipants(room: ShareRoomState) {
  return Boolean(room.ownerSessionId || room.guestSessionId);
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

  private async persistAndSchedule(room: ShareRoomState) {
    const ownerLeftPermanently =
      room.hadOwner &&
      !room.ownerSessionId &&
      !room.ownerTemporarilyAway;
    if (
      ownerLeftPermanently ||
      (room.hadParticipant &&
        !hasParticipants(room) &&
        !room.ownerTemporarilyAway)
    ) {
      await this.state.storage.deleteAll();
      return false;
    }

    await this.state.storage.put("room", room);
    const deadlines = [Date.parse(room.expiresAt)];
    if (room.ownerLastSeen) {
      deadlines.push(
        room.ownerLastSeen + SHARE_ROOM_PRESENCE_TIMEOUT_MS + 1,
      );
    }
    if (room.guestLastSeen) {
      deadlines.push(
        room.guestLastSeen + SHARE_ROOM_PRESENCE_TIMEOUT_MS + 1,
      );
    }
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

      await this.state.storage.put("room", room);
      await this.state.storage.setAlarm(Date.parse(room.expiresAt));
      return json(room, { status: 201 });
    }

    if (request.method === "GET" && pathname === "/state") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      if (!room || Date.parse(room.expiresAt) <= Date.now()) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      if (pruneStalePresence(room).changed) {
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
        role?: "owner" | "guest";
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
      const presence = pruneStalePresence(room);
      if (
        presence.ownerTimedOut &&
        room.hadOwner &&
        !room.ownerTemporarilyAway
      ) {
        await this.state.storage.deleteAll();
        return json({ error: "Room not found" }, { status: 404 });
      }
      if (
        body.role === "guest" &&
        room.guestSessionId &&
        room.guestClientId !== body.clientId
      ) {
        return json({ error: "Room already has a guest" }, { status: 409 });
      }

      const now = Date.now();
      room.hadParticipant = true;
      if (body.role === "owner") {
        room.hadOwner = true;
        room.ownerTemporarilyAway = false;
        room.ownerSessionId = body.sessionId;
        room.ownerClientId = body.clientId;
        room.ownerReady = false;
        room.ownerLastSeen = now;
      } else {
        room.guestSessionId = body.sessionId;
        room.guestClientId = body.clientId;
        room.guestReady = false;
        room.guestLastSeen = now;
      }
      await this.persistAndSchedule(room);
      return json(room);
    }

    if (request.method === "POST" && pathname === "/temporary-away") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as { sessionId?: string };
      if (!room || !body.sessionId) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      if (room.ownerSessionId !== body.sessionId) {
        return json({ error: "Owner session not found" }, { status: 403 });
      }
      clearOwner(room);
      room.hadOwner = true;
      room.ownerTemporarilyAway = true;
      await this.persistAndSchedule(room);
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname === "/close") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as { sessionId?: string };
      if (!room || !body.sessionId) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      if (room.ownerSessionId !== body.sessionId) {
        return json({ error: "Only the Owner can close the room" }, { status: 403 });
      }
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
      return json({ ok: true });
    }

    if (request.method === "POST" && pathname === "/ready") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as { role?: "owner" | "guest"; sessionId?: string };
      if (!room || !body.sessionId || (body.role !== "owner" && body.role !== "guest")) {
        return json({ error: "Invalid ready request" }, { status: 400 });
      }
      if (body.role === "owner" && room.ownerSessionId === body.sessionId) {
        room.ownerReady = true;
        room.ownerLastSeen = Date.now();
      }
      else if (body.role === "guest" && room.guestSessionId === body.sessionId) {
        room.guestReady = true;
        room.guestLastSeen = Date.now();
      }
      else return json({ error: "Session not found" }, { status: 404 });
      await this.persistAndSchedule(room);
      return json(room);
    }

    if (request.method === "POST" && pathname === "/heartbeat") {
      const room = await this.state.storage.get<ShareRoomState>("room");
      const body = (await request.json()) as {
        role?: "owner" | "guest";
        sessionId?: string;
      };
      if (!room || !body.sessionId) {
        return json({ error: "Room not found" }, { status: 404 });
      }
      if (body.role === "owner" && room.ownerSessionId === body.sessionId) {
        room.ownerLastSeen = Date.now();
      } else if (
        body.role === "guest" &&
        room.guestSessionId === body.sessionId
      ) {
        room.guestLastSeen = Date.now();
      } else {
        return json({ error: "Session not found" }, { status: 404 });
      }
      await this.persistAndSchedule(room);
      return json(room);
    }

    return json({ error: "Not found" }, { status: 404 });
  }

  async alarm() {
    const room = await this.state.storage.get<ShareRoomState>("room");
    if (!room || Date.parse(room.expiresAt) <= Date.now()) {
      await this.state.storage.deleteAll();
      return;
    }
    pruneStalePresence(room);
    await this.persistAndSchedule(room);
  }
}
