import {
  createR2PresignedUrl,
  type R2PresignEnv,
} from "../r2-presign";
import {
  getUpdates,
  ILINK_BASE_URL,
  requestQrCode,
  requestQrStatus,
  sendTextMessage,
} from "./ilink-client";
import { receiveWeixinImage } from "./weixin-media";

type JsonRecord = Record<string, unknown>;

type StoredAccount = {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  syncBuffer: string;
  contextTokens: Record<string, string>;
  savedAt: string;
};

type RuntimeState = {
  enabled: boolean;
  status: "disconnected" | "connecting" | "connected" | "error";
  lastPollSuccessAt?: number;
  error?: string;
  failures: number;
};

type LoginSession = {
  sessionId: string;
  qrcode: string;
  qrData: string;
  baseUrl: string;
  state: "qr_pending" | "scanned" | "expired" | "confirmed" | "error";
  expiresAt: number;
  error?: string;
};

type MediaObject = {
  id: string;
  accessToken: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  expiresAt: number;
};

type GatewayMessage = {
  id: string;
  channel: "wechat";
  senderId: string;
  conversationId: string;
  type: "text" | "image";
  payload: {
    text?: string;
    fileId?: string;
    downloadUrl?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    expiresAt?: number;
  };
  timestamp: number;
};

export type WeixinMessagingEnv = R2PresignEnv & {
  MESSAGING_MEDIA_R2: R2Bucket;
  MESSAGING_MEDIA_TTL_SECONDS?: string;
  MESSAGING_MEDIA_URL_TTL_SECONDS?: string;
  MESSAGING_MAX_MEDIA_SIZE_MB?: string;
  MESSAGING_PUBLIC_URL?: string;
};

