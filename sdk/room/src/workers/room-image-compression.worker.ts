/// <reference lib="webworker" />

import { configureRoomSdk } from "../config";
import { getShareRoomLabels } from "../locales";
import type { Lang } from "../locales";
import {
  compressRoomImage,
  type RoomCompressionEncodingOptions,
  type RoomCompressionFormat,
} from "../utils/room-image-compression";

type CompressionRequest = {
  image: File;
  lang: Lang;
  allowAlphaLoss?: boolean;
  requestedFormat: RoomCompressionFormat;
  targetWidth?: number;
  targetHeight?: number;
  wasmBaseUrl?: string;
  encodingOptions?: RoomCompressionEncodingOptions;
};

self.onmessage = async (event: MessageEvent<CompressionRequest>) => {
  const { image, lang, allowAlphaLoss = false, requestedFormat, targetWidth, targetHeight, wasmBaseUrl, encodingOptions } = event.data;
  try {
    if (wasmBaseUrl) configureRoomSdk({ wasmBaseUrl });
    const dimensions =
      targetWidth !== undefined && targetHeight !== undefined
        ? { width: targetWidth, height: targetHeight }
        : undefined;
    const result = await compressRoomImage(
      image,
      requestedFormat,
      dimensions,
      lang,
      allowAlphaLoss,
      encodingOptions,
    );
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
      error: reason instanceof Error ? reason.message : getShareRoomLabels(lang).compressionFailed,
    });
  }
};
