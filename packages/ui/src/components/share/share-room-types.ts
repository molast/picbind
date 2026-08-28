import type { CachedRoomImage } from "../../utils/realtime-image-store";
import type { RoomEventItem } from "../../utils/room-event";

export type ConnectionState = "waiting" | "connecting" | "connected" | "error";
export type MessageTransportMode = "p2p" | "relay";
export type RoomRole = "owner" | "guest";

export type RoomMemberPresence = {
  clientId: string;
  role: RoomRole;
  status: "online" | "offline";
  leftAt?: number;
};

export type ActivityItem = RoomEventItem;

export type RoomImage = CachedRoomImage & {
  url: string;
  thumbnailUrl?: string;
};

export type ImageReactionSignal = {
  sequence: number;
  count: number;
};

export type FloatingEmoji = {
  id: string;
  emoji: string;
  startX: number;
  path: string;
  duration: number;
};

export type RoomDockNotification = {
  id: string;
  kind: "emoji" | "text" | "image";
  label: string;
  createdAt: number;
};