const ACCOUNT_KEY = "account";
const CLIENT_ID_KEY = "client-id";
const RUNTIME_KEY = "runtime";
const MEDIA_KEY = "media-objects";
const SEEN_KEY = "seen-messages";
const DEFAULT_MEDIA_TTL_SECONDS = 1800;
const DEFAULT_URL_TTL_SECONDS = 900;
const DEFAULT_MAX_MEDIA_SIZE = 20 * 1024 * 1024;
const DEDUP_TTL_MS = 5 * 60 * 1000;

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function extractText(items: unknown) {
  if (!Array.isArray(items)) return "";
  for (const candidate of items) {
    const item = record(candidate);
    if (Number(item.type) !== 1) continue;
    const text = String(record(item.text_item).text || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizedTimestamp(message: JsonRecord) {
  const now = Date.now();
  const value = Number(message.create_time_ms || message.create_time || now);
  return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
}

function boundedSeconds(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed)
    ? Math.max(60, Math.min(max, Math.floor(parsed)))
    : fallback;
}

function randomBase64Url(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function shortHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class WeixinMessagingObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: WeixinMessagingEnv,
  ) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const clientId = url.searchParams.get("clientId");
    if (clientId && /^[a-f0-9]{32}$/.test(clientId)) {
      await this.state.storage.put(CLIENT_ID_KEY, clientId);
    }

    if (request.method === "GET" && pathname === "/status") {
      return json(await this.snapshot());
    }
    if (request.method === "POST" && pathname === "/login") {
      return this.startLogin();
    }
    const loginMatch = pathname.match(/^\/login\/([^/]+)$/);
    if (request.method === "GET" && loginMatch) {
      return this.pollLogin(decodeURIComponent(loginMatch[1]));
    }
    if (request.method === "POST" && pathname === "/connect") {
      const account = await this.state.storage.get<StoredAccount>(ACCOUNT_KEY);
      if (!account) return json({ error: "Weixin has not been configured" }, { status: 409 });
      await this.updateRuntime({
        enabled: true,
        status: "connecting",
        error: undefined,
        failures: 0,
      });
      await this.scheduleNext(Date.now() + 1);
      return json(await this.snapshot());
    }
    if (request.method === "POST" && pathname === "/disconnect") {
      await this.updateRuntime({
        enabled: false,
        status: "disconnected",
        error: undefined,
        failures: 0,
      });
      await this.scheduleMediaCleanupOnly();
      return json(await this.snapshot());
    }
    if (request.method === "POST" && pathname === "/messages") {
      return this.sendMessage(request);
    }
    const fileMatch = pathname.match(/^\/files\/([A-Za-z0-9_-]+)$/);
    if (request.method === "GET" && fileMatch) {
      const token = url.searchParams.get("token");
      if (token) return this.serveMedia(fileMatch[1], token);
      return this.refreshMediaUrl(fileMatch[1]);
    }
    if (request.method === "GET" && pathname === "/socket") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server, ["weixin-client"]);
      server.serializeAttachment({ connectedAt: Date.now() });
      server.send(JSON.stringify({
        type: "GATEWAY_STATUS",
        payload: await this.snapshot(),
      }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "Not found" }, { status: 404 });
  }

  async alarm() {
    await this.cleanupMedia();
    const runtime = await this.runtime();
    if (!runtime.enabled) {
      await this.scheduleMediaCleanupOnly();
      return;
    }
    const account = await this.state.storage.get<StoredAccount>(ACCOUNT_KEY);
    if (!account) {
      await this.updateRuntime({
        enabled: false,
        status: "error",
        error: "Weixin has not been configured",
        failures: runtime.failures,
      });
      return;
    }

    try {
      const response = await getUpdates(
        account.baseUrl,
        account.token,
        account.syncBuffer,
      );
      const ret = Number(response.ret || response.errcode || 0);
      const errorMessage = String(response.errmsg || "");
      if (ret !== 0) {
        if (
          ret === -14 ||
          (ret === -2 && errorMessage.toLowerCase() === "unknown error")
        ) {
          throw new Error("iLink session expired; scan the QR code again");
        }
        throw new Error(`iLink getupdates failed: ${errorMessage || ret}`);
      }

      const nextBuffer = String(response.get_updates_buf || "");
      if (nextBuffer) account.syncBuffer = nextBuffer;
      const messages = Array.isArray(response.msgs) ? response.msgs : [];
      for (const rawMessage of messages) {
        await this.acceptMessage(record(rawMessage), account);
      }
      account.savedAt = new Date().toISOString();
      await this.state.storage.put(ACCOUNT_KEY, account);
      await this.updateRuntime({
        enabled: true,
        status: "connected",
        lastPollSuccessAt: Date.now(),
        error: undefined,
        failures: 0,
      });
      await this.scheduleNext(Date.now() + 100);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const expired = message.includes("session expired");
      const failures = runtime.failures + 1;
      await this.updateRuntime({
        enabled: !expired,
        status: "error",
        error: message,
        failures,
      });
      if (!expired) {
        await this.scheduleNext(Date.now() + (failures >= 3 ? 30_000 : 2_000));
      } else {
        await this.scheduleMediaCleanupOnly();
      }
    }
  }

  webSocketMessage(_socket: WebSocket, _message: string | ArrayBuffer) {}

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ) {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "Messaging WebSocket error");
  }

  private async snapshot() {
    const [account, runtime] = await Promise.all([
      this.state.storage.get<StoredAccount>(ACCOUNT_KEY),
      this.runtime(),
    ]);
    return {
      configured: Boolean(account),
      status: runtime.status,
      accountId: account?.accountId,
      userId: account?.userId,
      lastPollSuccessAt: runtime.lastPollSuccessAt,
      error: runtime.error,
    };
  }

  private async startLogin() {
    const qr = await requestQrCode();
    const session: LoginSession = {
      sessionId: crypto.randomUUID(),
      qrcode: qr.value,
      qrData: qr.scanData,
      baseUrl: ILINK_BASE_URL,
      state: "qr_pending",
      expiresAt: Date.now() + 8 * 60 * 1000,
    };
    await this.state.storage.put(`login:${session.sessionId}`, session);
    return json(this.publicLogin(session), { status: 201 });
  }

  private async pollLogin(sessionId: string) {
    const key = `login:${sessionId}`;
    const session = await this.state.storage.get<LoginSession>(key);
    if (!session) return json({ error: "Login session not found" }, { status: 404 });
    if (Date.now() >= session.expiresAt) session.state = "expired";
    if (!new Set(["expired", "confirmed", "error"]).has(session.state)) {
      try {
        const result = await requestQrStatus(session.qrcode, session.baseUrl);
        if (result.status === "scaned_but_redirect" && result.redirectHost) {
          session.baseUrl = result.redirectHost.startsWith("http")
            ? result.redirectHost
            : `https://${result.redirectHost}`;
          session.state = "scanned";
        } else if (result.status === "scaned") {
          session.state = "scanned";
        } else if (result.status === "expired") {
          session.state = "expired";
        } else if (result.status === "confirmed") {
          if (!result.accountId || !result.token) {
            throw new Error("iLink confirmation did not return credentials");
          }
          const account: StoredAccount = {
            accountId: result.accountId,
            token: result.token,
            baseUrl: result.baseUrl || session.baseUrl || ILINK_BASE_URL,
            userId: result.userId,
            syncBuffer: "",
            contextTokens: {},
            savedAt: new Date().toISOString(),
          };
          await this.state.storage.put(ACCOUNT_KEY, account);
          await this.updateRuntime({
            enabled: true,
            status: "connecting",
            error: undefined,
            failures: 0,
          });
          await this.scheduleNext(Date.now() + 1);
          session.state = "confirmed";
        }
      } catch (error) {
        session.state = "error";
        session.error = error instanceof Error ? error.message : String(error);
      }
    }
    await this.state.storage.put(key, session);
    if (new Set(["expired", "confirmed"]).has(session.state)) {
      await this.state.storage.delete(key);
    }
    return json(this.publicLogin(session));
  }

  private publicLogin(session: LoginSession) {
    return {
      sessionId: session.sessionId,
      state: session.state,
      qrData: session.qrData,
      expiresAt: session.expiresAt,
      error: session.error,
    };
  }

  private async sendMessage(request: Request) {
    const account = await this.state.storage.get<StoredAccount>(ACCOUNT_KEY);
    if (!account) return json({ error: "Weixin has not been configured" }, { status: 409 });
    const message = record(await request.json().catch(() => ({})));
    const payload = record(message.payload);
    const toUserId = String(message.conversationId || message.toUserId || "").trim();
    const text = String(payload.text || message.text || "").trim();
    if (!toUserId || !text) {
      return json({ error: "conversationId and text are required" }, { status: 400 });
    }
    const response = await sendTextMessage(
      account.baseUrl,
      account.token,
      toUserId,
      text,
      account.contextTokens[toUserId],
    );
    const ret = Number(response.ret || response.errcode || 0);
    if (ret !== 0) {
      return json({ error: `iLink sendmessage failed: ${String(response.errmsg || ret)}` }, { status: 502 });
    }
    return json({ id: String(response.message_id || crypto.randomUUID()) }, { status: 202 });
  }

  private async acceptMessage(message: JsonRecord, account: StoredAccount) {
    const senderId = String(message.from_user_id || "").trim();
    if (!senderId || senderId === account.accountId) return;
    const items = Array.isArray(message.item_list) ? message.item_list : [];
    const text = extractText(items);
    const imageItems = items.filter((item) => Number(record(item).type) === 2);
    if (!text && !imageItems.length) return;
    const messageId = String(message.message_id || "").trim();
    const contentKey = messageId || await shortHash(
      `${senderId}\u0000${text}\u0000${JSON.stringify(imageItems[0] || {})}`,
    );
    if (await this.seen(contentKey)) return;

    const contextToken = String(message.context_token || "").trim();
    if (contextToken) account.contextTokens[senderId] = contextToken;
    const base = {
      channel: "wechat" as const,
      senderId,
      conversationId: String(message.group_id || senderId),
      timestamp: normalizedTimestamp(message),
    };
    if (text) {
      this.broadcast({
        ...base,
        id: messageId || crypto.randomUUID(),
        type: "text",
        payload: { text },
      });
    }
    for (const [index, imageItem] of imageItems.entries()) {
      try {
        const media = await this.storeImage(
          imageItem,
          account.accountId,
          `${messageId || crypto.randomUUID()}-${index}`,
        );
        this.broadcast({
          ...base,
          id: `${messageId || crypto.randomUUID()}-image-${index}`,
          type: "image",
          payload: media,
        });
      } catch (error) {
        console.warn("Failed to receive Weixin image", error);
      }
    }
  }

  private async seen(key: string) {
    const now = Date.now();
    const seen = await this.state.storage.get<Record<string, number>>(SEEN_KEY) || {};
    for (const [id, expiresAt] of Object.entries(seen)) {
      if (expiresAt <= now) delete seen[id];
    }
    if (seen[key]) return true;
    seen[key] = now + DEDUP_TTL_MS;
    await this.state.storage.put(SEEN_KEY, seen);
    return false;
  }

  private async storeImage(
    imageItem: unknown,
    accountId: string,
    messageId: string,
  ) {
    const maxSizeMb = Number(this.env.MESSAGING_MAX_MEDIA_SIZE_MB || 20);
    const maxSize = Number.isFinite(maxSizeMb) && maxSizeMb > 0
      ? Math.floor(maxSizeMb * 1024 * 1024)
      : DEFAULT_MAX_MEDIA_SIZE;
    const image = await receiveWeixinImage(imageItem, maxSize);
    const mediaTtl = boundedSeconds(
      this.env.MESSAGING_MEDIA_TTL_SECONDS,
      DEFAULT_MEDIA_TTL_SECONDS,
      86_400,
    );
    const urlTtl = Math.min(
      mediaTtl,
      boundedSeconds(
        this.env.MESSAGING_MEDIA_URL_TTL_SECONDS,
        DEFAULT_URL_TTL_SECONDS,
        86_400,
      ),
    );
    const id = randomBase64Url(18);
    const accessToken = randomBase64Url(24);
    const accountHash = await shortHash(accountId);
    const messageHash = await shortHash(messageId);
    const objectKey = `messaging/weixin/${accountHash}/${messageHash}/${id}`;
    const expiresAt = Date.now() + mediaTtl * 1000;
    await this.env.MESSAGING_MEDIA_R2.put(objectKey, image.data, {
      httpMetadata: {
        contentType: image.mimeType,
        contentDisposition: `inline; filename="${image.fileName.replace(/["\\]/g, "_")}"`,
      },
      customMetadata: { expiresAt: String(expiresAt) },
    });
    const mediaObjects = await this.mediaObjects();
    mediaObjects.push({
      id,
      accessToken,
      objectKey,
      fileName: image.fileName,
      mimeType: image.mimeType,
      size: image.data.byteLength,
      expiresAt,
    });
    await this.state.storage.put(MEDIA_KEY, mediaObjects);
    return {
      fileId: id,
      downloadUrl: await this.createMediaUrl(
        { id, accessToken, objectKey, fileName: image.fileName, mimeType: image.mimeType, size: image.data.byteLength, expiresAt },
        urlTtl,
      ),
      fileName: image.fileName,
      mimeType: image.mimeType,
      size: image.data.byteLength,
      expiresAt,
    };
  }

  private async refreshMediaUrl(id: string) {
    const media = (await this.mediaObjects()).find((item) => item.id === id);
    if (!media || media.expiresAt <= Date.now()) {
      return json({ error: "Messaging image expired" }, { status: 404 });
    }
    const ttl = Math.min(
      Math.floor((media.expiresAt - Date.now()) / 1000),
      boundedSeconds(
        this.env.MESSAGING_MEDIA_URL_TTL_SECONDS,
        DEFAULT_URL_TTL_SECONDS,
        86_400,
      ),
    );
    return json({
      url: await this.createMediaUrl(media, ttl),
      expiresAt: media.expiresAt,
    });
  }

  private async createMediaUrl(media: MediaObject, ttl: number) {
    if (
      this.env.R2_ACCOUNT_ID?.trim() &&
      this.env.R2_ACCESS_KEY_ID?.trim() &&
      this.env.R2_SECRET_ACCESS_KEY?.trim() &&
      this.env.R2_BUCKET_NAME?.trim()
    ) {
      return createR2PresignedUrl(
        this.env,
        "GET",
        media.objectKey,
        ttl,
      );
    }
    const base = (this.env.MESSAGING_PUBLIC_URL || "https://api.picbind.com")
      .replace(/\/$/, "");
    const clientId = await this.state.storage.get<string>(CLIENT_ID_KEY);
    if (!clientId) throw new Error("Messaging client ID is unavailable");
    const url = new URL(
      `${base}/api/messaging/weixin/files/${encodeURIComponent(media.id)}`,
    );
    url.searchParams.set("clientId", clientId);
    url.searchParams.set("token", media.accessToken);
    return url.toString();
  }

  private async serveMedia(id: string, token: string) {
    const media = (await this.mediaObjects()).find((item) => item.id === id);
    if (
      !media ||
      media.expiresAt <= Date.now() ||
      token !== media.accessToken
    ) {
      return json({ error: "Messaging image expired" }, { status: 404 });
    }
    const object = await this.env.MESSAGING_MEDIA_R2.get(media.objectKey);
    if (!object) return json({ error: "Messaging image not found" }, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=60");
    return new Response(object.body, { headers });
  }

  private broadcast(message: GatewayMessage) {
    this.broadcastRaw(message);
  }

  private broadcastRaw(message: unknown) {
    const serialized = JSON.stringify(message);
    for (const socket of this.state.getWebSockets("weixin-client")) {
      try {
        socket.send(serialized);
      } catch {
        // Hibernation callbacks remove closed sockets.
      }
    }
  }

  private async cleanupMedia() {
    const now = Date.now();
    const mediaObjects = await this.mediaObjects();
    const expired = mediaObjects.filter((item) => item.expiresAt <= now);
    if (expired.length) {
      await this.env.MESSAGING_MEDIA_R2.delete(
        expired.map((item) => item.objectKey),
      );
      await this.state.storage.put(
        MEDIA_KEY,
        mediaObjects.filter((item) => item.expiresAt > now),
      );
    }
  }

  private mediaObjects() {
    return this.state.storage.get<MediaObject[]>(MEDIA_KEY).then(
      (items) => items || [],
    );
  }

  private async runtime() {
    return await this.state.storage.get<RuntimeState>(RUNTIME_KEY) || {
      enabled: false,
      status: "disconnected" as const,
      failures: 0,
    };
  }

  private async updateRuntime(patch: Partial<RuntimeState>) {
    const runtime = { ...await this.runtime(), ...patch };
    await this.state.storage.put(RUNTIME_KEY, runtime);
    this.broadcastRaw({
      type: "GATEWAY_STATUS",
      payload: await this.snapshot(),
    });
    return runtime;
  }

  private scheduleNext(timestamp: number) {
    return this.state.storage.setAlarm(timestamp);
  }

  private async scheduleMediaCleanupOnly() {
    const media = await this.mediaObjects();
    if (media.length) {
      await this.scheduleNext(
        Math.min(...media.map((item) => item.expiresAt)),
      );
    } else {
      await this.state.storage.deleteAlarm();
    }
  }
}
