/// <reference lib="webworker" />

import {
  applyWorkspaceColorAdjustments,
  type WorkspaceColorAdjustments,
} from "../utils/workspace-color-adjustments";
import { configurePicBindUi } from "../config";
import type { Lang } from "../locales";
import {
  encodeWorkspaceImageData,
  type WorkspaceCompressionEncodingOptions,
  type WorkspaceCompressionFormat,
} from "../utils/workspace-image-compression";

type ColorAdjustmentRequest = {
  image: File;
  adjustments: WorkspaceColorAdjustments;
  format: Exclude<WorkspaceCompressionFormat, "auto">;
  lang: Lang;
  sourceSizeBytes: number;
  encodingOptions: WorkspaceCompressionEncodingOptions;
  wasmBaseUrl?: string;
};

async function decodeImage(blob: Blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(blob);
  }
}

self.onmessage = async (event: MessageEvent<ColorAdjustmentRequest>) => {
  let bitmap: ImageBitmap | null = null;
  try {
    if (event.data.wasmBaseUrl) configurePicBindUi({ wasmBaseUrl: event.data.wasmBaseUrl });
    bitmap = await decodeImage(event.data.image);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const result = await encodeWorkspaceImageData(
      applyWorkspaceColorAdjustments(pixels, event.data.adjustments),
      event.data.format,
      event.data.image.name,
      event.data.sourceSizeBytes,
      event.data.lang,
      event.data.encodingOptions,
    );
    const bytes = await result.blob.arrayBuffer();
    self.postMessage(
      {
        ok: true,
        bytes,
        mime: result.blob.type,
        width: bitmap.width,
        height: bitmap.height,
      },
      { transfer: [bytes] },
    );
  } catch (reason) {
    self.postMessage({
      ok: false,
      error: reason instanceof Error ? reason.message : "Image color adjustment failed",
    });
  } finally {
    bitmap?.close();
  }
};
