"use client";

import type { ImageProcessingService } from "@picbind/shared";
import { isTauri } from "@tauri-apps/api/core";
import { DesktopImageProcessingSelector } from "./adapters/desktop-image-processing-selector";
import { DesktopImageProcessingService } from "./adapters/desktop-image-processing-service";
import { WebImageProcessingService } from "./adapters/web-image-processing-service";

let service: ImageProcessingService | null = null;

export function createImageProcessingService(): ImageProcessingService {
  if (service) return service;

  const web = new WebImageProcessingService();
  service = isTauri()
    ? new DesktopImageProcessingSelector(new DesktopImageProcessingService(), web)
    : web;
  return service;
}
