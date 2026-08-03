import { MessageEventDispatcher } from "../core/event.js";
import type { MessageHandler, Unsubscribe } from "../core/event.js";
import type { NormalizedMessage } from "../core/message.js";
import type {
  MessageProvider,
  MessagingProviderSnapshot,
  ProviderStatusHandler,
} from "../core/provider.js";

export class MessagingService {
  private readonly providers = new Map<string, MessageProvider>();
  private readonly providerSubscriptions = new Map<string, Unsubscribe>();
  private readonly dispatcher = new MessageEventDispatcher();
  private readonly statusHandlers = new Set<ProviderStatusHandler>();

  constructor(providers: MessageProvider[] = []) {
    for (const provider of providers) this.registerProvider(provider);
  }

  registerProvider(provider: MessageProvider) {
    if (this.providers.has(provider.id)) {
      throw new Error(`Messaging provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
    const unsubscribeMessage = provider.subscribe((message) => {
      this.dispatcher.dispatch(message);
    });
    const unsubscribeStatus = provider.subscribeStatus((snapshot) => {
      for (const handler of this.statusHandlers) handler(snapshot);
    });
    this.providerSubscriptions.set(provider.id, () => {
      unsubscribeMessage();
      unsubscribeStatus();
    });
    return () => this.unregisterProvider(provider.id);
  }

  async unregisterProvider(providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider) return;
    await provider.stop();
    this.providerSubscriptions.get(providerId)?.();
    this.providerSubscriptions.delete(providerId);
    this.providers.delete(providerId);
  }

  getProviders(): MessagingProviderSnapshot[] {
    return [...this.providers.values()].map((provider) => provider.getSnapshot());
  }

  getProvider(providerId: string) {
    return this.providers.get(providerId);
  }

  async startProvider(providerId: string) {
    await this.requireProvider(providerId).start();
  }

  async stopProvider(providerId: string) {
    await this.requireProvider(providerId).stop();
  }

  async send(providerId: string, message: NormalizedMessage) {
    await this.requireProvider(providerId).send(message);
  }

  async upload(providerId: string, file: Blob) {
    return this.requireProvider(providerId).upload(file);
  }

  async download(providerId: string, fileId: string) {
    return this.requireProvider(providerId).download(fileId);
  }

  subscribe(handler: MessageHandler) {
    return this.dispatcher.subscribe(handler);
  }

  subscribeStatus(handler: ProviderStatusHandler): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private requireProvider(providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Messaging provider "${providerId}" is not registered`);
    }
    return provider;
  }
}
