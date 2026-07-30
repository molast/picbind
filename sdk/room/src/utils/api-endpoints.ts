"use client";

import { getRoomSdkConfig } from "../config";

const DEFAULT_API_BASE_URL = "https://api.picbind.com";

function normalizeBaseUrl(value?: string) {
  const raw = (value || "").trim();
  if (!raw) {
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")
    ) {
      return "http://127.0.0.1:8787";
    }
    return DEFAULT_API_BASE_URL;
  }
  return raw.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string) {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function apiBaseUrl() {
  return normalizeBaseUrl(getRoomSdkConfig().apiBaseUrl);
}

export function getMetricsApiPath() {
  return joinUrl(apiBaseUrl(), "/api/metrics");
}

export function getPageViewApiPath() {
  return joinUrl(apiBaseUrl(), "/api/site/view");
}

export function getAdminStateApiPath() {
  return joinUrl(apiBaseUrl(), "/api/admin/state");
}

export function getShareRoomApiPath() {
  return (
    getRoomSdkConfig().createRoomUrl ||
    joinUrl(apiBaseUrl(), "/api/realtime/room/create")
  );
}

export function getShareRoomRealtimeApiPath(action: string) {
  return joinUrl(apiBaseUrl(), `/api/realtime/room/${action}`);
}

export function getShareRoomSocketUrl(roomId: string, sessionId: string) {
  const url = new URL(getShareRoomRealtimeApiPath("socket"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}
