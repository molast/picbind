"use client";

import type { AdoptTemporaryImageInput } from "@picbind/shared";

export type ImageStorageScope = "compressed" | "queued" | "workspace" | "messaging";
export type ImageStorageVariant = "original" | "output" | "thumbnail";

export type ImageStorageRecord<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  scope: ImageStorageScope;
  scopeKey: string;
  id: string;
  metadata: T;
  mimeType: string;
  byteSize: number;
  revision: string;
  thumbnailAvailable: boolean;
  createdAt: number;
  updatedAt: number;
};

export type PutImageStorageInput<T extends Record<string, unknown>> = {
  scope: ImageStorageScope;
  scopeKey?: string;
  id: string;
  metadata: T;
  mimeType: string;
  data?: Blob;
  thumbnail?: Blob;
  thumbnailMimeType?: string;
  createdAt: number;
};

export type LinkExternalImageStorageInput<T extends Record<string, unknown>> = {
  scope: ImageStorageScope;
  scopeKey?: string;
  id: string;
  metadata: T;
  mimeType: string;
  path: string;
  createdAt: number;
};

export type ImageCachePolicy = {
  maxBytes: number;
  maxAgeMillis?: number;
  limit?: number;
};

export type ImageCachePruneResult = {
  removedRecords: number;
  removedThumbnails: number;
  reclaimedBytes: number;
  remainingCacheBytes: number;
};

export interface ImageStorageRepository {
  adoptTemporary?<T extends Record<string, unknown>>(
    input: AdoptTemporaryImageInput,
  ): Promise<ImageStorageRecord<T>>;

  put<T extends Record<string, unknown>>(
    input: PutImageStorageInput<T>,
  ): Promise<ImageStorageRecord<T>>;

  linkExternal?<T extends Record<string, unknown>>(
    input: LinkExternalImageStorageInput<T>,
  ): Promise<ImageStorageRecord<T>>;

  address?(
    scope: ImageStorageScope,
    scopeKey: string,
    id: string,
    variant: ImageStorageVariant,
  ): Promise<string | null>;

  get<T extends Record<string, unknown>>(
    scope: ImageStorageScope,
    scopeKey: string,
    id: string,
  ): Promise<ImageStorageRecord<T> | null>;

  list<T extends Record<string, unknown>>(
    scope: ImageStorageScope,
    scopeKey: string,
    limit: number,
    offset: number,
  ): Promise<Array<ImageStorageRecord<T>>>;

  read(
    scope: ImageStorageScope,
    scopeKey: string,
    id: string,
    variant: ImageStorageVariant,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<Blob | null>;

  delete(scope: ImageStorageScope, scopeKey: string, id: string): Promise<void>;
  deleteVariant(
    scope: ImageStorageScope,
    scopeKey: string,
    id: string,
    variant: ImageStorageVariant,
  ): Promise<void>;
  clear(scope: ImageStorageScope, scopeKey?: string): Promise<void>;
  pruneCache(policy: ImageCachePolicy): Promise<ImageCachePruneResult>;
}
