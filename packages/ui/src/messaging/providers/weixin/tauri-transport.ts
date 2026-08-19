import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import type { MessageHandler } from "../../core/event";
import type { NormalizedMessage } from "../../core/message";
import type { MessageImageUploadOptions } from "../../core/provider";
import type {
  IlinkGatewaySnapshot,
  IlinkGatewayTransport,
  IlinkLoginSession,
} from "./provider";

type MessagingEvent =
  | { type: "GATEWAY_STATUS"; payload: IlinkGatewaySnapshot }
  | { type: "MESSAGE"; payload: NormalizedMessage }
  | { type: "ERROR"; payload: string };

const EVENT_POLL_INTERVAL_MS = 250;

export class IlinkTauriTransport implements IlinkGatewayTransport {
  private messageHandler: MessageHandler | null = null;
  private statusHandler: ((snapshot: IlinkGatewaySnapshot) => void) | null = null;
  private eventTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  getStatus() {
    return invoke<IlinkGatewaySnapshot>("messaging_status");
  }

  async startLogin() {
    const session = await invoke<IlinkLoginSession>("messaging_start_login");
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
    return invoke<IlinkLoginSession>("messaging_login_status", { sessionId });
  }

  async connect(
    onMessage: MessageHandler,
    onStatus?: (snapshot: IlinkGatewaySnapshot) => void,
  ) {
    this.messageHandler = onMessage;
    this.statusHandler = onStatus || null;
    this.stopped = false;
    try {
      await invoke("messaging_connect");
      this.scheduleEventPoll(0);
    } catch (error) {
      this.stopped = true;
      this.messageHandler = null;
      this.statusHandler = null;
      throw error;
    }
  }

  async disconnect() {
    this.stopped = true;
    this.messageHandler = null;
    this.statusHandler = null;
    if (this.eventTimer) clearTimeout(this.eventTimer);
    this.eventTimer = null;
    await invoke("messaging_disconnect");
  }

  async send(message: NormalizedMessage) {
    await invoke("messaging_send_text", { message });
  }

  async upload(file: Blob, options: MessageImageUploadOptions) {
    options.onProgress?.(0);
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const id = await invoke<string>("messaging_send_image", {
      upload: {
        recipientId: options.recipientId,
        fileName: options.fileName || (file instanceof File ? file.name : "image"),
        mimeType: file.type || "application/octet-stream",
        bytes,
      },
    });
    options.onProgress?.(1);
    return id;
  }

  async download(reference: string, fallbackFileId?: string) {
    const bytes = await invoke<number[]>("messaging_download_image", {
      reference,
      fallbackFileId,
    });
    return new Blob([new Uint8Array(bytes)], {
      type: "application/octet-stream",
    });
  }

  private scheduleEventPoll(delay = EVENT_POLL_INTERVAL_MS) {
    if (this.stopped) return;
    this.eventTimer = setTimeout(() => void this.pollEvents(), delay);
  }

  private async pollEvents() {
    if (this.stopped) return;
    try {
      const events = await invoke<MessagingEvent[]>("messaging_take_events");
      for (const event of events) {
        if (event.type === "MESSAGE") this.messageHandler?.(event.payload);
        else if (event.type === "GATEWAY_STATUS") this.statusHandler?.(event.payload);
        else console.warn("Weixin iLink:", event.payload);
      }
    } catch (error) {
      console.warn("Unable to read Weixin iLink events", error);
    } finally {
      this.scheduleEventPoll();
    }
  }
}
