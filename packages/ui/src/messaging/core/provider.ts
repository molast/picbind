import type { MessageHandler, Unsubscribe } from "./event";
import type { MessagingChannel, NormalizedMessage } from "./message";

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

export type MessageImageUploadOptions = {
  recipientId: string;
  fileName?: string;
  onProgress?: (progress: number) => void;
  onRetry?: (retry: {
    failedAttempt: number;
    nextAttempt: number;
    maxAttempts: number;
    delayMs: number;
    error: Error;
  }) => void;
};

export interface MessageProvider {
  readonly id: string;
  readonly channel: MessagingChannel;
  readonly displayName: string;

  getSnapshot(): MessagingProviderSnapshot;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: NormalizedMessage): Promise<void>;
  upload(file: Blob, options: MessageImageUploadOptions): Promise<string>;
  download(fileReference: string, fallbackFileId?: string): Promise<Blob>;
  subscribe(handler: MessageHandler): Unsubscribe;
  subscribeStatus(handler: ProviderStatusHandler): Unsubscribe;
}
