import { applyD1Migrations, env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../src/auth";
import { WORKSPACE_REALTIME_PROTOCOL } from "../src/realtime/workspace-v2-protocol";

type TestEnv = {
  USER_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
  WORKSPACE_REALTIME: DurableObjectNamespace;
};

type D1Migration = {
  name: string;
  queries: string[];
};

const testEnv = env as unknown as TestEnv;
const ORIGIN = "http://127.0.0.1:4174";

async function seedHandoff(options?: {
  code?: string;
  origin?: string;
  expiresAt?: string;
  consumedAt?: string | null;
}) {
  const suffix = crypto.randomUUID();
  const userId = `user-${suffix}`;
  const sessionId = `session-${suffix}`;
  const workspaceId = `workspace-${suffix}`;
  const shareId = `share-${suffix}`;
  const code = options?.code || `a${suffix.replace(/-/g, "")}aaaaaaaaaa`;
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = options?.expiresAt || new Date(now.getTime() + 60_000).toISOString();
  await testEnv.USER_DB.batch([
    testEnv.USER_DB.prepare(
      "INSERT INTO users (id, email, name, avatar, created_at, updated_at) VALUES (?, NULL, ?, NULL, ?, ?)",
    ).bind(userId, "OAuth User", nowIso, nowIso),
    testEnv.USER_DB.prepare(
      "INSERT INTO workspaces (id, share_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(workspaceId, shareId, "My Workspace", nowIso, nowIso),
    testEnv.USER_DB.prepare(
      "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(sessionId, userId, await sha256(`session-token-${suffix}`), nowIso, new Date(now.getTime() + 3_600_000).toISOString(), nowIso),
    testEnv.USER_DB.prepare(
      "INSERT INTO auth_handoff_codes (code_hash, user_id, session_id, return_origin, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      await sha256(code),
      userId,
      sessionId,
      options?.origin || ORIGIN,
      nowIso,
      expiresAt,
      options?.consumedAt ?? null,
    ),
  ]);
  return { code, sessionId, userId, workspaceId, shareId, sessionToken: `session-token-${suffix}` };
}

async function exchange(code: string, origin = ORIGIN) {
  return SELF.fetch("https://api.picbind.com/api/auth/exchange", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "cf-connecting-ip": crypto.randomUUID(),
    },
    body: JSON.stringify({ code }),
  });
}

async function requestTicket(seeded: Awaited<ReturnType<typeof seedHandoff>>, origin = ORIGIN) {
  const clientId = `owner_${crypto.randomUUID()}`;
  const response = await SELF.fetch(
    `https://api.picbind.com/api/workspaces/${seeded.workspaceId}/realtime-ticket`,
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "cf-connecting-ip": crypto.randomUUID(),
      },
      body: JSON.stringify({ clientId }),
    },
  );
  return { response, clientId };
}

async function requestGuestTicket(
  seeded: Awaited<ReturnType<typeof seedHandoff>>,
  origin = ORIGIN,
) {
  const clientId = `guest_${crypto.randomUUID()}`;
  const response = await SELF.fetch(
    `https://api.picbind.com/api/workspace-links/${seeded.shareId}/realtime-ticket`,
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "cf-connecting-ip": crypto.randomUUID(),
      },
      body: JSON.stringify({ clientId }),
    },
  );
  return { response, clientId };
}

async function connectV2(workspaceId: string, ticket: string, origin = ORIGIN) {
  return SELF.fetch(`https://api.picbind.com/api/workspaces/${workspaceId}/realtime-v2`, {
    headers: {
      origin,
      upgrade: "websocket",
      "sec-websocket-protocol": `${WORKSPACE_REALTIME_PROTOCOL}, picbind.ticket.${ticket}`,
      "cf-connecting-ip": crypto.randomUUID(),
    },
  });
}

function nextSocketMessage(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 2_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)) as Record<string, any>);
    }, { once: true });
  });
}

