"use client";

import CreateRoomButton from "@picbind/room/source/create-room-button";
import { configureRoomSdk } from "@picbind/room/source/config";

configureRoomSdk({
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  createRoomUrl: process.env.NEXT_PUBLIC_SHARE_ROOM_API_PATH,
  roomUrl: process.env.NEXT_PUBLIC_ROOM_APP_URL,
  wasmBaseUrl: "/wasm",
});

export default CreateRoomButton;
