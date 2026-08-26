"use client";

import type { ImageProcessingService } from "@picbind/shared";
import { WebImageProcessingService } from "./adapters/web-image-processing-service";

let service: ImageProcessingService | null = null;

export function createImageProcessingService(): ImageProcessingService {
  if (service) return service;

  // Native capabilities are not selected until the Rust command set passes the
  // shared contract suite. Desktop therefore uses the explicitly identified Web
  // engine during this migration stage; results never claim desktop-native.
  service = new WebImageProcessingService();
  return service;
}
