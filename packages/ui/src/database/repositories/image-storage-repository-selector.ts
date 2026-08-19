"use client";

import { isTauri } from "@tauri-apps/api/core";
import type { ImageStorageRepository } from "./image-storage-repository";
import { tauriImageStorageRepository } from "./tauri-image-storage-repository";
import { webImageStorageRepository } from "./web-image-storage-repository";

let selectedRepository: ImageStorageRepository | null = null;

export function getImageStorageRepository(): ImageStorageRepository {
  selectedRepository ??= typeof window !== "undefined" && isTauri()
    ? tauriImageStorageRepository
    : webImageStorageRepository;
  return selectedRepository;
}
