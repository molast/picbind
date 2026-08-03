import type { MessageHandler } from "../../core/event.js";
import type { NormalizedMessage } from "../../core/message.js";
import type {
  IlinkGatewaySnapshot,
  IlinkGatewayTransport,
  IlinkLoginSession,
} from "./provider.js";

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Messaging Gateway HTTP ${response.status}`);
  return body;
}

export class IlinkHttpGatewayTransport implements IlinkGatewayTransport {
  private events: EventSource | null = null;

  constructor(private readonly gatewayUrl: string) {}

  getStatus() {
    return this.request<IlinkGatewaySnapshot>("/v1/providers/weixin");
  }

  startLogin() {
    return this.request<IlinkLoginSession>("/v1/providers/weixin/login", { method: "POST" });
  }

  getLoginStatus(sessionId: string) {
    return this.request<IlinkLoginSession>(`/v1/providers/weixin/login/${encodeURIComponent(sessionId)}`);
  }

  async connect(onMessage: MessageHandler) {
    await this.request<IlinkGatewaySnapshot>("/v1/providers/weixin/connect", { method: "POST" });
    this.events?.close();
    const source = new EventSource(this.url("/v1/providers/weixin/events"));
    this.events = source;
    source.addEventListener("message", (event) => {
      try {
        onMessage(JSON.parse((event as MessageEvent<string>).data) as NormalizedMessage);
      } catch (error) {
        console.error("Invalid message from PicBind Messaging Gateway", error);
      }
    });
    await new Promise<void>((resolve, reject) => {
      source.onopen = () => resolve();
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) reject(new Error("Messaging Gateway event stream closed"));
      };
    });
  }

  async disconnect() {
    this.events?.close();
    this.events = null;
    await this.request<IlinkGatewaySnapshot>("/v1/providers/weixin/disconnect", { method: "POST" });
  }

  async send(message: NormalizedMessage) {
    await this.request<{ id: string }>("/v1/providers/weixin/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }

  async upload(_file: Blob): Promise<string> {
    throw new Error("Weixin iLink media upload is not implemented yet");
  }

  async download(fileId: string): Promise<Blob> {
    const response = await fetch(
      this.url(`/v1/providers/weixin/files/${encodeURIComponent(fileId)}`),
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `Messaging Gateway HTTP ${response.status}` })) as { error?: string };
      throw new Error(body.error || `Messaging Gateway HTTP ${response.status}`);
    }
    return response.blob();
  }

  private async request<T>(path: string, init?: RequestInit) {
    return responseJson<T>(await fetch(this.url(path), init));
  }

  private url(path: string) {
    return `${this.gatewayUrl.replace(/\/$/, "")}${path}`;
  }
}
