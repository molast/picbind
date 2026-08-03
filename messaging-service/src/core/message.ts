export type MessagingChannel =
  | "wechat"
  | "telegram"
  | "discord"
  | "slack"
  | "web"
  | "mobile";

export type NormalizedMessageType = "text" | "image" | "file";

export type NormalizedMessage = {
  id: string;
  channel: MessagingChannel;
  senderId: string;
  conversationId: string;
  type: NormalizedMessageType;
  payload: {
    text?: string;
    fileId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
  };
  timestamp: number;
};

export type ExternalMessageIdentity = {
  id: string;
  provider: MessagingChannel;
  externalUserId: string;
  externalChatId: string;
  createdAt: number;
};

export type RoomChannelBinding = {
  id: string;
  roomId: string;
  userId: string;
  channel: MessagingChannel;
  createdAt: number;
};
