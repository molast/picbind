"use client";

import { getShareRoomApiPath } from "./api-endpoints";

export type ShareRoom = {
  roomId: string;
  shareUrl: string;
  createdAt: string;
  expiresAt: string;
};

type CreateShareRoomResponse = ShareRoom & {
  ownerToken: string;
};

const OWNER_TOKEN_PREFIX = "picbind:share-room:owner:";
const CLIENT_ID_PREFIX = "picbind:share-room:client:";
const OWNED_ROOM_PREFIX = "picbind:share-room:owned:";
const CREATED_ROOM_PROMPT_PREFIX = "picbind:share-room:created-prompt:";
const TEMPORARY_ROOM_KEY = "picbind:share-room:temporary";

function ownerTokenKey(roomId: string) {
  return `${OWNER_TOKEN_PREFIX}${roomId}`;
}

export async function createShareRoom(): Promise<ShareRoom> {
  const response = await fetch(getShareRoomApiPath(), {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const result = (await response.json().catch(() => null)) as
    | (Partial<CreateShareRoomResponse> & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(result?.error || "Failed to create share room");
  }
  if (
    !result?.roomId ||
    !result.ownerToken ||
    !result.shareUrl ||
    !result.createdAt ||
    !result.expiresAt
  ) {
    throw new Error("The room service returned an invalid response");
  }

  sessionStorage.setItem(ownerTokenKey(result.roomId), result.ownerToken);
  const room = {
    roomId: result.roomId,
    shareUrl: result.shareUrl,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
  };
  sessionStorage.setItem(
    `${OWNED_ROOM_PREFIX}${result.roomId}`,
    JSON.stringify(room),
  );
  sessionStorage.setItem(`${CREATED_ROOM_PROMPT_PREFIX}${result.roomId}`, "1");
  return room;
}

export function consumeCreatedShareRoomPrompt(roomId: string) {
  const key = `${CREATED_ROOM_PROMPT_PREFIX}${roomId}`;
  if (sessionStorage.getItem(key) !== "1") {
    return false;
  }
  sessionStorage.removeItem(key);
  return true;
}

export function transferShareRoomSession(
  roomId: string,
  targetStorage: Storage,
) {
  const keys = [
    ownerTokenKey(roomId),
    `${CLIENT_ID_PREFIX}${roomId}`,
    `${OWNED_ROOM_PREFIX}${roomId}`,
    `${CREATED_ROOM_PROMPT_PREFIX}${roomId}`,
  ];
  const entries = keys.flatMap((key) => {
    const value = sessionStorage.getItem(key);
    return value === null ? [] : [[key, value] as const];
  });
  for (const [key, value] of entries) {
    targetStorage.setItem(key, value);
  }
  for (const [key] of entries) {
    sessionStorage.removeItem(key);
  }
}

export function getShareRoomOwnerToken(roomId: string) {
  return sessionStorage.getItem(ownerTokenKey(roomId));
}

export function getShareRoomClientId(roomId: string) {
  const key = `${CLIENT_ID_PREFIX}${roomId}`;
  const existing = sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const clientId = crypto.randomUUID().replace(/-/g, "");
  sessionStorage.setItem(key, clientId);
  return clientId;
}

export function markShareRoomTemporarilyAway(roomId: string) {
  const raw = sessionStorage.getItem(`${OWNED_ROOM_PREFIX}${roomId}`);
  if (!raw) {
    throw new Error("Owned room metadata is unavailable");
  }
  localStorage.setItem(TEMPORARY_ROOM_KEY, raw);
}

export function getTemporaryShareRoom() {
  const raw = localStorage.getItem(TEMPORARY_ROOM_KEY);
  if (!raw) {
    return null;
  }
  try {
    const room = JSON.parse(raw) as ShareRoom;
    if (
      !room.roomId ||
      !room.shareUrl ||
      Date.parse(room.expiresAt) <= Date.now()
    ) {
      localStorage.removeItem(TEMPORARY_ROOM_KEY);
      return null;
    }
    return room;
  } catch {
    localStorage.removeItem(TEMPORARY_ROOM_KEY);
    return null;
  }
}

export function clearTemporaryShareRoom(roomId?: string) {
  if (!roomId) {
    localStorage.removeItem(TEMPORARY_ROOM_KEY);
    return;
  }
  const room = getTemporaryShareRoom();
  if (room?.roomId === roomId) {
    localStorage.removeItem(TEMPORARY_ROOM_KEY);
  }
}

export function clearOwnedShareRoom(roomId: string) {
  sessionStorage.removeItem(ownerTokenKey(roomId));
  sessionStorage.removeItem(`${CLIENT_ID_PREFIX}${roomId}`);
  sessionStorage.removeItem(`${OWNED_ROOM_PREFIX}${roomId}`);
  sessionStorage.removeItem(`${CREATED_ROOM_PROMPT_PREFIX}${roomId}`);
  clearTemporaryShareRoom(roomId);
}
