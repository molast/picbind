"use client";

import type { WorkspaceImageEditResult } from "./workspace-image-editing";
import type { WorkspaceCompressionEncodingOptions, WorkspaceCompressionFormat } from "./workspace-image-compression";
import { compressWorkspaceImageTask } from "./workspace-image-compression-task";
import { appendFileNameSuffix } from "./image-object";

export type WorkspaceConversionFormat = Exclude<WorkspaceCompressionFormat, "auto">;

export async function convertWorkspaceImageTask(
  image: File,
  format: WorkspaceConversionFormat,
  signal: AbortSignal,
  encodingOptions?: WorkspaceCompressionEncodingOptions,
): Promise<WorkspaceImageEditResult> {
  const result = await compressWorkspaceImageTask(
    image,
    format,
    signal,
    undefined,
    format === "jpeg",
    encodingOptions,
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
