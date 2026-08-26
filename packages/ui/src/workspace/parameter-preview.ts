import { renderReviewAnnotations } from "../components/share/workspace/review-annotation-layer";
import type { ReviewAnnotation } from "../utils/review-collaboration";
import { applyRoomColorAdjustments, type RoomColorAdjustments } from "../utils/room-color-adjustments";
import type { WorkspaceImage, WorkspaceOperation } from "./types";
import { decodeWorkspaceImage } from "./image-decoder";

const MAX_PREVIEW_WIDTH = 960;
const MAX_PREVIEW_HEIGHT = 720;

function parameterNumber(parameters: Record<string, unknown>, key: string) {
  const value = Number(parameters[key]);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${key}`);
  return value;
}

function fittedSize(width: number, height: number, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function resizedCanvas(source: OffscreenCanvas, width: number, height: number) {
  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas is unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderWorkspaceParameterPreview(
  source: Blob,
  image: Pick<WorkspaceImage, "width" | "height">,
  operations: WorkspaceOperation[],
  options: { maxWidth?: number; maxHeight?: number; quality?: number } = {},
) {
  const maxWidth = Math.max(1, Math.min(MAX_PREVIEW_WIDTH, Math.round(options.maxWidth ?? MAX_PREVIEW_WIDTH)));
  const maxHeight = Math.max(1, Math.min(MAX_PREVIEW_HEIGHT, Math.round(options.maxHeight ?? MAX_PREVIEW_HEIGHT)));
  const quality = Math.max(0, Math.min(1, options.quality ?? 0.86));
  const decoded = await decodeWorkspaceImage(source);
  let logicalWidth = image.width || decoded.width;
  let logicalHeight = image.height || decoded.height;
  const initialSize = fittedSize(decoded.width, decoded.height, maxWidth, maxHeight);
  let canvas = new OffscreenCanvas(initialSize.width, initialSize.height);
  const initialContext = canvas.getContext("2d", { alpha: true });
  if (!initialContext) {
    decoded.dispose();
    throw new Error("Canvas is unavailable");
  }
  initialContext.imageSmoothingEnabled = true;
  initialContext.imageSmoothingQuality = "high";
  try {
    initialContext.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  } finally {
    decoded.dispose();
  }

  for (const operation of operations) {
    if (operation.type === "crop") {
      const x = parameterNumber(operation.parameters, "x");
      const y = parameterNumber(operation.parameters, "y");
      const width = parameterNumber(operation.parameters, "width");
      const height = parameterNumber(operation.parameters, "height");
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
        throw new Error("Invalid crop operation");
      }
      const sourceX = Math.round(x * canvas.width);
      const sourceY = Math.round(y * canvas.height);
      const sourceWidth = Math.max(1, Math.min(canvas.width - sourceX, Math.round(width * canvas.width)));
      const sourceHeight = Math.max(1, Math.min(canvas.height - sourceY, Math.round(height * canvas.height)));
      const next = new OffscreenCanvas(sourceWidth, sourceHeight);
      const context = next.getContext("2d", { alpha: true });
      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      canvas = next;
      logicalWidth = Math.max(1, Math.round(logicalWidth * width));
      logicalHeight = Math.max(1, Math.round(logicalHeight * height));
    } else if (operation.type === "resize") {
      logicalWidth = parameterNumber(operation.parameters, "width");
      logicalHeight = parameterNumber(operation.parameters, "height");
      if (logicalWidth < 1 || logicalHeight < 1 || logicalWidth > 16384 || logicalHeight > 16384) {
        throw new Error("Invalid resize operation");
      }
      const size = fittedSize(logicalWidth, logicalHeight, maxWidth, maxHeight);
      canvas = resizedCanvas(canvas, size.width, size.height);
    } else if (operation.type === "rotate") {
      const degrees = parameterNumber(operation.parameters, "degrees");
      if (![90, 180, 270].includes(degrees)) throw new Error("Invalid rotate operation");
      const swap = degrees === 90 || degrees === 270;
      const next = new OffscreenCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height);
      const context = next.getContext("2d", { alpha: true });
      if (!context) throw new Error("Canvas is unavailable");
      context.translate(next.width / 2, next.height / 2);
      context.rotate(degrees * Math.PI / 180);
      context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas = next;
      if (swap) [logicalWidth, logicalHeight] = [logicalHeight, logicalWidth];
    } else if (["brightness", "contrast", "saturation"].includes(operation.type)) {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      context.putImageData(applyRoomColorAdjustments(pixels, operation.parameters as unknown as RoomColorAdjustments), 0, 0);
    } else if (operation.type === "other" && operation.parameters.review && Array.isArray(operation.parameters.annotations)) {
      const overlay = await renderReviewAnnotations(
        operation.parameters.annotations as ReviewAnnotation[],
        canvas.width,
        canvas.height,
      );
      const overlayBitmap = await createImageBitmap(overlay);
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        overlayBitmap.close();
        throw new Error("Canvas is unavailable");
      }
      context.drawImage(overlayBitmap, 0, 0, canvas.width, canvas.height);
      overlayBitmap.close();
    }
  }

  return {
    blob: await canvas.convertToBlob({ type: "image/webp", quality }),
    width: Math.round(logicalWidth),
    height: Math.round(logicalHeight),
  };
}
