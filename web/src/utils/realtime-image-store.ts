"use client";

import {
  deleteRoom,
  listRoom,
  storeRoom,
} from "@/database/repositories/room-image-repository";

export type { CachedRoomImage } from "@/database/types/storage";

export const storeRoomImage = storeRoom;
export const listRoomImages = listRoom;
export const deleteRoomImage = deleteRoom;
