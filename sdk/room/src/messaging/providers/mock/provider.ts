import type { MessageHandler, Unsubscribe } from "../../core/event";
import type { MessagingChannel, NormalizedMessage } from "../../core/message";
import type {
  MessageProvider,
  MessageProviderStatus,
  MessagingProviderSnapshot,
  ProviderStatusHandler,
} from "../../core/provider";

export class MockMessageProvider implements MessageProvider {
  private status: MessageProviderStatus = "disconnected";
  private readonly messages = new Set<MessageHandler>();
  private readonly statuses = new Set<ProviderStatusHandler>();
  private readonly files = new Map<string, Blob>();
  readonly sentMessages: NormalizedMessage[] = [];

  constructor(
    readonly id = "mock",
    readonly channel: MessagingChannel = "web",
    readonly displayName = "Mock Provider",
  ) {}

  getSnapshot(): MessagingProviderSnapshot {
    return {
      id: this.id,
      channel: this.channel,
      displayName: this.displayName,
      status: this.status,
    };
  }

  async start() {
    this.setStatus("connected");
  }

  async stop() {
    this.setStatus("disconnected");
  }

  async send(message: NormalizedMessage) {
    this.assertConnected();
    this.sentMessages.push(message);
  }

  async upload(file: Blob) {
    this.assertConnected();
    const id = crypto.randomUUID().replace(/-/g, "");
    this.files.set(id, file);
    return id;
  }

  async download(fileId: string) {
    this.assertConnected();
    const file = this.files.get(fileId);
    if (!file) throw new Error(`Mock file "${fileId}" was not found`);
    return file;
  }

  emit(message: NormalizedMessage) {
    this.assertConnected();
    for (const handler of this.messages) handler(message);
  }

  subscribe(handler: MessageHandler): Unsubscribe {
    this.messages.add(handler);
    return () => this.messages.delete(handler);
  }

  subscribeStatus(handler: ProviderStatusHandler): Unsubscribe {
    this.statuses.add(handler);
    return () => this.statuses.delete(handler);
  }

  private assertConnected() {
    if (this.status !== "connected") {
      throw new Error(`${this.displayName} is not connected`);
    }
  }

  private setStatus(status: MessageProviderStatus) {
    this.status = status;
    const snapshot = this.getSnapshot();
    for (const handler of this.statuses) handler(snapshot);
  }
}
