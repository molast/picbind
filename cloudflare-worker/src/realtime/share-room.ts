import {
  SHARE_ROOM_TTL_MS,
  type ShareRoomMember,
  type ShareRoomState,
} from "./share-room-object";

export type RealtimeRoomEnv = {
  REALTIME_ROOMS: DurableObjectNamespace;
  TURN_TOKEN_ID?: string;
  TURN_API_TOKEN?: string;
  SITE_URL?: string;
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

function randomBase64Url(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function siteUrl(env: RealtimeRoomEnv, request: Request) {
  const configured = (env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  return (
    request.headers.get("origin")?.replace(/\/+$/, "") ||
    new URL(request.url).origin
  );
}

async function readJson<T>(response: Response | Request, label: string) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} is not valid JSON: ${raw.slice(0, 240)}`);
  }
}

async function roomState(env: RealtimeRoomEnv, roomId: string) {
  const object = env.REALTIME_ROOMS.get(env.REALTIME_ROOMS.idFromName(roomId));
  const response = await object.fetch("https://share-room/state");
  if (!response.ok) return null;
  return readJson<ShareRoomState>(response, `Share room state (${response.status})`);
}

async function generateTurnIceServers(env: RealtimeRoomEnv) {
  if (!env.TURN_TOKEN_ID?.trim() || !env.TURN_API_TOKEN?.trim()) {
    throw new Error("Cloudflare TURN is not configured");
  }
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_TOKEN_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TURN_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl: 3600 }),
    },
  );
  const result = await readJson<{ iceServers?: RTCIceServer[]; error?: string }>(
    response,
    `Cloudflare TURN credentials (${response.status})`,
  );
  if (!response.ok || !Array.isArray(result.iceServers)) {
    throw new Error(result.error || "Could not generate TURN credentials");
  }
  return result.iceServers;
}

function validRoomId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12}$/.test(value);
}

async function requireRoom(env: RealtimeRoomEnv, roomId: unknown) {
  if (!validRoomId(roomId)) throw new Error("Invalid room ID");
  const room = await roomState(env, roomId);
  if (!room || Date.parse(room.expiresAt) <= Date.now()) {
    throw new Error("Room not found or expired");
  }
  return room;
}

function roomMembers(room: ShareRoomState) {
  return room.members || [];
}

function memberForSession(room: ShareRoomState, sessionId: string) {
  return roomMembers(room).find(
    (member) => member.sessionId === sessionId && member.status === "online",
  );
}

function readyMember(room: ShareRoomState, role: ShareRoomMember["role"]) {
  return roomMembers(room).find(
    (member) =>
      member.role === role && member.status === "online" && member.ready,
  );
}

export async function handleShareRoomRealtime(
  request: Request,
  env: RealtimeRoomEnv,
) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  let stage = "read-request";
  try {
    const body = await readJson<Record<string, unknown>>(request, "Realtime request body");
    stage = "load-room";
    const room = await requireRoom(env, body.roomId);
    const action = new URL(request.url).pathname.split("/").pop();

    if (action === "status") {
      const owner = readyMember(room, "owner");
      const guest = readyMember(room, "guest");
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const requester = memberForSession(room, sessionId);
      return json({
        members: roomMembers(room).map(({ clientId, role, status, leftAt }) => ({
          clientId,
          role,
          status,
          leftAt,
        })),
        ownerKnown: roomMembers(room).some((member) => member.role === "owner"),
        guestKnown: roomMembers(room).some((member) => member.role === "guest"),
        ownerJoined: Boolean(owner),
        guestJoined: Boolean(guest),
        ownerSessionId: requester ? owner?.sessionId : undefined,
        guestSessionId: requester ? guest?.sessionId : undefined,
        signal: requester ? room.signal : undefined,
      });
    }

    if (action === "join") {
      stage = "create-session";
      const ownerToken = typeof body.ownerToken === "string" ? body.ownerToken : "";
      const clientId = typeof body.clientId === "string" ? body.clientId : "";
      if (!/^[a-f0-9]{32}$/.test(clientId)) {
        throw new Error("Invalid room client ID");
      }
      const isOwner = ownerToken && (await hashToken(ownerToken)) === room.ownerTokenHash;
      const role = isOwner ? "owner" : "guest";
      if (
        role === "guest" &&
        roomMembers(room).some(
          (member) =>
            member.role === "guest" &&
            member.status === "online" &&
            member.clientId !== clientId,
        )
      ) {
        return json({ error: "Room already has a guest" }, { status: 409 });
      }
      const sessionId = randomBase64Url(24);
      const object = env.REALTIME_ROOMS.get(env.REALTIME_ROOMS.idFromName(room.roomId));
      stage = "claim-room";
      const claimed = await object.fetch("https://share-room/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, sessionId, clientId }),
      });
      const updated = await readJson<ShareRoomState | { error?: string }>(claimed, "Share room join response");
      if (!claimed.ok) throw new Error((updated as { error?: string }).error || "Could not join room");
      const updatedRoom = updated as ShareRoomState;
      const peer = readyMember(updatedRoom, role === "owner" ? "guest" : "owner");
      return json({
        role,
        sessionId,
        peerSessionId: peer?.sessionId,
      });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const member = memberForSession(room, sessionId);
    if (!member) return json({ error: "Invalid room session" }, { status: 403 });
    const isOwnerSession = member.role === "owner";

    if (action === "ice-servers") {
      stage = "generate-turn-credentials";
      return json({ iceServers: await generateTurnIceServers(env) });
    }

    if (action === "signal") {
      const description = body.description as RTCSessionDescriptionInit | undefined;
      if (!description?.sdp || !["offer", "answer"].includes(description.type)) {
        return json({ error: "Invalid session description" }, { status: 400 });
      }
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, description }),
      });
      const result = await readJson<{ ok?: boolean; error?: string }>(
        response,
        `Share room signal (${response.status})`,
      );
      return response.ok
        ? json({ ok: true })
        : json({ error: result.error || "Signaling failed" }, { status: response.status });
    }

    if (action === "heartbeat") {
      stage = "heartbeat";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const heartbeat = await object.fetch("https://share-room/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: isOwnerSession ? "owner" : "guest",
          sessionId,
        }),
      });
      if (!heartbeat.ok) {
        throw new Error("Room heartbeat was rejected");
      }
      return json({ ok: true });
    }

    if (action === "temporary-away") {
      if (!isOwnerSession) {
        return json({ error: "Only the Owner can leave temporarily" }, { status: 403 });
      }
      stage = "temporary-away";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/temporary-away", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error("Could not leave the room temporarily");
      }
      return json({ ok: true });
    }

    if (action === "leave") {
      if (isOwnerSession) {
        return json(
          { error: "The Owner must temporarily leave or close the room" },
          { status: 400 },
        );
      }
      stage = "leave-room";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error("Could not leave the room");
      }
      return json({ ok: true });
    }

    if (action === "close") {
      if (!isOwnerSession) {
        return json({ error: "Only the Owner can close the room" }, { status: 403 });
      }
      stage = "close-room";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        throw new Error("Could not close the room");
      }
      return json({ ok: true });
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Realtime request failed";
    console.error("Share room realtime request failed", { stage, message });
    const status = /not found|expired/i.test(message) ? 404 : 400;
    return json({ error: message, stage }, { status });
  }
}

export async function handleCreateShareRoom(
  request: Request,
  env: RealtimeRoomEnv,
) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!env.TURN_TOKEN_ID?.trim() || !env.TURN_API_TOKEN?.trim()) {
    return json(
      { error: "Cloudflare TURN is not configured" },
      { status: 503 },
    );
  }

  const roomId = randomBase64Url(9);
  const ownerToken = randomBase64Url(24);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SHARE_ROOM_TTL_MS);
  const room: ShareRoomState = {
    roomId,
    ownerTokenHash: await hashToken(ownerToken),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "waiting",
  };

  const roomObject = env.REALTIME_ROOMS.get(
    env.REALTIME_ROOMS.idFromName(roomId),
  );
  const initialized = await roomObject.fetch("https://share-room/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(room),
  });
  if (!initialized.ok) {
    console.error("Failed to initialize share room", await initialized.text());
    return json({ error: "Failed to create room" }, { status: 500 });
  }

  return json(
    {
      roomId,
      ownerToken,
      shareUrl: `${siteUrl(env, request)}/share?roomId=${encodeURIComponent(roomId)}`,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
    },
    { status: 201 },
  );
}
