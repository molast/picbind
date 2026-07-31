"use client";

import {
  configureRoomSdk,
  CreateRoomButton,
  ShareRoomPage,
} from "@picbind/room/source";

const ONLINE_ROOM_API_BASE_URL = "https://api.picbind.com";

configureRoomSdk({
  apiBaseUrl: ONLINE_ROOM_API_BASE_URL,
  roomUrl: process.env.NEXT_PUBLIC_ROOM_APP_URL,
});

export { CreateRoomButton, ShareRoomPage };
export type { Lang, ShareRoom } from "@picbind/room/source";
