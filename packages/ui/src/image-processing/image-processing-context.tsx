"use client";

import React from "react";
import type { ImageProcessingService } from "@picbind/shared";

const ImageProcessingContext = React.createContext<ImageProcessingService | null>(null);

export function ImageProcessingProvider({
  service,
  children,
}: {
  service: ImageProcessingService;
  children: React.ReactNode;
}) {
  return (
    <ImageProcessingContext.Provider value={service}>
      {children}
    </ImageProcessingContext.Provider>
  );
}

export function useImageProcessing(): ImageProcessingService {
  const service = React.useContext(ImageProcessingContext);
  if (!service) {
    throw new Error("ImageProcessingProvider is missing from the application composition root");
  }
  return service;
}

export function useOptionalImageProcessing(): ImageProcessingService | null {
  return React.useContext(ImageProcessingContext);
}
