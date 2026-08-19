export type RoomEventKind =
  | "connection"
  | "message"
  | "sending"
  | "receiving"
  | "complete"
  | "cancelled"
  | "error";

export type RoomEventItem = {
  id: string;
  kind: RoomEventKind;
  title: string;
  detail?: string;
  progress?: number;
  createdAt: number;
};
