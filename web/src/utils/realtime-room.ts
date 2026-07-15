import { getShareRoomRealtimeApiPath } from "./api-endpoints";

export type RoomRole = "owner" | "guest";

type JoinResult = {
  role: RoomRole;
  sessionId: string;
  peerSessionId?: string;
};

type TransportResult = {
  sessionDescription?: RTCSessionDescriptionInit;
  requiresImmediateRenegotiation?: boolean;
};

export class RealtimeRoomRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RealtimeRoomRequestError";
  }
}

async function roomRequest<T>(action: string, body: Record<string, unknown>) {
  const url = getShareRoomRealtimeApiPath(action);
  console.info("[PicBind Realtime] request", { action, url, body });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  console.info("[PicBind Realtime] response", {
    action,
    status: response.status,
    statusText: response.statusText,
    raw,
  });
  let result: (T & { error?: string; stage?: string }) | null = null;
  try {
    result = raw ? (JSON.parse(raw) as T & { error?: string; stage?: string }) : null;
  } catch (error) {
    console.error("[PicBind Realtime] response JSON parse failed", { action, raw, error });
    throw new Error(`Realtime ${action} returned invalid JSON: ${raw}`);
  }
  if (!response.ok || !result) {
    console.error("[PicBind Realtime] request failed", { action, status: response.status, result });
    throw new RealtimeRoomRequestError(
      result?.error || `Realtime ${action} failed (${response.status})`,
      response.status,
    );
  }
  return result;
}

export function joinRealtimeRoom(
  roomId: string,
  ownerToken: string | null,
  clientId: string,
) {
  return roomRequest<JoinResult>("join", { roomId, ownerToken, clientId });
}

export function getRealtimeRoomStatus(roomId: string) {
  return roomRequest<{ ownerJoined: boolean; guestJoined: boolean; ownerSessionId?: string; guestSessionId?: string }>("status", { roomId });
}

export function heartbeatRealtimeRoom(roomId: string, sessionId: string) {
  return roomRequest<{ ok: true }>("heartbeat", { roomId, sessionId });
}

export function leaveRealtimeRoomTemporarily(
  roomId: string,
  sessionId: string,
) {
  return roomRequest<{ ok: true }>("temporary-away", { roomId, sessionId });
}

export function closeRealtimeRoom(roomId: string, sessionId: string) {
  return roomRequest<{ ok: true }>("close", { roomId, sessionId });
}

export function establishRealtimeTransport(roomId: string, sessionId: string, sessionDescription: RTCSessionDescriptionInit) {
  return roomRequest<TransportResult>("transport", { roomId, sessionId, sessionDescription });
}

export function renegotiateRealtimeTransport(roomId: string, sessionId: string, sessionDescription: RTCSessionDescriptionInit) {
  return roomRequest<Record<string, never>>("renegotiate", { roomId, sessionId, sessionDescription });
}

export async function createRealtimeDataChannel(
  roomId: string,
  sessionId: string,
  direction: "local" | "remote",
  name: string,
) {
  const result = await roomRequest<{ id: number }>("datachannel", { roomId, sessionId, direction, name });
  return result.id;
}
