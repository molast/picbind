import {
  SHARE_ROOM_TTL_MS,
  type ShareRoomState,
} from "./share-room-object";

export type RealtimeRoomEnv = {
  REALTIME_ROOMS: DurableObjectNamespace;
  REALTIME_APP_ID?: string;
  REALTIME_API_TOKEN?: string;
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

type RealtimeApiResponse = {
  errorCode?: string;
  errorDescription?: string;
  sessionId?: string;
  sessionDescription?: RTCSessionDescriptionInit;
  requiresImmediateRenegotiation?: boolean;
  dataChannels?: Array<{ id?: number; errorCode?: string; errorDescription?: string }>;
};

async function roomState(env: RealtimeRoomEnv, roomId: string) {
  const object = env.REALTIME_ROOMS.get(env.REALTIME_ROOMS.idFromName(roomId));
  const response = await object.fetch("https://share-room/state");
  if (!response.ok) return null;
  return (await response.json()) as ShareRoomState;
}

async function realtimeRequest(
  env: RealtimeRoomEnv,
  path: string,
  method = "POST",
  body?: unknown,
) {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/apps/${env.REALTIME_APP_ID}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${env.REALTIME_API_TOKEN}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const raw = await response.text();
  let result: RealtimeApiResponse = {};
  if (raw) {
    try {
      result = JSON.parse(raw) as RealtimeApiResponse;
    } catch {
      throw new Error(
        `Cloudflare Realtime returned a non-JSON response (${response.status}): ${raw.slice(0, 240)}`,
      );
    }
  }
  if (!response.ok || result.errorCode) {
    throw new Error(
      result.errorDescription || `Cloudflare Realtime request failed (${response.status})`,
    );
  }
  return result;
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

export async function handleShareRoomRealtime(
  request: Request,
  env: RealtimeRoomEnv,
) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  if (!env.REALTIME_APP_ID?.trim() || !env.REALTIME_API_TOKEN?.trim()) {
    return json({ error: "Cloudflare Realtime is not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const room = await requireRoom(env, body.roomId);
    const action = new URL(request.url).pathname.split("/").pop();

    if (action === "status") {
      return json({
        ownerJoined: Boolean(room.ownerSessionId),
        guestJoined: Boolean(room.guestSessionId),
        ownerSessionId: room.ownerSessionId,
        guestSessionId: room.guestSessionId,
      });
    }

    if (action === "join") {
      const ownerToken = typeof body.ownerToken === "string" ? body.ownerToken : "";
      const isOwner = ownerToken && (await hashToken(ownerToken)) === room.ownerTokenHash;
      const role = isOwner ? "owner" : "guest";
      if (role === "guest" && room.guestSessionId) {
        return json({ error: "Room already has a guest" }, { status: 409 });
      }
      const session = await realtimeRequest(env, "/sessions/new");
      if (!session.sessionId) throw new Error("Realtime did not return a session ID");
      const object = env.REALTIME_ROOMS.get(env.REALTIME_ROOMS.idFromName(room.roomId));
      const claimed = await object.fetch("https://share-room/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, sessionId: session.sessionId }),
      });
      if (!claimed.ok) throw new Error((await claimed.json() as { error?: string }).error || "Could not join room");
      const updated = (await claimed.json()) as ShareRoomState;
      return json({
        role,
        sessionId: session.sessionId,
        peerSessionId: role === "owner" ? updated.guestSessionId : updated.ownerSessionId,
      });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const isOwnerSession = room.ownerSessionId === sessionId;
    const isGuestSession = room.guestSessionId === sessionId;
    if (!isOwnerSession && !isGuestSession) return json({ error: "Invalid room session" }, { status: 403 });

    if (action === "transport") {
      const sdp = body.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (!sdp?.sdp || sdp.type !== "offer") throw new Error("Missing SDP offer");
      const result = await realtimeRequest(env, `/sessions/${sessionId}/datachannels/establish`, "POST", {
        dataChannel: { location: "remote", dataChannelName: "picbind-handshake" },
        sessionDescription: sdp,
      });
      return json(result);
    }

    if (action === "renegotiate") {
      const sdp = body.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (!sdp?.sdp || sdp.type !== "answer") throw new Error("Missing SDP answer");
      return json(await realtimeRequest(env, `/sessions/${sessionId}/renegotiate`, "PUT", { sessionDescription: sdp }));
    }

    if (action === "datachannel") {
      const name = typeof body.name === "string" ? body.name : "";
      const direction = body.direction === "remote" ? "remote" : "local";
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error("Invalid DataChannel name");
      const peerSessionId = isOwnerSession ? room.guestSessionId : room.ownerSessionId;
      if (direction === "remote" && !peerSessionId) return json({ error: "Peer has not joined" }, { status: 409 });
      const channel = direction === "local"
        ? { location: "local", dataChannelName: name }
        : { location: "remote", sessionId: peerSessionId, dataChannelName: name, waitForAck: true };
      const result = await realtimeRequest(env, `/sessions/${sessionId}/datachannels/new`, "POST", { dataChannels: [channel] });
      const id = result.dataChannels?.[0]?.id;
      if (typeof id !== "number") throw new Error("Realtime did not return a DataChannel ID");
      return json({ id });
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Realtime request failed" }, { status: 400 });
  }
}

export async function handleCreateShareRoom(
  request: Request,
  env: RealtimeRoomEnv,
) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!env.REALTIME_APP_ID?.trim() || !env.REALTIME_API_TOKEN?.trim()) {
    return json(
      { error: "Cloudflare Realtime is not configured" },
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
