import type { MessageHandler, Unsubscribe } from "./event.js";
import type { MessagingChannel, NormalizedMessage } from "./message.js";

export type MessageProviderStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type MessagingProviderSnapshot = {
  id: string;
  channel: MessagingChannel;
  displayName: string;
  status: MessageProviderStatus;
  recipientId?: string;
  textOnly?: boolean;
  error?: string;
};

export type ProviderStatusHandler = (
  snapshot: MessagingProviderSnapshot,
) => void;

export interface MessageProvider {
  readonly id: string;
  readonly channel: MessagingChannel;
  readonly displayName: string;

  getSnapshot(): MessagingProviderSnapshot;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: NormalizedMessage): Promise<void>;
  upload(file: Blob): Promise<string>;
  download(fileId: string): Promise<Blob>;
  subscribe(handler: MessageHandler): Unsubscribe;
  subscribeStatus(handler: ProviderStatusHandler): Unsubscribe;
}
