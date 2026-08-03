import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { CredentialStore } from "./credential-store.js";
import { requestQrCode, requestQrStatus, ILINK_BASE_URL } from "./ilink-client.js";
import { WeixinRuntime } from "./weixin-runtime.js";
import { MediaStore } from "./media-store.js";

type LoginSession = {
  id: string;
  qrcode: string;
  qrDataUrl: string;
  baseUrl: string;
  state: "qr_pending" | "scanned" | "expired" | "confirmed" | "error";
  expiresAt: number;
  error?: string;
};

const host = process.env.PICBIND_MESSAGING_HOST || "127.0.0.1";
const port = Number(process.env.PICBIND_MESSAGING_PORT || 4390);
const store = new CredentialStore();
const mediaStore = new MediaStore(store.root);
const runtime = new WeixinRuntime(store, mediaStore);
const sessions = new Map<string, LoginSession>();
const eventStreams = new Set<ServerResponse>();

function cors(request: IncomingMessage, response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", process.env.PICBIND_MESSAGING_CORS_ORIGIN || request.headers.origin || "*");
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(value);
  }
  if (!chunks.length) return {} as Record<string, unknown>;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function pollLogin(session: LoginSession) {
  if (Date.now() >= session.expiresAt) {
    session.state = "expired";
    return;
  }
  const result = await requestQrStatus(session.qrcode, session.baseUrl);
  if (result.status === "scaned_but_redirect" && result.redirectHost) {
    session.baseUrl = result.redirectHost.startsWith("http")
      ? result.redirectHost
      : `https://${result.redirectHost}`;
    session.state = "scanned";
    return;
  }
  if (result.status === "scaned") session.state = "scanned";
  if (result.status === "expired") session.state = "expired";
  if (result.status !== "confirmed") return;
  if (!result.accountId || !result.token) throw new Error("iLink confirmation did not return credentials");
  await runtime.stop();
  await store.save({
    accountId: result.accountId,
    token: result.token,
    baseUrl: result.baseUrl || session.baseUrl || ILINK_BASE_URL,
    userId: result.userId,
    syncBuffer: "",
    contextTokens: {},
    savedAt: new Date().toISOString(),
  });
  session.state = "confirmed";
  await runtime.start();
}

const server = http.createServer(async (request, response) => {
  cors(request, response);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true, service: "picbind-messaging-gateway" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/providers/weixin") {
      json(response, 200, await runtime.snapshot());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/providers/weixin/login") {
      const qr = await requestQrCode();
      const session: LoginSession = {
        id: randomUUID(),
        qrcode: qr.value,
        qrDataUrl: await QRCode.toDataURL(qr.scanData, { width: 280, margin: 1, errorCorrectionLevel: "M" }),
        baseUrl: ILINK_BASE_URL,
        state: "qr_pending",
        expiresAt: Date.now() + 8 * 60 * 1000,
      };
      sessions.set(session.id, session);
      json(response, 201, { sessionId: session.id, state: session.state, qrDataUrl: session.qrDataUrl, expiresAt: session.expiresAt });
      return;
    }
    const loginMatch = url.pathname.match(/^\/v1\/providers\/weixin\/login\/([^/]+)$/);
    if (request.method === "GET" && loginMatch) {
      const session = sessions.get(loginMatch[1]);
      if (!session) {
        json(response, 404, { error: "Login session not found" });
        return;
      }
      try {
        if (!new Set(["expired", "confirmed", "error"]).has(session.state)) await pollLogin(session);
      } catch (reason) {
        session.state = "error";
        session.error = reason instanceof Error ? reason.message : String(reason);
      }
      json(response, 200, { sessionId: session.id, state: session.state, expiresAt: session.expiresAt, error: session.error });
      if (session.state === "confirmed" || session.state === "expired") sessions.delete(session.id);
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/providers/weixin/connect") {
      await runtime.start();
      json(response, 200, await runtime.snapshot());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/providers/weixin/disconnect") {
      await runtime.stop();
      json(response, 200, await runtime.snapshot());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/providers/weixin/messages") {
      json(response, 202, await runtime.send(await readBody(request)));
      return;
    }
    const mediaMatch = url.pathname.match(/^\/v1\/providers\/weixin\/files\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && mediaMatch) {
      const media = await mediaStore.read(mediaMatch[1]);
      response.statusCode = 200;
      response.setHeader("Content-Type", media.metadata.mimeType);
      response.setHeader("Content-Length", media.metadata.size);
      response.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(media.metadata.fileName)}`,
      );
      response.end(media.data);
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/providers/weixin/events") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();
      response.write(": connected\n\n");
      eventStreams.add(response);
      const unsubscribe = runtime.subscribe((message) => response.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        eventStreams.delete(response);
      });
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    json(response, message.includes("not been configured") ? 409 : 500, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`PicBind Messaging Gateway listening on http://${host}:${port}`);
  void store.load().then((account) => {
    if (account) return runtime.start();
    return undefined;
  }).catch((error) => {
    console.error("Failed to restore Weixin iLink polling", error);
  });
});

async function shutdown() {
  await runtime.stop();
  for (const stream of eventStreams) stream.end();
  eventStreams.clear();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