function workspaceRelay(
  event: Record<string, unknown>,
  delivery: "ephemeral" | "reliable" | "bulk",
  route: "workspace" | "owner" | "user" = "workspace",
  targetUserId?: string,
) {
  return {
    type: "workspaceRelay",
    version: 1,
    route,
    delivery,
    targetUserId,
    event: {
      eventId: crypto.randomUUID(),
      sequence: 1,
      dataClass: "collaborationEvent",
      ...event,
    },
  };
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.USER_DB, testEnv.TEST_MIGRATIONS);
});

describe("OAuth Handoff communication", () => {
  it("exchanges once for user-only AuthState", async () => {
    const seeded = await seedHandoff();
    const response = await exchange(seeded.code);
    expect(response.status).toBe(200);
    const envelope = await response.json() as Record<string, any>;
    expect(envelope.data.authenticated).toBe(true);
    expect(envelope.data.user.id).toBe(seeded.userId);
    expect(envelope.data).not.toHaveProperty("workspaces");
    expect(envelope.data).not.toHaveProperty("realtimeGrant");

    const reused = await exchange(seeded.code);
    expect(reused.status).toBe(409);
    await expect(reused.json()).resolves.toMatchObject({ error: { code: "auth_code_used" } });
  });

  it("rejects the wrong origin without consuming the code", async () => {
    const seeded = await seedHandoff();
    const mismatch = await exchange(seeded.code, "http://localhost:4174");
    expect(mismatch.status).toBe(403);
    await expect(mismatch.json()).resolves.toMatchObject({ error: { code: "auth_origin_mismatch" } });
    expect((await exchange(seeded.code)).status).toBe(200);
  });

  it("rejects expired and already consumed codes", async () => {
    const expired = await seedHandoff({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
    const expiredResponse = await exchange(expired.code);
    expect(expiredResponse.status).toBe(401);
    await expect(expiredResponse.json()).resolves.toMatchObject({ error: { code: "auth_code_expired" } });

    const used = await seedHandoff({ consumedAt: new Date().toISOString() });
    const usedResponse = await exchange(used.code);
    expect(usedResponse.status).toBe(409);
    await expect(usedResponse.json()).resolves.toMatchObject({ error: { code: "auth_code_used" } });
  });

  it("rejects a malformed code without exposing authentication state", async () => {
    const response = await exchange("not-a-valid-code");
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("auth_code_invalid");
    expect(body).not.toContain("authenticated");
    expect(body).not.toContain("realtimeGrant");
  });
});

describe("email authentication communication", () => {
  it("creates only a user profile", async () => {
    const email = `worker-test-${crypto.randomUUID()}@example.com`;
    const response = await SELF.fetch("https://api.picbind.com/api/auth/register", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "cf-connecting-ip": crypto.randomUUID(),
      },
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    expect(response.status).toBe(201);
    const envelope = await response.json() as Record<string, any>;
    expect(envelope.data.user.email).toBe(email);
    expect(envelope.data).not.toHaveProperty("workspaces");
    expect(envelope.data).not.toHaveProperty("realtimeGrant");
  });
});

describe("Workspace Ticket communication", () => {
  it("issues an owner Ticket with fixed protocol and short-lived ICE data", async () => {
    const seeded = await seedHandoff();
    const { response } = await requestTicket(seeded);
    expect(response.status).toBe(200);
    const envelope = await response.json() as Record<string, any>;
    expect(envelope.data.protocol).toBe(WORKSPACE_REALTIME_PROTOCOL);
    expect(envelope.data.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(envelope.data.iceServers).toEqual([]);
    expect(Date.parse(envelope.data.expiresAt) - Date.now()).toBeGreaterThan(40_000);
    expect(Date.parse(envelope.data.expiresAt) - Date.now()).toBeLessThanOrEqual(45_000);
  });

  it("records collaborator role and never stores the plaintext Ticket", async () => {
    const seeded = await seedHandoff();
    const { response } = await requestGuestTicket(seeded);
    const envelope = await response.json() as Record<string, any>;
    const ticket = envelope.data.ticket as string;
    const object = testEnv.WORKSPACE_REALTIME.get(
      testEnv.WORKSPACE_REALTIME.idFromName(seeded.workspaceId),
    );
    const stored = await runInDurableObject(object, async (_instance, state) => {
      const values = await state.storage.list({ prefix: "ticket:" });
      return JSON.stringify([...values.entries()]);
    });
    expect(stored).not.toContain(ticket);
    expect(stored).toContain('"role":"collaborator"');
  });

  it("atomically allows only one consumption of a Ticket", async () => {
    const seeded = await seedHandoff();
    const { response } = await requestTicket(seeded);
    const envelope = await response.json() as Record<string, any>;
    const ticket = envelope.data.ticket as string;
    const body = JSON.stringify({
      ticketHash: await sha256(ticket),
      workspaceId: seeded.workspaceId,
      origin: ORIGIN,
    });
    const object = testEnv.WORKSPACE_REALTIME.get(
      testEnv.WORKSPACE_REALTIME.idFromName(seeded.workspaceId),
    );
    const responses = await Promise.all([
      object.fetch("https://workspace-realtime/tickets/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      object.fetch("https://workspace-realtime/tickets/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    ]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
  });

  it("requires a valid client ID but no login, Session, or membership", async () => {
    const seeded = await seedHandoff();
    const response = await SELF.fetch(
      `https://api.picbind.com/api/workspaces/${seeded.workspaceId}/realtime-ticket`,
      {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ clientId: "short" }),
      },
    );
    expect(response.status).toBe(400);
    expect((await requestTicket(seeded)).response.status).toBe(200);
    expect((await requestGuestTicket(seeded)).response.status).toBe(200);
  });

  it("joins a shared Workspace anonymously", async () => {
    const owner = await seedHandoff();
    const response = await SELF.fetch(
      `https://api.picbind.com/api/workspace-links/${owner.shareId}/join`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": crypto.randomUUID(),
        },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { workspace: { id: owner.workspaceId, shareId: owner.shareId } },
    });
    expect((await requestGuestTicket(owner)).response.status).toBe(200);
  });

  it("does not accept an internal Workspace ID as a share link", async () => {
    const owner = await seedHandoff();
    const response = await SELF.fetch(
      `https://api.picbind.com/api/workspace-links/${owner.workspaceId}/join`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": crypto.randomUUID(),
        },
      },
    );
    expect(response.status).toBe(404);
  });

  it("rotates a permanent share link without user identity and invalidates the old link", async () => {
    const owner = await seedHandoff();
    const rotated = await SELF.fetch(
      `https://api.picbind.com/api/workspaces/${owner.workspaceId}/share-link`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": crypto.randomUUID(),
        },
      },
    );
    expect(rotated.status).toBe(200);
    const rotatedEnvelope = await rotated.json() as Record<string, any>;
    const newShareId = rotatedEnvelope.data.workspace.shareId as string;
    expect(newShareId).not.toBe(owner.shareId);
    expect(rotatedEnvelope.data.workspace.id).toBe(owner.workspaceId);

    const join = (shareId: string) => SELF.fetch(
      `https://api.picbind.com/api/workspace-links/${shareId}/join`,
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "cf-connecting-ip": crypto.randomUUID(),
        },
      },
    );
    expect((await join(owner.shareId)).status).toBe(404);
    expect((await requestGuestTicket(owner)).response.status).toBe(404);
    expect((await join(newShareId)).status).toBe(200);
  });
});

