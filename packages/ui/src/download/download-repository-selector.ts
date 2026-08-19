import { isTauri } from "@tauri-apps/api/core";
import type { DownloadRepository } from "./download-repository";
import { tauriDownloadRepository } from "./tauri-download-repository";
import { webDownloadRepository } from "./web-download-repository";

let selectedRepository: DownloadRepository | null = null;

export function getDownloadRepository(): DownloadRepository {
  selectedRepository ??= typeof window !== "undefined" && isTauri()
    ? tauriDownloadRepository
    : webDownloadRepository;
  return selectedRepository;
}
