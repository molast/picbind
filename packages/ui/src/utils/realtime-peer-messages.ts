"use client";

import type { RealtimeMessageChannel } from "./realtime-message-channel";

export const TEST_EMOJIS = [
  "👋",
  "👍",
  "🎉",
  "❤️",
  "🔥",
  "👏",
  "😂",
  "😍",
  "🥳",
  "🤩",
  "💯",
  "✨",
  "🙌",
  "😎",
  "🤝",
  "🚀",
] as const;

export type PeerMessage =
  | { type: "HELLO"; payload: { id: string } }
  | { type: "HELLO_ACK"; payload: { replyTo: string } }
  | {
      type: "EMOJI";
      payload: { id: string; emoji: string; sentAt: number };
    }
  | {
      type: "TEXT";
      payload: { id: string; text: string; sentAt: number };
    }
  | { type: "MESSAGE_ACK"; payload: { replyTo: string } };

export function createPeerMessageId() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function sendPeerMessage(
  channel: RealtimeMessageChannel | null,
  message: PeerMessage,
) {
  if (channel?.readyState !== "open") {
    return false;
  }
  channel.send(JSON.stringify(message));
  return true;
}

export function parsePeerMessage(data: string): PeerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !("type" in value)) {
    return null;
  }

  const message = value as Partial<PeerMessage> & {
    payload?: Record<string, unknown>;
  };
  if (
    message.type === "HELLO" &&
    typeof message.payload?.id === "string"
  ) {
    return { type: "HELLO", payload: { id: message.payload.id } };
  }
  if (
    message.type === "HELLO_ACK" &&
    typeof message.payload?.replyTo === "string"
  ) {
    return {
      type: "HELLO_ACK",
      payload: { replyTo: message.payload.replyTo },
    };
  }
  if (
    message.type === "EMOJI" &&
    typeof message.payload?.id === "string" &&
    typeof message.payload?.emoji === "string" &&
    typeof message.payload?.sentAt === "number"
  ) {
    return {
      type: "EMOJI",
      payload: {
        id: message.payload.id,
        emoji: message.payload.emoji,
        sentAt: message.payload.sentAt,
      },
    };
  }
  if (
    message.type === "TEXT" &&
    typeof message.payload?.id === "string" &&
    typeof message.payload?.text === "string" &&
    message.payload.text.trim().length > 0 &&
    message.payload.text.length <= 200 &&
    typeof message.payload?.sentAt === "number"
  ) {
    return {
      type: "TEXT",
      payload: {
        id: message.payload.id,
        text: message.payload.text,
        sentAt: message.payload.sentAt,
      },
    };
  }
  if (
    message.type === "MESSAGE_ACK" &&
    typeof message.payload?.replyTo === "string"
  ) {
    return {
      type: "MESSAGE_ACK",
      payload: { replyTo: message.payload.replyTo },
    };
  }
  return null;
}
