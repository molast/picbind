import { randomUUID } from "node:crypto";
import { CredentialStore, type StoredIlinkAccount } from "./credential-store.js";
import { getUpdates, sendTextMessage } from "./ilink-client.js";
import { MediaStore } from "./media-store.js";
import { receiveWeixinImage } from "./weixin-media.js";

export type GatewayMessage = {
  id: string;
  channel: "wechat";
  senderId: string;
  conversationId: string;
  type: "text" | "image";
  payload: {
    text?: string;
    fileId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
  };
  timestamp: number;
};

export type RuntimeStatus = "disconnected" | "connecting" | "connected" | "error";

type JsonRecord = Record<string, unknown>;
type MessageListener = (message: GatewayMessage) => void;

const DEDUP_TTL_MS = 5 * 60 * 1000;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function extractText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  for (const candidate of items) {
    const item = record(candidate);
    if (Number(item.type) !== 1) continue;
    const text = String(record(item.text_item).text || "").trim();
    if (text) return text;
  }
  return "";
}

export class WeixinRuntime {
  private account: StoredIlinkAccount | null = null;
  private status: RuntimeStatus = "disconnected";
  private error: string | undefined;
  private controller: AbortController | null = null;
  private pollTask: Promise<void> | null = null;
  private releaseProcessLock: (() => Promise<void>) | null = null;
  private readonly listeners = new Set<MessageListener>();
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly store: CredentialStore,
    private readonly mediaStore: MediaStore,
  ) {}

  async snapshot() {
    const account = this.account || await this.store.load();
    return {
      configured: Boolean(account),
      status: this.status,
      accountId: account?.accountId,
      userId: account?.userId,
      error: this.error,
    };
  }

  async start() {
    if (this.pollTask) return;
    this.account = await this.store.load();
    if (!this.account) throw new Error("Weixin iLink has not been configured");
    this.releaseProcessLock = await this.store.acquireProcessLock();
    this.status = "connecting";
    this.error = undefined;
    this.controller = new AbortController();
    this.status = "connected";
    this.pollTask = this.poll(this.controller.signal).finally(() => {
      this.pollTask = null;
      this.controller = null;
      if (this.status !== "error") this.status = "disconnected";
    });
  }

  async stop() {
    this.controller?.abort();
    await this.pollTask?.catch(() => undefined);
    await this.releaseProcessLock?.();
    this.releaseProcessLock = null;
    this.status = "disconnected";
    this.error = undefined;
  }

  subscribe(listener: MessageListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(message: JsonRecord) {
    const account = this.account || await this.store.load();
    if (!account) throw new Error("Weixin iLink has not been configured");
    const toUserId = String(message.conversationId || message.toUserId || "").trim();
    const text = String(record(message.payload).text || message.text || "").trim();
    if (!toUserId || !text) throw new Error("conversationId and text are required");
    const response = await sendTextMessage(
      account.baseUrl,
      account.token,
      toUserId,
      text,
      account.contextTokens?.[toUserId],
    );
    const ret = Number(response.ret || response.errcode || 0);
    if (ret !== 0) throw new Error(`iLink sendmessage failed: ${String(response.errmsg || ret)}`);
    return { id: String(response.message_id || randomUUID()) };
  }

  private async poll(signal: AbortSignal) {
    let failures = 0;
    while (!signal.aborted && this.account) {
      try {
        const response = await getUpdates(
          this.account.baseUrl,
          this.account.token,
          this.account.syncBuffer || "",
          signal,
        );
        const ret = Number(response.ret || response.errcode || 0);
        const errorMessage = String(response.errmsg || "");
        if (ret !== 0) {
          if (ret === -14 || (ret === -2 && errorMessage.toLowerCase() === "unknown error")) {
            throw new Error("iLink session expired; scan the QR code again");
          }
          throw new Error(`iLink getupdates failed: ${errorMessage || ret}`);
        }
        failures = 0;
        const nextBuffer = String(response.get_updates_buf || "");
        let dirty = Boolean(nextBuffer && nextBuffer !== this.account.syncBuffer);
        if (nextBuffer) this.account.syncBuffer = nextBuffer;
        const messages = Array.isArray(response.msgs) ? response.msgs : [];
        for (const rawMessage of messages) {
          dirty = await this.acceptMessage(record(rawMessage), signal) || dirty;
        }
        if (dirty) await this.store.save(this.account);
      } catch (reason) {
        if (signal.aborted) return;
        failures += 1;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message.includes("session expired")) {
          this.status = "error";
          this.error = message;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, failures >= 3 ? 30_000 : 2_000));
        if (failures >= 3) failures = 0;
      }
    }
  }

  private async acceptMessage(message: JsonRecord, signal: AbortSignal) {
    if (!this.account) return false;
    const senderId = String(message.from_user_id || "").trim();
    if (!senderId || senderId === this.account.accountId) return false;
    const items = Array.isArray(message.item_list) ? message.item_list : [];
    const text = extractText(items);
    const imageItems = items.filter((item) => Number(record(item).type) === 2);
    if (!text && !imageItems.length) return false;
    const now = Date.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
    const messageId = String(message.message_id || "").trim();
    const firstImageMedia = record(record(record(imageItems[0]).image_item).media);
    const contentKey = text
      ? `text:${senderId}\u0000${text}`
      : `image:${senderId}\u0000${String(firstImageMedia.encrypt_query_param || firstImageMedia.full_url || "")}`;
    if ((messageId && this.seen.has(`id:${messageId}`)) || this.seen.has(contentKey)) {
      return false;
    }
    if (messageId) this.seen.set(`id:${messageId}`, now + DEDUP_TTL_MS);
    this.seen.set(contentKey, now + DEDUP_TTL_MS);

    const contextToken = String(message.context_token || "").trim();
    if (contextToken) {
      this.account.contextTokens ||= {};
      this.account.contextTokens[senderId] = contextToken;
    }
    const timestamp = (() => {
      const value = Number(message.create_time_ms || message.create_time || now);
      return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
    })();
    const base = {
      channel: "wechat" as const,
      senderId,
      conversationId: String(message.group_id || senderId),
      timestamp,
    };
    if (text) {
      this.emit({
        ...base,
        id: messageId || randomUUID(),
        type: "text",
        payload: { text },
      });
    }
    for (const [index, imageItem] of imageItems.entries()) {
      try {
        const image = await receiveWeixinImage(imageItem, signal);
        const stored = await this.mediaStore.save(image.data, image.fileName, image.mimeType);
        this.emit({
          ...base,
          id: `${messageId || randomUUID()}-image-${index}`,
          type: "image",
          payload: {
            fileId: stored.id,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            size: stored.size,
          },
        });
      } catch (error) {
        console.warn("Failed to receive Weixin image", error);
      }
    }
    return Boolean(contextToken);
  }

  private emit(message: GatewayMessage) {
    for (const listener of this.listeners) listener(message);
  }
}
