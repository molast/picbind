import type { RealtimePeerEvent, RealtimeSessionEvent, RealtimeSocketEvent } from "./events";
import type {
  RealtimeBinarySendOptions,
  RealtimeConnectRequest,
  RealtimeFrame,
  RealtimeIceCandidate,
  RealtimePeerChannel,
  RealtimePeerCreateOptions,
  RealtimeSendOptions,
  RealtimeSessionDescription,
  RealtimeSessionState,
  RealtimeSocketConnectOptions,
} from "./types";

export interface RealtimeService {
  connect(request: RealtimeConnectRequest): Promise<RealtimeSession>;
}

export interface RealtimeSession {
  readonly id: string;
  readonly state: RealtimeSessionState;
  subscribe(listener: (event: RealtimeSessionEvent) => void): () => void;
  send(type: string, payload: Record<string, unknown>, options?: RealtimeSendOptions): string;
  sendBinary(
    type: string,
    payload: Record<string, unknown>,
    data: ArrayBuffer,
    options?: RealtimeBinarySendOptions,
  ): string;
  removeCollaborator(userId: string): Promise<boolean>;
  close(reason?: string): Promise<void>;
}

export interface RealtimeSocketFactory {
  connect(options: RealtimeSocketConnectOptions): Promise<RealtimeSocket>;
}

export interface RealtimeSocket {
  readonly state: "connecting" | "open" | "closing" | "closed";
  subscribe(listener: (event: RealtimeSocketEvent) => void): () => void;
  send(frame: RealtimeFrame): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
}

export interface RealtimePeerFactory {
  create(options: RealtimePeerCreateOptions): Promise<RealtimePeer>;
}

export interface RealtimePeer {
  readonly id: string;
  subscribe(listener: (event: RealtimePeerEvent) => void): () => void;
  createOffer(): Promise<RealtimeSessionDescription>;
  createAnswer(): Promise<RealtimeSessionDescription>;
  setLocalDescription(value: RealtimeSessionDescription): Promise<void>;
  setRemoteDescription(value: RealtimeSessionDescription): Promise<void>;
  addIceCandidate(value: RealtimeIceCandidate): Promise<void>;
  send(channel: RealtimePeerChannel, frame: RealtimeFrame): Promise<void>;
  bufferedAmount(channel: RealtimePeerChannel): Promise<number>;
  close(): Promise<void>;
}
