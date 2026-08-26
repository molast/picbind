"use client";

import { invoke } from "@tauri-apps/api/core";
import type { AdoptTemporaryImageInput } from "@picbind/shared";
import type {
  ImageStorageRecord as NativeImageRecord,
  ImageStorageScope as NativeImageScope,
  PutImageStorageInput as PutNativeImageInput,
} from "./repositories/image-storage-repository";

export type { NativeImageRecord, NativeImageScope, PutNativeImageInput };

export type NativeStorageUsage = {
  recordCount: number;
  totalBytes: number;
  scopes: Array<{
    scope: NativeImageScope;
    recordCount: number;
    primaryBytes: number;
    thumbnailBytes: number;
  }>;
  orphanBytes: number;
  tempBytes: number;
};

const encoder = new TextEncoder();

export async function putNativeImage<T extends Record<string, unknown>>(
  input: PutNativeImageInput<T>,
) {
  const data = input.data ? new Uint8Array(await input.data.arrayBuffer()) : new Uint8Array();
  const thumbnail = input.thumbnail
    ? new Uint8Array(await input.thumbnail.arrayBuffer())
    : new Uint8Array();
  const metadata = encoder.encode(JSON.stringify({
    scope: input.scope,
    scopeKey: input.scopeKey ?? "",
    id: input.id,
    metadata: input.metadata,
    mimeType: input.mimeType,
    dataLength: data.byteLength,
    thumbnailLength: thumbnail.byteLength,
    thumbnailMimeType: input.thumbnailMimeType,
    createdAt: input.createdAt,
  }));
  const frame = new Uint8Array(4 + metadata.byteLength + data.byteLength + thumbnail.byteLength);
  new DataView(frame.buffer).setUint32(0, metadata.byteLength, true);
  frame.set(metadata, 4);
  frame.set(data, 4 + metadata.byteLength);
  frame.set(thumbnail, 4 + metadata.byteLength + data.byteLength);
  return invoke<NativeImageRecord<T>>("storage_put_image", frame);
}

export function adoptNativeTemporaryImage<T extends Record<string, unknown>>(
  input: AdoptTemporaryImageInput,
) {
  return invoke<NativeImageRecord<T>>("storage_adopt_temporary", { input });
}

export function getNativeImage<T extends Record<string, unknown>>(
  scope: NativeImageScope,
  scopeKey: string,
  id: string,
) {
  return invoke<NativeImageRecord<T> | null>("storage_get_image", {
    scope,
    scopeKey,
    id,
  });
}

export function listNativeImages<T extends Record<string, unknown>>(
  scope: NativeImageScope,
  scopeKey = "",
  limit = 1_000,
  offset = 0,
) {
  return invoke<Array<NativeImageRecord<T>>>("storage_list_images", {
    scope,
    scopeKey,
    limit,
    offset,
  });
}

export async function listAllNativeImages<T extends Record<string, unknown>>(
  scope: NativeImageScope,
  scopeKey = "",
) {
  const records: Array<NativeImageRecord<T>> = [];
  const pageSize = 250;
  while (true) {
    const page = await listNativeImages<T>(scope, scopeKey, pageSize, records.length);
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

export async function readNativeImage(
  scope: NativeImageScope,
  scopeKey: string,
  id: string,
  variant: "original" | "output" | "thumbnail",
  mimeType: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const response = await invoke<ArrayBuffer | Uint8Array | number[]>("storage_read_image", {
    scope,
    scopeKey,
    id,
    variant,
  });
  signal?.throwIfAborted();
  const bytes = response instanceof ArrayBuffer
    ? new Uint8Array(response)
    : response instanceof Uint8Array
      ? response
      : new Uint8Array(response);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: mimeType });
}

export function getNativeStorageUsage() {
  return invoke<NativeStorageUsage>("storage_get_usage");
}

export function pruneNativeImageCache(policy: {
  maxBytes: number;
  maxAgeMillis?: number;
  limit?: number;
}) {
  return invoke<{
    removedRecords: number;
    removedThumbnails: number;
    reclaimedBytes: number;
    remainingCacheBytes: number;
  }>("storage_prune_cache", { policy });
}

export function recoverNativeImageStorage() {
  return invoke<{
    removedTempFiles: number;
    removedOrphanFiles: number;
    removedMissingRecords: number;
    clearedMissingThumbnails: number;
  }>("storage_recover");
}

export function deleteNativeImage(scope: NativeImageScope, scopeKey: string, id: string) {
  return invoke<void>("storage_delete_image", { scope, scopeKey, id });
}

export function deleteNativeImageVariant(
  scope: NativeImageScope,
  scopeKey: string,
  id: string,
  variant: "original" | "output" | "thumbnail",
) {
  return invoke<void>("storage_delete_image_variant", { scope, scopeKey, id, variant });
}

export function clearNativeImages(scope: NativeImageScope, scopeKey?: string) {
  return invoke<void>("storage_clear_images", { scope, scopeKey });
}