describe("Workspace WebSocket V2 communication", () => {
  it("upgrades without Cookie, returns only the fixed protocol, and rejects Ticket reuse", async () => {
    const seeded = await seedHandoff();
    const ticketResponse = await requestTicket(seeded);
    const ticketEnvelope = await ticketResponse.response.json() as Record<string, any>;
    const ticket = ticketEnvelope.data.ticket as string;
    const response = await connectV2(seeded.workspaceId, ticket);
    expect(response.status).toBe(101);
    expect(response.headers.get("sec-websocket-protocol")).toBe(WORKSPACE_REALTIME_PROTOCOL);
    expect(response.headers.get("sec-websocket-protocol")).not.toContain(ticket);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket!.accept();
    await expect(nextSocketMessage(socket!)).resolves.toMatchObject({
      type: "connected",
      userId: `owner-${ticketResponse.clientId}`,
      role: "owner",
    });
    socket!.close(1000, "test-complete");

    const reused = await connectV2(seeded.workspaceId, ticket);
    expect(reused.status).toBe(401);
  });

  it("does not fall back to Cookie when the V2 Ticket protocol is missing", async () => {
    const seeded = await seedHandoff();
    const response = await SELF.fetch(
      `https://api.picbind.com/api/workspaces/${seeded.workspaceId}/realtime-v2`,
      {
        headers: {
          origin: ORIGIN,
          upgrade: "websocket",
          cookie: `__Host-picbind_session=${seeded.sessionToken}`,
          "sec-websocket-protocol": WORKSPACE_REALTIME_PROTOCOL,
          "cf-connecting-ip": crypto.randomUUID(),
        },
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ticket_missing" } });
  });

  it("connects without Cookie, Session, or membership", async () => {
    const seeded = await seedHandoff();
    const ticketResponse = await requestTicket(seeded);
    const ticketEnvelope = await ticketResponse.response.json() as Record<string, any>;
    const response = await connectV2(seeded.workspaceId, ticketEnvelope.data.ticket);
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close(1000, "test-complete");
  });

  it("rejects an expired Ticket and a Ticket presented from another Origin", async () => {
    const expiredSeed = await seedHandoff();
    const expiredTicketResponse = await requestTicket(expiredSeed);
    const expiredEnvelope = await expiredTicketResponse.response.json() as Record<string, any>;
    const expiredObject = testEnv.WORKSPACE_REALTIME.get(
      testEnv.WORKSPACE_REALTIME.idFromName(expiredSeed.workspaceId),
    );
    await runInDurableObject(expiredObject, async (_instance, state) => {
      const tickets = await state.storage.list<Record<string, any>>({ prefix: "ticket:" });
      for (const [key, ticket] of tickets) {
        await state.storage.put(key, { ...ticket, expiresAt: Date.now() - 1 });
      }
    });
    expect((await connectV2(expiredSeed.workspaceId, expiredEnvelope.data.ticket)).status).toBe(401);

    const originSeed = await seedHandoff();
    const originTicketResponse = await requestTicket(originSeed);
    const originEnvelope = await originTicketResponse.response.json() as Record<string, any>;
    expect((await connectV2(
      originSeed.workspaceId,
      originEnvelope.data.ticket,
      "http://localhost:4174",
    )).status).toBe(403);
    const valid = await connectV2(originSeed.workspaceId, originEnvelope.data.ticket);
    expect(valid.status).toBe(101);
    valid.webSocket?.accept();
    valid.webSocket?.close(1000, "test-complete");
  });

  it("relays WebRTC signaling between a collaborator and owner", async () => {
    const owner = await seedHandoff();
    const ownerTicketResponse = await requestTicket(owner);
    const collaboratorTicketResponse = await requestGuestTicket(owner);
    const ownerTicket = (await ownerTicketResponse.response.json() as Record<string, any>).data.ticket;
    const collaboratorTicket = (
      await collaboratorTicketResponse.response.json() as Record<string, any>
    ).data.ticket;

    const ownerUpgrade = await connectV2(owner.workspaceId, ownerTicket);
    const ownerSocket = ownerUpgrade.webSocket!;
    ownerSocket.accept();
    await nextSocketMessage(ownerSocket);

    const ownerJoined = nextSocketMessage(ownerSocket);
    const collaboratorUpgrade = await connectV2(owner.workspaceId, collaboratorTicket);
    const collaboratorSocket = collaboratorUpgrade.webSocket!;
    collaboratorSocket.accept();
    await expect(ownerJoined).resolves.toMatchObject({
      type: "memberJoined",
      userId: `guest-${collaboratorTicketResponse.clientId}`,
      role: "collaborator",
    });
    await expect(nextSocketMessage(collaboratorSocket)).resolves.toMatchObject({
      type: "connected",
      role: "collaborator",
      ownerOnline: true,
      members: [
        expect.objectContaining({
          userId: `owner-${ownerTicketResponse.clientId}`,
          role: "owner",
        }),
      ],
    });

    const previewSnapshot = nextSocketMessage(collaboratorSocket);
    ownerSocket.send(JSON.stringify(workspaceRelay({
      type: "previewSnapshot",
      dataClass: "preview",
      imageIds: ["shared-image-1"],
    }, "ephemeral")));
    await expect(previewSnapshot).resolves.toMatchObject({
      type: "workspaceRelay",
      version: 1,
      event: {
        type: "previewSnapshot",
        imageIds: ["shared-image-1"],
        senderId: `owner-${ownerTicketResponse.clientId}`,
        senderRole: "owner",
      },
    });

    const placeholderUpsert = nextSocketMessage(collaboratorSocket);
    const placeholderRelay = workspaceRelay({
      type: "placeholderUpsert",
      dataClass: "preview",
      imageId: "shared-image-1",
      imageName: "shared.png",
      mimeType: "image/png",
      width: 640,
      height: 480,
      placeholder: {
        width: 16,
        height: 12,
        dominantColor: "#112233",
        blurHash: "placeholder-hash",
      },
      version: 1,
      currentCommit: null,
    }, "reliable");
    ownerSocket.send(JSON.stringify(placeholderRelay));
    await expect(placeholderUpsert).resolves.toMatchObject({
      type: "workspaceRelay",
      event: {
        type: "placeholderUpsert",
        senderId: `owner-${ownerTicketResponse.clientId}`,
        senderRole: "owner",
        dataClass: "preview",
        reliability: "reliable",
        imageId: "shared-image-1",
        placeholder: {
          dominantColor: "#112233",
          blurHash: "placeholder-hash",
        },
      },
    });
    await expect(nextSocketMessage(ownerSocket)).resolves.toMatchObject({
      type: "eventAck",
      eventId: placeholderRelay.event.eventId,
    });

    const previewUpsert = nextSocketMessage(collaboratorSocket);
    ownerSocket.send(JSON.stringify(workspaceRelay({
      type: "previewUpsert",
      dataClass: "preview",
      image: {
        imageId: "shared-image-1",
        imageName: "shared.png",
        mimeType: "image/webp",
        sourceMimeType: "image/png",
        width: 640,
        height: 480,
        placeholder: {
          width: 16,
          height: 12,
          dominantColor: "#112233",
          blurHash: null,
        },
        bytes: [82, 73, 70, 70],
        version: 1,
        currentCommit: null,
      },
    }, "bulk")));
    await expect(previewUpsert).resolves.toMatchObject({
      type: "workspaceRelay",
      event: {
        type: "previewUpsert",
        senderId: `owner-${ownerTicketResponse.clientId}`,
        senderRole: "owner",
        dataClass: "preview",
        reliability: "bulk",
        image: {
          imageId: "shared-image-1",
          imageName: "shared.png",
          mimeType: "image/webp",
          sourceMimeType: "image/png",
          width: 640,
          height: 480,
          bytes: [82, 73, 70, 70],
          version: 1,
        },
      },
    });

    const futureEvent = nextSocketMessage(ownerSocket);
    const futureRelay = workspaceRelay({
      type: "futureWorkspaceFeature",
      senderId: "forged-user",
      payload: { enabled: true },
    }, "reliable", "owner");
    collaboratorSocket.send(JSON.stringify(futureRelay));
    await expect(futureEvent).resolves.toMatchObject({
      type: "workspaceRelay",
      event: {
        type: "futureWorkspaceFeature",
        senderId: `guest-${collaboratorTicketResponse.clientId}`,
        senderRole: "collaborator",
        payload: { enabled: true },
      },
    });
    await expect(nextSocketMessage(collaboratorSocket)).resolves.toMatchObject({
      type: "eventAck",
      eventId: futureRelay.event.eventId,
    });

    const relayedOffer = nextSocketMessage(ownerSocket);
    collaboratorSocket.send(JSON.stringify({
      type: "webrtcOffer",
      targetRole: "owner",
      description: { type: "offer", sdp: "test-offer" },
    }));
    await expect(relayedOffer).resolves.toMatchObject({
      type: "webrtcOffer",
      senderId: `guest-${collaboratorTicketResponse.clientId}`,
    });

    const relayedReady = nextSocketMessage(ownerSocket);
    collaboratorSocket.send(JSON.stringify({
      type: "transportReady",
      targetRole: "owner",
      transportEpoch: 123,
      transport: "webRtcDataChannel",
    }));
    await expect(relayedReady).resolves.toMatchObject({
      type: "transportReady",
      senderId: `guest-${collaboratorTicketResponse.clientId}`,
      transportEpoch: 123,
    });
    const transportChanged = nextSocketMessage(ownerSocket);
    collaboratorSocket.close(1000, "rtc-promoted");
    await expect(transportChanged).resolves.toMatchObject({
      type: "memberTransportChanged",
      userId: `guest-${collaboratorTicketResponse.clientId}`,
      transport: "webRtcDataChannel",
    });
    ownerSocket.close(1000, "test-complete");
  });

  it("returns a generic NACK when a reliable relay has no online target", async () => {
    const owner = await seedHandoff();
    const ticketResponse = await requestGuestTicket(owner);
    const ticket = (await ticketResponse.response.json() as Record<string, any>).data.ticket;
    const upgrade = await connectV2(owner.workspaceId, ticket);
    const socket = upgrade.webSocket!;
    socket.accept();
    await expect(nextSocketMessage(socket)).resolves.toMatchObject({
      type: "connected",
      role: "collaborator",
      ownerOnline: false,
    });

    const relay = workspaceRelay({ type: "anotherFutureFeature" }, "reliable", "owner");
    socket.send(JSON.stringify(relay));
    await expect(nextSocketMessage(socket)).resolves.toMatchObject({
      type: "eventNack",
      eventId: relay.event.eventId,
    });
    socket.close(1000, "test-complete");
  });

  it("keeps the anonymous V1 WebSocket route available during migration", async () => {
    const seeded = await seedHandoff();
    const response = await SELF.fetch(
      `https://api.picbind.com/api/workspaces/${seeded.workspaceId}/realtime`,
      {
        headers: {
          origin: ORIGIN,
          upgrade: "websocket",
          "cf-connecting-ip": crypto.randomUUID(),
        },
      },
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    await expect(nextSocketMessage(socket)).resolves.toMatchObject({ type: "connected" });
    socket.close(1000, "test-complete");
  });
});

describe("authentication rate limiting", () => {
  it("limits repeated exchange attempts from one client", async () => {
    const ip = "198.51.100.42";
    let finalResponse: Response | null = null;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      finalResponse = await SELF.fetch("https://api.picbind.com/api/auth/exchange", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "cf-connecting-ip": ip,
        },
        body: JSON.stringify({ code: "not-a-valid-code" }),
      });
    }
    expect(finalResponse?.status).toBe(429);
    await expect(finalResponse?.json()).resolves.toMatchObject({ error: { code: "rate_limited" } });
  });
});
