/// <reference lib="webworker" />

import { configurePicBindUi } from "../config";
import { getWorkspaceEditorLabels } from "../locales";
import type { Lang } from "../locales";
import {
  compressWorkspaceImage,
  type WorkspaceCompressionEncodingOptions,
  type WorkspaceCompressionFormat,
} from "../utils/workspace-image-compression";

type CompressionRequest = {
  image: File;
  lang: Lang;
  allowAlphaLoss?: boolean;
  requestedFormat: WorkspaceCompressionFormat;
  targetWidth?: number;
  targetHeight?: number;
  wasmBaseUrl?: string;
  encodingOptions?: WorkspaceCompressionEncodingOptions;
};

self.onmessage = async (event: MessageEvent<CompressionRequest>) => {
  const { image, lang, allowAlphaLoss = false, requestedFormat, targetWidth, targetHeight, wasmBaseUrl, encodingOptions } = event.data;
  try {
    if (wasmBaseUrl) configurePicBindUi({ wasmBaseUrl });
    const dimensions =
      targetWidth !== undefined && targetHeight !== undefined
        ? { width: targetWidth, height: targetHeight }
        : undefined;
    const result = await compressWorkspaceImage(
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
      error: reason instanceof Error ? reason.message : getWorkspaceEditorLabels(lang).compressionFailed,
    });
  }
};
