"use client";

const DEFAULT_API_BASE_BY_ENV =
  process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8787"
    : "https://api.picbind.com";

function normalizeBaseUrl(value?: string) {
  const raw = (value || "").trim();
  if (!raw) {
    return DEFAULT_API_BASE_BY_ENV;
  }
  return raw.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string) {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

const API_BASE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function getMetricsApiPath() {
  return (
    process.env.NEXT_PUBLIC_METRICS_API_PATH ||
    joinUrl(API_BASE_URL, "/api/metrics")
  );
}

export function getPageViewApiPath() {
  return (
    process.env.NEXT_PUBLIC_PAGE_VIEW_API_PATH ||
    joinUrl(API_BASE_URL, "/api/site/view")
  );
}

export function getAdminStateApiPath() {
  return (
    process.env.NEXT_PUBLIC_ADMIN_STATE_API_PATH ||
    joinUrl(API_BASE_URL, "/api/admin/state")
  );
}

export function getShareRoomApiPath() {
  return (
    process.env.NEXT_PUBLIC_SHARE_ROOM_API_PATH ||
    joinUrl(API_BASE_URL, "/api/realtime/room/create")
  );
}

export function getShareRoomRealtimeApiPath(action: string) {
  return joinUrl(API_BASE_URL, `/api/realtime/room/${action}`);
}

export function getShareRoomSocketUrl(roomId: string, sessionId: string) {
  const url = new URL(getShareRoomRealtimeApiPath("socket"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}
