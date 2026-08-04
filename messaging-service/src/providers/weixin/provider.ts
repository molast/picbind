import type { MessageHandler, Unsubscribe } from "../../core/event.js";
import type { NormalizedMessage } from "../../core/message.js";
import type {
  MessageProvider,
  MessageProviderStatus,
  MessagingProviderSnapshot,
  ProviderStatusHandler,
} from "../../core/provider.js";

export type IlinkAccountCredentials = {
  accountId: string;
  token: string;
  baseUrl?: string;
  cdnBaseUrl?: string;
};

export type IlinkGatewaySnapshot = {
  configured: boolean;
  status: "disconnected" | "connecting" | "connected" | "error";
  accountId?: string;
  userId?: string;
  error?: string;
};

export type IlinkLoginSession = {
  sessionId: string;
  state: "qr_pending" | "scanned" | "expired" | "confirmed" | "error";
  qrDataUrl?: string;
  expiresAt: number;
  error?: string;
};

export type IlinkGatewayTransport = {
  getStatus(): Promise<IlinkGatewaySnapshot>;
  startLogin(): Promise<IlinkLoginSession>;
  getLoginStatus(sessionId: string): Promise<IlinkLoginSession>;
  connect(onMessage: MessageHandler): Promise<void>;
  disconnect(): Promise<void>;
  send(message: NormalizedMessage): Promise<void>;
  upload(file: Blob): Promise<string>;
  download(fileId: string): Promise<Blob>;
};

/**
 * Browser-side adapter for a trusted PicBind Messaging Gateway.
 * The gateway owns iLink credentials, QR login, long polling and media crypto.
 */
export class WeixinIlinkProvider implements MessageProvider {
  readonly id = "weixin-ilink";
  readonly channel = "wechat" as const;
  readonly displayName = "Weixin";

  private status: MessageProviderStatus = "disconnected";
  private error: string | undefined;
  private recipientId: string | undefined;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly statusHandlers = new Set<ProviderStatusHandler>();

  constructor(private readonly transport: IlinkGatewayTransport) {}

  getGatewayStatus() {
    return this.transport.getStatus();
  }

  startLogin() {
    return this.transport.startLogin();
  }

  getLoginStatus(sessionId: string) {
    return this.transport.getLoginStatus(sessionId);
  }

  getSnapshot(): MessagingProviderSnapshot {
    return {
      id: this.id,
      channel: this.channel,
      displayName: this.displayName,
      status: this.status,
      textOnly: true,
      ...(this.recipientId ? { recipientId: this.recipientId } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  async start() {
    if (this.status === "connected" || this.status === "connecting") return;
    this.setStatus("connecting");
    try {
      const gateway = await this.transport.getStatus();
      this.recipientId = gateway.userId;
      await this.transport.connect((message) => {
        const normalized = { ...message, channel: this.channel };
        if (normalized.conversationId) {
          this.recipientId = normalized.conversationId;
          this.notifySnapshot();
        }
        for (const handler of this.messageHandlers) handler(normalized);
      });
      this.setStatus("connected");
    } catch (error) {
      this.setStatus(
        "error",
        error instanceof Error ? error.message : "Weixin iLink connection failed",
      );
      throw error;
    }
  }

  async stop() {
    try {
      await this.transport.disconnect();
    } finally {
      this.setStatus("disconnected");
    }
  }

  async send(message: NormalizedMessage) {
    this.assertConnected();
    await this.transport.send({ ...message, channel: this.channel });
  }

  async upload(file: Blob) {
    this.assertConnected();
    return this.transport.upload(file);
  }

  async download(fileId: string) {
    this.assertConnected();
    return this.transport.download(fileId);
  }

  subscribe(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  subscribeStatus(handler: ProviderStatusHandler): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private assertConnected() {
    if (this.status !== "connected") {
      throw new Error("Weixin iLink provider is not connected");
    }
  }

  private setStatus(status: MessageProviderStatus, error?: string) {
    this.status = status;
    this.error = error;
    this.notifySnapshot();
  }

  private notifySnapshot() {
    const snapshot = this.getSnapshot();
    for (const handler of this.statusHandlers) handler(snapshot);
  }
}
