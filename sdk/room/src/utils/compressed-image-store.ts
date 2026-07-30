"use client";

import {
  clearCompressed,
  deleteCompressed,
  listCompressed,
  storeCompressed,
} from "../database/repositories/compressed-image-repository";

export type { CachedCompressedImage } from "../database/types/storage";

export const storeCompressedImage = storeCompressed;
export const listCompressedImages = listCompressed;
export const deleteCompressedImage = deleteCompressed;
export const clearCompressedImages = clearCompressed;
