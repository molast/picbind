"use client";

import React from "react";
import { ImageProcessingProvider } from "@picbind/ui/source";
import { createImageProcessingService } from "./create-image-processing-service";

export default function ImageProcessingProviderRoot({ children }: { children: React.ReactNode }) {
  const [service] = React.useState(createImageProcessingService);
  return <ImageProcessingProvider service={service}>{children}</ImageProcessingProvider>;
}
