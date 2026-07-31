/// <reference lib="webworker" />

import { configureRoomSdk } from "../config";
import {
  compressRoomImage,
  type RoomCompressionFormat,
} from "../utils/room-image-compression";

type CompressionRequest = {
  image: File;
  requestedFormat: RoomCompressionFormat;
  targetWidth?: number;
  targetHeight?: number;
  wasmBaseUrl?: string;
};

self.onmessage = async (event: MessageEvent<CompressionRequest>) => {
  const { image, requestedFormat, targetWidth, targetHeight, wasmBaseUrl } = event.data;
  try {
    if (wasmBaseUrl) configureRoomSdk({ wasmBaseUrl });
    const dimensions =
      targetWidth !== undefined && targetHeight !== undefined
        ? { width: targetWidth, height: targetHeight }
        : undefined;
    const result = await compressRoomImage(image, requestedFormat, dimensions);
    const bytes = await result.blob.arrayBuffer();
    self.postMessage(
      {
        ok: true,
        bytes,
        mime: result.blob.type,
        format: result.format,
        name: result.name,
        width: result.width,
        height: result.height,
      },
      { transfer: [bytes] },
    );
  } catch (reason) {
    self.postMessage({
      ok: false,
      error: reason instanceof Error ? reason.message : "图片压缩失败",
    });
  }
};
