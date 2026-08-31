"use client";

import {
  emptyImageParameterDocument,
  setImageOperation,
  type ImageProcessingService,
} from "@picbind/shared";
import type { RoomCompressionFormat } from "./room-image-compression";
import type { ReviewAnnotation } from "./review-collaboration";

export type ReviewImageExport = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
  format: Exclude<RoomCompressionFormat, "auto">;
  parameters?: Record<string, unknown>;
};

export type ReviewImageExportStage =
  | "preparing"
  | "waiting"
  | "transferring"
  | "complete";

export type ReviewImageExportOutcome = {
  status: "saved" | "shared" | "rejected";
  imageId: string;
};

function reviewOutputFormat(type: string): Exclude<RoomCompressionFormat, "auto"> {
  const subtype = type.split("/")[1]?.toLowerCase();
  if (subtype === "jpg" || subtype === "jpeg") return "jpeg";
  if (subtype === "png" || subtype === "webp" || subtype === "avif") return subtype;
  return "webp";
}

function reviewOutputName(
  name: string | undefined,
  format: Exclude<RoomCompressionFormat, "auto">,
) {
  const stem = (name || "image").replace(/\.[^.]+$/, "") || "image";
  const extension = format === "jpeg" ? "jpg" : format;
  return `${stem}-annotated.${extension}`;
}

export async function generateReviewImage(
  imageProcessing: ImageProcessingService,
  source: Blob & { name?: string },
  annotations: ReviewAnnotation[],
  signal?: AbortSignal,
): Promise<ReviewImageExport> {
  const format = reviewOutputFormat(source.type);
  const result = await imageProcessing.materialize({
    source: {
      kind: "blob",
      blob: source,
      name: source.name || "image",
      mimeType: source.type,
    },
    document: setImageOperation(emptyImageParameterDocument(), {
      id: crypto.randomUUID(),
      userId: "local",
      time: Date.now(),
      type: "draw",
      params: { annotations },
    }),
    output: { format, quality: 82 },
    destination: "memory",
  }, {
    requestId: `review-export:${crypto.randomUUID()}`,
    signal,
  });
  if (result.artifact.kind !== "blob") {
    throw new Error("Review export did not return an in-memory image");
  }
  return {
    blob: result.artifact.blob,
    name: reviewOutputName(source.name, format),
    width: result.metadata.width,
    height: result.metadata.height,
    format,
    parameters: { annotations },
  };
}
