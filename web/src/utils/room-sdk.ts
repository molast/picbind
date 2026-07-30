"use client";

import {
  configureRoomSdk,
  CreateRoomButton,
  ShareRoomPage,
} from "@picbind/room/source";

configureRoomSdk({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  createRoomUrl: process.env.NEXT_PUBLIC_SHARE_ROOM_API_PATH,
  roomUrl: process.env.NEXT_PUBLIC_ROOM_APP_URL,
  wasmBaseUrl: "/wasm",
});

export { CreateRoomButton, ShareRoomPage };
export type { Lang, ShareRoom } from "@picbind/room/source";
