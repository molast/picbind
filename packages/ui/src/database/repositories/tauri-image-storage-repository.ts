"use client";

import type { AdoptTemporaryImageInput } from "@picbind/shared";

import {
  adoptNativeTemporaryImage,
  clearNativeImages,
  deleteNativeImage,
  deleteNativeImageVariant,
  getNativeImage,
  listNativeImages,
  pruneNativeImageCache,
  putNativeImage,
  readNativeImage,
} from "../native-image-storage";
import type {
  ImageStorageRepository,
  ImageStorageScope,
  ImageStorageVariant,
  PutImageStorageInput,
} from "./image-storage-repository";

export const tauriImageStorageRepository: ImageStorageRepository = {
  adoptTemporary<T extends Record<string, unknown>>(input: AdoptTemporaryImageInput) {
    return adoptNativeTemporaryImage<T>(input);
  },

  put<T extends Record<string, unknown>>(input: PutImageStorageInput<T>) {
    return putNativeImage(input);
  },

  get<T extends Record<string, unknown>>(
    scope: ImageStorageScope,
    scopeKey: string,
    id: string,
  ) {
    return getNativeImage<T>(scope, scopeKey, id);
  },

  list<T extends Record<string, unknown>>(
    scope: ImageStorageScope,
    scopeKey: string,
    limit: number,
    offset: number,
  ) {
    return listNativeImages<T>(scope, scopeKey, limit, offset);
  },

  async read(
    scope: ImageStorageScope,
    scopeKey: string,
    id: string,
    variant: ImageStorageVariant,
    mimeType: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const record = await getNativeImage(scope, scopeKey, id);
    if (!record) return null;
    if (variant === "thumbnail" && !record.thumbnailAvailable) return null;
    if (variant !== "thumbnail" && record.byteSize === 0) return null;
    return readNativeImage(scope, scopeKey, id, variant, mimeType, signal);
  },

  delete(scope: ImageStorageScope, scopeKey: string, id: string) {
    return deleteNativeImage(scope, scopeKey, id);
  },

  deleteVariant(scope, scopeKey, id, variant) {
    return deleteNativeImageVariant(scope, scopeKey, id, variant);
  },

  clear(scope: ImageStorageScope, scopeKey?: string) {
    return clearNativeImages(scope, scopeKey);
  },

  pruneCache(policy) {
    return pruneNativeImageCache(policy);
  },
};
