"use client";

import CreateRoomButton from "@picbind/room/source/create-room-button";
import { configureRoomSdk } from "@picbind/room/source/config";
import { messagingService } from "@/utils/messaging-service";

const ONLINE_ROOM_API_BASE_URL = "https://api.picbind.com";

configureRoomSdk({
  apiBaseUrl: ONLINE_ROOM_API_BASE_URL,
  roomUrl: process.env.NEXT_PUBLIC_ROOM_APP_URL,
  messagingService,
});

export default CreateRoomButton;
