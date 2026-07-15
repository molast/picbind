import { getShareRoomRealtimeApiPath } from "./api-endpoints";

export type RoomRole = "owner" | "guest";

type JoinResult = {
  role: RoomRole;
  sessionId: string;
  peerSessionId?: string;
};

export type RoomSignal = {
  ownerSessionId: string;
  guestSessionId: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  ownerCandidates?: RTCIceCandidateInit[];
  guestCandidates?: RTCIceCandidateInit[];
};

export type RoomMemberPresence = {
  clientId: string;
  role: RoomRole;
  status: "online" | "offline";
  leftAt?: number;
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

async function roomRequest<T>(
  action: string,
  body: Record<string, unknown>,
  keepalive = false,
) {
  const url = getShareRoomRealtimeApiPath(action);
  console.info("[PicBind Realtime] request", { action, url, body });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
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

export function getRealtimeRoomStatus(roomId: string, sessionId?: string) {
  return roomRequest<{
    members: RoomMemberPresence[];
    ownerKnown: boolean;
    guestKnown: boolean;
    ownerJoined: boolean;
    guestJoined: boolean;
    ownerSessionId?: string;
    guestSessionId?: string;
    signal?: RoomSignal;
  }>("status", { roomId, sessionId });
}

export function getRealtimeIceServers(roomId: string, sessionId: string) {
  return roomRequest<{ iceServers: RTCIceServer[] }>("ice-servers", {
    roomId,
    sessionId,
  });
}

export function publishRealtimeSignal(
  roomId: string,
  sessionId: string,
  description: RTCSessionDescriptionInit,
) {
  return roomRequest<{ ok: true }>("signal", {
    roomId,
    sessionId,
    description,
  });
}

export function publishRealtimeCandidate(
  roomId: string,
  sessionId: string,
  candidate: RTCIceCandidateInit,
) {
  return roomRequest<{ ok: true }>("candidate", {
    roomId,
    sessionId,
    candidate,
  });
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

export function leaveRealtimeRoom(
  roomId: string,
  sessionId: string,
  keepalive = false,
) {
  return roomRequest<{ ok: true }>("leave", { roomId, sessionId }, keepalive);
}

export function closeRealtimeRoom(roomId: string, sessionId: string) {
  return roomRequest<{ ok: true }>("close", { roomId, sessionId });
}
