"use client";

import type { RoomImageEditResult } from "./room-image-editing";
import type { RoomCompressionFormat } from "./room-image-compression";
import { compressRoomImageTask } from "./room-image-compression-task";

export type RoomConversionFormat = Exclude<RoomCompressionFormat, "auto">;

export async function convertRoomImageTask(
  image: File,
  format: RoomConversionFormat,
  signal: AbortSignal,
): Promise<RoomImageEditResult> {
  const result = await compressRoomImageTask(image, format, signal);
  return {
    blob: result.blob,
    name: result.name,
    width: result.width,
    height: result.height,
    operation: "convert",
  };
}
