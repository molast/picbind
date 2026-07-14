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
  return {
    roomId: result.roomId,
    shareUrl: result.shareUrl,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
  };
}

export function getShareRoomOwnerToken(roomId: string) {
  return sessionStorage.getItem(ownerTokenKey(roomId));
}
