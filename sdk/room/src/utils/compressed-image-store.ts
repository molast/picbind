"use client";

import {
  clearCompressed,
  deleteCompressed,
  listCompressed,
  listCompressedMetadata,
  readCompressedImage,
  storeCompressed,
} from "../database/repositories/compressed-image-repository";

export type { CachedCompressedImage } from "../database/types/storage";
export type { CompressedImageSummary } from "../database/repositories/compressed-image-repository";

export const storeCompressedImage = storeCompressed;
export const listCompressedImages = listCompressed;
export const listCompressedImageMetadata = listCompressedMetadata;
export const loadCompressedImage = readCompressedImage;
export const deleteCompressedImage = deleteCompressed;
export const clearCompressedImages = clearCompressed;
