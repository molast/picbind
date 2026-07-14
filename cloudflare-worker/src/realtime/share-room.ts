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
      shareUrl: `${siteUrl(env, request)}/share/${roomId}`,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
    },
    { status: 201 },
  );
}
