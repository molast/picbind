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

async function roomRequest<T>(action: string, body: Record<string, unknown>) {
  const response = await fetch(getShareRoomRealtimeApiPath(action), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error || "Realtime request failed");
  return result;
}

export function joinRealtimeRoom(roomId: string, ownerToken: string | null) {
  return roomRequest<JoinResult>("join", { roomId, ownerToken });
}

export function getRealtimeRoomStatus(roomId: string) {
  return roomRequest<{ ownerJoined: boolean; guestJoined: boolean; ownerSessionId?: string; guestSessionId?: string }>("status", { roomId });
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
