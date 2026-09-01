import type { CachedWorkspaceImage } from "../../database/types/storage";

export type ConnectionState = "waiting" | "connecting" | "connected" | "error";
export type MessageTransportMode = "p2p" | "relay";
export type WorkspaceEditorRole = "owner" | "guest";

export type WorkspaceMemberPresence = {
  clientId: string;
  role: WorkspaceEditorRole;
  status: "online" | "offline";
  leftAt?: number;
};

export type WorkspaceEditorImage = CachedWorkspaceImage & {
  url: string;
  thumbnailUrl?: string;
};
