import type { NormalizedMessage } from "./message";

export type MessageHandler = (message: NormalizedMessage) => void;
export type Unsubscribe = () => void;

export class MessageEventDispatcher {
  private readonly handlers = new Set<MessageHandler>();

  subscribe(handler: MessageHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispatch(message: NormalizedMessage) {
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("Messaging event handler failed", error);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}
