import type { MessageHandler } from "../../core/event";
import type { NormalizedMessage } from "../../core/message";
import type { MessageImageUploadOptions } from "../../core/provider";
import QRCode from "qrcode";
import type {
  IlinkGatewaySnapshot,
  IlinkGatewayTransport,
  IlinkLoginSession,
} from "./provider";
import { checkWorkerVersion } from "../../../worker-version";
import { uploadFileToR2 } from "../../../utils/realtime-r2-transfer";

type SocketResult = {
  type: "REQUEST_RESULT";
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

type PendingSocketRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: number;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Messaging Gateway HTTP ${response.status}`);
  return body;
}

export class IlinkHttpGatewayTransport implements IlinkGatewayTransport {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private stopped = true;
  private messageHandler: MessageHandler | null = null;
  private statusHandler: ((snapshot: IlinkGatewaySnapshot) => void) | null = null;
  private readonly pendingRequests = new Map<string, PendingSocketRequest>();
  private readonly clientId = messagingClientId();

  constructor(private readonly gatewayUrl: string) {}

  getStatus() {
    return this.request<IlinkGatewaySnapshot>("/status");
  }

  async startLogin() {
    const session = await this.request<IlinkLoginSession>("/login", {
      method: "POST",
    });
    if (!session.qrDataUrl && session.qrData) {
      session.qrDataUrl = await QRCode.toDataURL(session.qrData, {
        width: 280,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    }
    return session;
  }

  getLoginStatus(sessionId: string) {
    return this.request<IlinkLoginSession>(`/login/${encodeURIComponent(sessionId)}`);
  }

  async connect(
    onMessage: MessageHandler,
    onStatus?: (snapshot: IlinkGatewaySnapshot) => void,
  ) {
    await this.request<IlinkGatewaySnapshot>("/connect", { method: "POST" });
    this.stopped = false;
    this.messageHandler = onMessage;
    this.statusHandler = onStatus || null;
    await this.openSocket();
  }

  async disconnect() {
    this.stopped = true;
    this.messageHandler = null;
    this.statusHandler = null;
    this.clearTimers();
    this.socket?.close(1000, "Messaging provider disconnected");
    this.socket = null;
    await this.request<IlinkGatewaySnapshot>("/disconnect", { method: "POST" });
  }

  async send(message: NormalizedMessage) {
    await this.request<{ id: string }>("/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }

  async upload(file: Blob, options: MessageImageUploadOptions): Promise<string> {
    const fileName = options.fileName || (file instanceof File ? file.name : "image");
    const image = file instanceof File
      ? file
      : new File([file], fileName, { type: file.type });
    const preparation = await this.socketRequest<{
      objectKey: string;
      uploadUrl: string;
      expiresAt: number;
    }>("PREPARE_IMAGE_UPLOAD", {
      name: fileName,
      mimeType: image.type,
      size: image.size,
    });
    await uploadFileToR2(
      preparation.uploadUrl,
      image,
      ({ progress }) => options.onProgress?.(progress),
      undefined,
      options.onRetry,
    );
    const sent = await this.socketRequest<{ id: string }>("SEND_IMAGE", {
      objectKey: preparation.objectKey,
      recipientId: options.recipientId,
      name: fileName,
      mimeType: image.type,
      size: image.size,
    }, 180_000);
    return sent.id;
  }

  async download(reference: string, fallbackFileId?: string): Promise<Blob> {
    let downloadUrl = reference;
    if (!/^https:\/\//i.test(downloadUrl)) {
      const refreshed = await this.refreshDownloadUrl(reference);
      downloadUrl = refreshed.url;
    }
    let response: Response | null = null;
    let usedProxy = false;
    try {
      response = await fetch(downloadUrl);
    } catch {
      if (!fallbackFileId) throw new Error("Messaging image download failed");
      const refreshed = await this.refreshDownloadUrl(fallbackFileId, true);
      usedProxy = true;
      response = await fetch(refreshed.url);
    }
    if (!response.ok && fallbackFileId && !usedProxy) {
      const refreshed = await this.refreshDownloadUrl(fallbackFileId, true);
      response = await fetch(refreshed.url);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `Messaging Gateway HTTP ${response.status}` })) as { error?: string };
      throw new Error(body.error || `Messaging Gateway HTTP ${response.status}`);
    }
    return response.blob();
  }

  private refreshDownloadUrl(fileId: string, forceProxy = false) {
    const proxy = forceProxy ? "?proxy=1" : "";
    return this.request<{ url: string }>(
      `/files/${encodeURIComponent(fileId)}${proxy}`,
    );
  }

  private async request<T>(path: string, init?: RequestInit) {
    const response = await fetch(this.url(path), init);
    checkWorkerVersion(response);
    return responseJson<T>(response);
  }

  private url(path: string) {
    const base = this.gatewayUrl.replace(/\/$/, "");
    const messagingBase = base.endsWith("/api/messaging/weixin")
      ? base
      : `${base}/api/messaging/weixin`;
    const url = new URL(`${messagingBase}${path}`);
    url.searchParams.set("clientId", this.clientId);
    return url.toString();
  }

  private socketUrl() {
    const url = new URL(this.url("/socket"));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  private openSocket() {
    this.socket?.close();
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.socketUrl());
      this.socket = socket;
      let settled = false;
      socket.onopen = () => {
        settled = true;
        this.reconnectAttempts = 0;
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          const value = JSON.parse(String(event.data)) as
            | NormalizedMessage
            | { type: "GATEWAY_STATUS"; payload: IlinkGatewaySnapshot }
            | SocketResult;
          if (value.type === "GATEWAY_STATUS") {
            this.statusHandler?.(value.payload);
          } else if (value.type === "REQUEST_RESULT") {
            this.settleSocketRequest(value);
          } else {
            this.messageHandler?.(value);
          }
        } catch (error) {
          console.error("Invalid message from PicBind Messaging Worker", error);
        }
      };
      socket.onerror = () => {
        if (!settled) reject(new Error("Messaging WebSocket connection failed"));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.rejectPendingRequests("Messaging WebSocket connection closed");
        if (!settled) {
          reject(new Error("Messaging WebSocket connection closed"));
        } else if (!this.stopped) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private clearTimers() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private socketRequest<T>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 30_000,
  ) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject<T>(new Error("Messaging WebSocket is not connected"));
    }
    const requestId = crypto.randomUUID().replace(/-/g, "");
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Messaging request timed out"));
      }, timeoutMs);
      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        socket.send(JSON.stringify({ type, requestId, payload }));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private settleSocketRequest(result: SocketResult) {
    const pending = this.pendingRequests.get(result.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pendingRequests.delete(result.requestId);
    if (result.ok) pending.resolve(result.payload);
    else pending.reject(new Error(result.error || "Messaging request failed"));
  }

  private rejectPendingRequests(message: string) {
    for (const pending of this.pendingRequests.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pendingRequests.clear();
  }
}

function messagingClientId() {
  const storageKey = "picbind:messaging-client-id";
  if (typeof window !== "undefined") {
    try {
      const current = window.localStorage.getItem(storageKey);
      if (current && /^[a-f0-9]{32}$/.test(current)) return current;
      const created = crypto.randomUUID().replace(/-/g, "");
      window.localStorage.setItem(storageKey, created);
      return created;
    } catch {
      return crypto.randomUUID().replace(/-/g, "");
    }
  }
  return crypto.randomUUID().replace(/-/g, "");
}
