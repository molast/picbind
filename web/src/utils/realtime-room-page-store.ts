"use client";

import type { ActivityItem } from "@/components/share/share-room-types";

const CACHE_PREFIX = "picbind:room-page-state:v1:";

export type CachedRoomPageState = {
  activities: ActivityItem[];
  textMessage: string;
  reviewImageId: string | null;
  updatedAt: number;
};

function cacheKey(roomId: string) {
  return `${CACHE_PREFIX}${roomId}`;
}

export function loadRoomPageState(roomId: string): CachedRoomPageState | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(roomId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CachedRoomPageState>;
    return {
      activities: Array.isArray(value.activities)
        ? value.activities.slice(-60)
        : [],
      textMessage:
        typeof value.textMessage === "string"
          ? value.textMessage.slice(0, 200)
          : "",
      reviewImageId:
        typeof value.reviewImageId === "string" ? value.reviewImageId : null,
      updatedAt:
        typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveRoomPageState(
  roomId: string,
  state: Omit<CachedRoomPageState, "updatedAt">,
) {
  sessionStorage.setItem(
    cacheKey(roomId),
    JSON.stringify({ ...state, activities: state.activities.slice(-60), updatedAt: Date.now() }),
  );
}

export function clearRoomPageState(roomId: string) {
  sessionStorage.removeItem(cacheKey(roomId));
}
