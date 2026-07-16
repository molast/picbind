import type { CachedRoomImage } from "@/utils/realtime-image-store";

export type ConnectionState = "waiting" | "connecting" | "connected" | "error";

export type ActivityItem = {
  id: string;
  kind:
    | "connection"
    | "message"
    | "sending"
    | "receiving"
    | "complete"
    | "cancelled"
    | "error";
  title: string;
  detail?: string;
  progress?: number;
  createdAt: number;
};

export type RoomImage = CachedRoomImage & {
  url: string;
};

export type FloatingEmoji = {
  id: string;
  emoji: string;
  startX: number;
  path: string;
  duration: number;
};
