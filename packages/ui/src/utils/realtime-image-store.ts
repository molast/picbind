"use client";

import {
  deleteRoom,
  listRoom,
  listRoomMetadata,
  readRoomImage,
  readRoomImageVariant,
  storeRoom,
} from "../database/repositories/room-image-repository";

export type { CachedRoomImage } from "../database/types/storage";
export type { RoomImageSummary } from "../database/repositories/room-image-repository";

export const storeRoomImage = storeRoom;
export const listRoomImages = listRoom;
export const listRoomImageMetadata = listRoomMetadata;
export const loadRoomImage = readRoomImage;
export const loadRoomImageVariant = readRoomImageVariant;
export const deleteRoomImage = deleteRoom;
