"use client";

import type { RoomImageEditResult } from "./room-image-editing";
import type { RoomCompressionFormat } from "./room-image-compression";
import { compressRoomImageTask } from "./room-image-compression-task";
import { appendFileNameSuffix } from "./image-object";

export type RoomConversionFormat = Exclude<RoomCompressionFormat, "auto">;

export async function convertRoomImageTask(
  image: File,
  format: RoomConversionFormat,
  signal: AbortSignal,
): Promise<RoomImageEditResult> {
  const result = await compressRoomImageTask(
    image,
    format,
    signal,
    undefined,
    format === "jpeg",
  );
  return {
    blob: result.blob,
    name: appendFileNameSuffix(
      image.name || "image",
      "convert",
      result.format === "jpeg" ? "jpg" : result.format,
    ),
    width: result.width,
    height: result.height,
    operation: "convert",
    parameters: { format },
  };
}
