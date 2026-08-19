"use client";

import { initPerceptualWasm } from "@/utils/perceptual-wasm-runtime";

export type RgbaImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type ButteraugliScore = {
  score: number;
  pnorm3: number;
};

const MAX_ANALYSIS_EDGE = 1280;

function analysisDimensions(width: number, height: number) {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= MAX_ANALYSIS_EDGE) return { width, height };
  const scale = MAX_ANALYSIS_EDGE / maxEdge;
  return {
    width: Math.max(8, Math.round(width * scale)),
    height: Math.max(8, Math.round(height * scale)),
  };
}

function resizeRgba(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;

  const sourceCanvas = new OffscreenCanvas(image.width, image.height);
  const sourceContext = sourceCanvas.getContext("2d");
  const targetCanvas = new OffscreenCanvas(width, height);
  const targetContext = targetCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!sourceContext || !targetContext) {
    throw new Error("Canvas 2D context is unavailable for Butteraugli");
  }

  const sourceData = sourceContext.createImageData(image.width, image.height);
  sourceData.data.set(image.bytes);
  sourceContext.putImageData(sourceData, 0, 0);
  targetContext.drawImage(sourceCanvas, 0, 0, width, height);
  const targetData = targetContext.getImageData(0, 0, width, height);
  return {
    bytes: new Uint8Array(
      targetData.data.buffer,
      targetData.data.byteOffset,
      targetData.data.byteLength,
    ),
    width,
    height,
  };
}

export async function createButteraugliEvaluator(source: RgbaImage) {
  const wasmModule = await initPerceptualWasm();
  const dimensions = analysisDimensions(source.width, source.height);
  const analysisSource = resizeRgba(
    source,
    dimensions.width,
    dimensions.height,
  );
  const session = new wasmModule.ButteraugliSession(
    analysisSource.bytes,
    analysisSource.width,
    analysisSource.height,
  );

  return {
    compare(candidate: RgbaImage) {
      const analysisCandidate = resizeRgba(
        candidate,
        analysisSource.width,
        analysisSource.height,
      );
      return session.compare(analysisCandidate.bytes) as ButteraugliScore;
    },
    free() {
      session.free();
    },
  };
}
