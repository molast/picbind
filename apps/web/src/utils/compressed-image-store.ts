"use client";

import {
  clearCompressed,
  deleteCompressed,
  listCompressed,
  listCompressedMetadata,
  readCompressedImage,
  storeCompressed,
} from "@/stores/database/repositories/compressed-image-repository";

export type { CachedCompressedImage } from "@/stores/database/types/storage";

export const storeCompressedImage = storeCompressed;
export const listCompressedImages = listCompressed;
export const listCompressedImageMetadata = listCompressedMetadata;
export const loadCompressedImage = readCompressedImage;
export const deleteCompressedImage = deleteCompressed;
export const clearCompressedImages = clearCompressed;
