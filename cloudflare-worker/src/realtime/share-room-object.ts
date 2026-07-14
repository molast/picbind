export const SHARE_ROOM_TTL_MS = 30 * 60 * 1000;

export type ShareRoomState = {
  roomId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: "waiting";
  ownerSessionId?: string;
  guestSessionId?: string;
};

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
      };
      if (!body.sessionId || (body.role !== "owner" && body.role !== "guest")) {
        return json({ error: "Invalid join request" }, { status: 400 });
      }
      if (body.role === "guest" && room.guestSessionId) {
        return json({ error: "Room already has a guest" }, { status: 409 });
      }

      if (body.role === "owner") room.ownerSessionId = body.sessionId;
      else room.guestSessionId = body.sessionId;
      await this.state.storage.put("room", room);
      return json(room);
    }

    return json({ error: "Not found" }, { status: 404 });
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}
