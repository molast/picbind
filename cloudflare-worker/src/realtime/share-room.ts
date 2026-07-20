import {
  SHARE_ROOM_TTL_MS,
  type ShareRoomMember,
  type ShareRoomR2Object,
  type ShareRoomState,
} from "./share-room-object";
import { devError, type RuntimeLogEnv } from "../runtime-log";
import {
  createR2DownloadUrl,
  decideFileTransferMode,
  prepareR2Upload,
  r2FileExpiresAt,
  verifyR2Upload,
  type R2ImageMetadata,
  type ShareRoomR2Env,
} from "./share-room-r2";

export type RealtimeRoomEnv = RuntimeLogEnv & ShareRoomR2Env & {
  REALTIME_ROOMS: DurableObjectNamespace;
  LOCAL_RUNTIME?: string;
  TURN_TOKEN_ID?: string;
  TURN_API_TOKEN?: string;
  SITE_URL?: string;
  MAX_IMAGE_TRANSFER_SIZE_MB?: string;
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
  if (env.LOCAL_RUNTIME?.trim() === "1") {
    return [];
  }
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

function maxImageTransferSize(env: RealtimeRoomEnv) {
  const configuredMb = Number(env.MAX_IMAGE_TRANSFER_SIZE_MB || 10);
  const normalizedMb =
    Number.isFinite(configuredMb) && configuredMb > 0 ? configuredMb : 10;
  return Math.floor(normalizedMb * 1024 * 1024);
}

function r2ImageMetadata(
  body: Record<string, unknown>,
  maxSize: number,
): R2ImageMetadata | null {
  const image = body.image as Partial<R2ImageMetadata> | undefined;
  if (
    !image ||
    typeof image.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(image.id) ||
    typeof image.name !== "string" ||
    image.name.length < 1 ||
    image.name.length > 255 ||
    typeof image.type !== "string" ||
    !image.type.startsWith("image/") ||
    typeof image.size !== "number" ||
    !Number.isSafeInteger(image.size) ||
    image.size < 0 ||
    image.size > maxSize
  ) {
    return null;
  }
  return image as R2ImageMetadata;
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
      const sessionMember = roomMembers(room).find(
        (member) => member.sessionId === sessionId,
      );
      if (sessionMember?.status === "kicked") {
        return json({ error: "You were removed from this room" }, { status: 403 });
      }
      const requester = memberForSession(room, sessionId);
      return json({
        maxImageTransferSize: maxImageTransferSize(env),
        members: roomMembers(room)
          .filter((member) => member.status !== "kicked")
          .map(({ clientId, role, status, leftAt }) => ({
            clientId,
            role,
            status: status === "online" ? "online" : "offline",
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
            member.clientId === clientId &&
            member.status === "kicked",
        )
      ) {
        return json({ error: "You were removed from this room" }, { status: 403 });
      }
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
      if (!claimed.ok) {
        return json(
          { error: (updated as { error?: string }).error || "Could not join room" },
          { status: claimed.status },
        );
      }
      const updatedRoom = updated as ShareRoomState;
      const peer = readyMember(updatedRoom, role === "owner" ? "guest" : "owner");
      return json({
        role,
        sessionId,
        peerSessionId: peer?.sessionId,
        maxImageTransferSize: maxImageTransferSize(env),
      });
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const member =
      action === "heartbeat"
        ? roomMembers(room).find(
            (candidate) =>
              candidate.sessionId === sessionId && candidate.status !== "kicked",
          )
        : memberForSession(room, sessionId);
    if (!member) return json({ error: "Invalid room session" }, { status: 403 });
    const isOwnerSession = member.role === "owner";

    if (action === "ice-servers") {
      stage = "generate-turn-credentials";
      return json({ iceServers: await generateTurnIceServers(env) });
    }

    if (action === "r2-prepare") {
      const image = r2ImageMetadata(body, maxImageTransferSize(env));
      if (!image) {
        return json({ error: "Invalid R2 image metadata" }, { status: 400 });
      }
      const rawRtt = body.rttMs;
      const rttMs =
        typeof rawRtt === "number" && Number.isFinite(rawRtt)
          ? Math.max(0, rawRtt)
          : null;
      const mode = decideFileTransferMode(
        env,
        rttMs,
        typeof body.weakNetwork === "boolean" ? body.weakNetwork : undefined,
      );
      if (mode === "p2p") return json({ mode });
      stage = "prepare-r2-upload";
      return json({
        mode,
        ...(await prepareR2Upload(
          env,
          room.roomId,
          image,
          room.expiresAt,
        )),
      });
    }

    if (action === "r2-uploaded") {
      const image = r2ImageMetadata(body, maxImageTransferSize(env));
      const objectKey = typeof body.objectKey === "string" ? body.objectKey : "";
      if (
        !image ||
        !objectKey.startsWith(`${room.roomId}/${image.id}/`)
      ) {
        return json({ error: "Invalid R2 upload completion" }, { status: 400 });
      }
      stage = "verify-r2-upload";
      await verifyR2Upload(env, objectKey, image);
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/r2-uploaded", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          objectKey,
          imageId: image.id,
          name: image.name,
          type: image.type,
          size: image.size,
          expiresAt: r2FileExpiresAt(env, room.expiresAt),
        }),
      });
      const result = await readJson<ShareRoomR2Object | { error?: string }>(
        response,
        `Share room R2 uploaded (${response.status})`,
      );
      return response.ok
        ? json(result)
        : json(
            { error: (result as { error?: string }).error || "R2 upload was rejected" },
            { status: response.status },
          );
    }

    if (action === "r2-shared") {
      const objectKey = typeof body.objectKey === "string" ? body.objectKey : "";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/r2-shared", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, objectKey }),
      });
      const result = await readJson<ShareRoomR2Object | { error?: string }>(
        response,
        `Share room R2 shared (${response.status})`,
      );
      return response.ok
        ? json(result)
        : json(
            { error: (result as { error?: string }).error || "R2 object was not shared" },
            { status: response.status },
          );
    }

    if (action === "r2-download") {
      const objectKey = typeof body.objectKey === "string" ? body.objectKey : "";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/r2-downloading", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, objectKey }),
      });
      const result = await readJson<ShareRoomR2Object | { error?: string }>(
        response,
        `Share room R2 downloading (${response.status})`,
      );
      if (!response.ok) {
        return json(
          { error: (result as { error?: string }).error || "R2 object is unavailable" },
          { status: response.status },
        );
      }
      const r2Object = result as ShareRoomR2Object;
      return json({
        objectKey,
        downloadUrl: await createR2DownloadUrl(
          env,
          objectKey,
          r2Object.expiresAt,
        ),
        expiresAt: r2Object.expiresAt,
      });
    }

    if (action === "r2-downloaded") {
      const objectKey = typeof body.objectKey === "string" ? body.objectKey : "";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/r2-downloaded", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, objectKey }),
      });
      const result = await readJson<ShareRoomR2Object | { error?: string }>(
        response,
        `Share room R2 downloaded (${response.status})`,
      );
      return response.ok
        ? json(result)
        : json(
            { error: (result as { error?: string }).error || "R2 download was not recorded" },
            { status: response.status },
          );
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

    if (action === "candidate") {
      const candidate = body.candidate as RTCIceCandidateInit | undefined;
      if (
        typeof candidate?.candidate !== "string" ||
        candidate.candidate.length > 4096
      ) {
        return json({ error: "Invalid ICE candidate" }, { status: 400 });
      }
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/candidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, candidate }),
      });
      const result = await readJson<{ ok?: boolean; error?: string }>(
        response,
        `Share room candidate (${response.status})`,
      );
      return response.ok
        ? json({ ok: true })
        : json(
            { error: result.error || "ICE candidate signaling failed" },
            { status: response.status },
          );
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

    if (action === "kick") {
      if (!isOwnerSession) {
        return json({ error: "Only the Owner can remove members" }, { status: 403 });
      }
      const targetClientId =
        typeof body.targetClientId === "string" ? body.targetClientId : "";
      if (!/^[a-f0-9]{32}$/.test(targetClientId)) {
        return json({ error: "Invalid room member" }, { status: 400 });
      }
      stage = "kick-member";
      const object = env.REALTIME_ROOMS.get(
        env.REALTIME_ROOMS.idFromName(room.roomId),
      );
      const response = await object.fetch("https://share-room/kick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerSessionId: sessionId,
          targetClientId,
        }),
      });
      const result = await readJson<{ ok?: boolean; error?: string }>(
        response,
        `Share room kick (${response.status})`,
      );
      return response.ok
        ? json({ ok: true })
        : json(
            { error: result.error || "Could not remove member" },
            { status: response.status },
          );
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
    devError(env, "Share room realtime request failed", { stage, message });
    const status = /not found|expired/i.test(message) ? 404 : 400;
    return json({ error: message, stage }, { status });
  }
}

export async function handleShareRoomSocket(
  request: Request,
  env: RealtimeRoomEnv,
) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "WebSocket upgrade required" }, { status: 426 });
  }
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");
  const sessionId = url.searchParams.get("sessionId") || "";
  if (!validRoomId(roomId) || !sessionId) {
    return json({ error: "Invalid WebSocket session" }, { status: 400 });
  }
  const room = await requireRoom(env, roomId);
  if (!memberForSession(room, sessionId)) {
    return json({ error: "Invalid room session" }, { status: 403 });
  }
  const object = env.REALTIME_ROOMS.get(env.REALTIME_ROOMS.idFromName(roomId));
  return object.fetch(
    new Request(
      `https://share-room/socket?sessionId=${encodeURIComponent(sessionId)}`,
      request,
    ),
  );
}

export async function handleCreateShareRoom(
  request: Request,
  env: RealtimeRoomEnv,
) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (
    env.LOCAL_RUNTIME?.trim() !== "1" &&
    (!env.TURN_TOKEN_ID?.trim() || !env.TURN_API_TOKEN?.trim())
  ) {
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
    devError(env, "Failed to initialize share room", await initialized.text());
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
