"use client";

import { initWasm } from "./wasm-runtime";

export type ImageObjectSource =
  | "local"
  | "received"
  | "compressed"
  | "review-export";

export type ImageObjectOperation =
  | "original"
  | "compress"
  | "convert"
  | "crop"
  | "resize"
  | "adjust"
  | "review-export";

export type ImageShareStatus =
  | "local"
  | "awaiting-response"
  | "accepted"
  | "rejected"
  | "transferring"
  | "available"
  | "cancelled"
  | "failed";

export type ImageWorkspaceLocation = "library" | "outbox";
export type ImageOutboxOrigin = "library" | "direct" | "received";

export type ImageObjectMetadata = {
  rootImageId: string;
  parentImageId: string | null;
  ownerId: string;
  width: number;
  height: number;
  source: ImageObjectSource;
  operation: ImageObjectOperation;
  version: number;
  shareStatus?: ImageShareStatus;
  workspaceLocation?: ImageWorkspaceLocation;
  outboxOrigin?: ImageOutboxOrigin;
  createdAt?: number;
  updatedAt?: number;
  likeCount?: number;
};

export function createLegacyImageObjectMetadata(
  imageId: string,
  source: ImageObjectSource,
): ImageObjectMetadata {
  return {
    rootImageId: imageId,
    parentImageId: null,
    ownerId: "",
    width: 0,
    height: 0,
    source,
    operation: "original",
    version: 1,
    shareStatus: source === "received" ? "available" : "local",
    workspaceLocation: "outbox",
    outboxOrigin: source === "received" ? "received" : "direct",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    likeCount: 0,
  };
}

type WasmImageMetadata = {
  imageId: string;
  width: number;
  height: number;
  format: string;
};

async function browserDimensions(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export async function identifyImage(blob: Blob) {
  const mod = await initWasm();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const metadata = mod.read_image_metadata(bytes) as WasmImageMetadata;
  const dimensions =
    metadata.width > 0 && metadata.height > 0
      ? { width: metadata.width, height: metadata.height }
      : await browserDimensions(blob);
  return { ...metadata, ...dimensions };
}

export function extensionFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && extension !== name.toLowerCase() ? extension : "image";
}

export function replaceFileExtension(name: string, extension: string) {
  const stem = name.replace(/\.[^.]+$/, "") || "image";
  return `${stem}.${extension}`;
}
