export type RealtimeFrame =
  | { kind: "text"; data: string }
  | { kind: "binary"; data: ArrayBuffer };

export type RealtimeSessionState =
  | "idle"
  | "connecting"
  | "socket"
  | "rtc"
  | "reconnecting"
  | "unavailable"
  | "closed";

export type RealtimeRole = "owner" | "collaborator";
export type RealtimeRoute = "workspace" | "owner" | "user";
export type RealtimeDelivery = "ephemeral" | "reliable" | "bulk";
export type RealtimeDataClass =
  | "presence"
  | "collaborationEvent"
  | "preview"
  | "sourceOrCommit";
export type RealtimePeerChannel = "control" | "bulk";

export type RealtimeIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type RealtimeSessionDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type RealtimeIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type RealtimeSendOptions = {
  route?: RealtimeRoute;
  targetUserId?: string;
  delivery?: RealtimeDelivery;
  dataClass?: RealtimeDataClass;
};

export type RealtimeBinarySendOptions = Omit<RealtimeSendOptions, "delivery"> & {
  delivery?: Exclude<RealtimeDelivery, "ephemeral">;
};

export type RealtimeConnectRequest = {
  workspaceId: string;
  role: RealtimeRole;
  shareToken?: string | null;
  ownerCapability?: string | null;
  clientId: string;
};

export type RealtimeSocketConnectOptions = {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
};

export type RealtimePeerCreateOptions = {
  sessionId: string;
  peerId: string;
  iceServers: RealtimeIceServer[];
  initiator: boolean;
};
