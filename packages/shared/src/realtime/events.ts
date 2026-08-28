import type { RealtimeError } from "./errors";
import type {
  RealtimeFrame,
  RealtimeIceCandidate,
  RealtimePeerChannel,
  RealtimeSessionState,
} from "./types";

export type RealtimeSocketEvent =
  | { type: "open" }
  | { type: "message"; frame: RealtimeFrame }
  | { type: "close"; code?: number; reason?: string }
  | { type: "error"; error: RealtimeError };

export type RealtimePeerConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export type RealtimePeerEvent =
  | { type: "iceCandidate"; candidate: RealtimeIceCandidate }
  | { type: "connectionState"; state: RealtimePeerConnectionState }
  | { type: "channelState"; channel: RealtimePeerChannel; state: "open" | "closed" }
  | { type: "message"; channel: RealtimePeerChannel; frame: RealtimeFrame }
  | { type: "error"; error: RealtimeError };

export type RealtimeSessionEvent = {
  type: string;
  [key: string]: unknown;
};

export type RealtimeStateChangedEvent = RealtimeSessionEvent & {
  type: "stateChanged";
  state: RealtimeSessionState;
};
