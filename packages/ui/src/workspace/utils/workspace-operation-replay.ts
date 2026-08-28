import type { RoomColorAdjustments, NormalizedCrop } from "../../utils/room-image-editing";
import { adjustRoomImage, cropRoomImage, resizeRoomImage } from "../../utils/room-image-editing";
import type { RoomCompressionEncodingOptions } from "../../utils/room-image-compression";
import { convertRoomImageTask, type RoomConversionFormat } from "../../utils/room-image-conversion";
import { compressRoomImageTask } from "../../utils/room-image-compression-task";
import { renderReviewAnnotations } from "../../components/share/workspace/review-annotation-layer";
import type { ReviewAnnotation } from "../../utils/review-collaboration";
import type { WorkspaceImage, WorkspaceOperation } from "../types";
import { numberParameter } from "./workspace-operation-mapping";

export async function rotateImage(source: Blob, name: string, degrees: number) {
  if (![90, 180, 270].includes(degrees)) throw new Error("Invalid rotate operation");
  const bitmap = await createImageBitmap(source);
  try {
    const swapsDimensions = degrees === 90 || degrees === 270;
    const width = swapsDimensions ? bitmap.height : bitmap.width;
    const height = swapsDimensions ? bitmap.width : bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas is unavailable");
    context.translate(width / 2, height / 2);
    context.rotate(degrees * Math.PI / 180);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, name: name.replace(/\.[^.]+$/, "") + "-rotate.png", mimeType: "image/png", width, height };
  } finally { bitmap.close(); }
}

export async function replayOperations(image: WorkspaceImage, operations: WorkspaceOperation[], encodingOptions?: RoomCompressionEncodingOptions) {
  if (!image.source) throw new Error("Source data is unavailable");
  let current = new File([image.source], image.name, { type: image.mimeType });
  let width = image.width, height = image.height;
  for (const operation of operations) {
    if (operation.type === "crop") {
      const crop = { x: numberParameter(operation.parameters, "x"), y: numberParameter(operation.parameters, "y"), width: numberParameter(operation.parameters, "width"), height: numberParameter(operation.parameters, "height") };
      if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error("Invalid crop operation");
      const result = await cropRoomImage(current, crop as NormalizedCrop, encodingOptions); current = new File([result.blob], result.name, { type: result.blob.type }); width = result.width; height = result.height;
    } else if (operation.type === "resize") {
      const targetWidth = numberParameter(operation.parameters, "width"), targetHeight = numberParameter(operation.parameters, "height");
      if (targetWidth < 1 || targetHeight < 1 || targetWidth > 16384 || targetHeight > 16384) throw new Error("Invalid resize operation");
      const result = await resizeRoomImage(current, targetWidth, targetHeight, encodingOptions); current = new File([result.blob], result.name, { type: result.blob.type }); width = result.width; height = result.height;
    } else if (operation.type === "rotate") {
      const result = await rotateImage(current, current.name, numberParameter(operation.parameters, "degrees")); current = new File([result.blob], result.name, { type: result.mimeType }); width = result.width; height = result.height;
    } else if (["brightness", "contrast", "saturation"].includes(operation.type)) {
      const result = await adjustRoomImage(current, operation.parameters as unknown as RoomColorAdjustments, encodingOptions); current = new File([result.blob], result.name, { type: result.blob.type }); width = result.width; height = result.height;
    } else if (operation.type === "compression") {
      const format = String(operation.parameters.format || "auto") as "auto" | RoomConversionFormat;
      if (!["auto", "jpeg", "png", "webp", "avif"].includes(format)) throw new Error("Invalid compression format");
      const result = await compressRoomImageTask(current, format, new AbortController().signal); current = new File([result.blob], result.name, { type: result.blob.type }); width = result.width; height = result.height;
    } else if (operation.type === "other" && operation.parameters.format) {
      const format = String(operation.parameters.format) as RoomConversionFormat;
      if (!["jpeg", "png", "webp", "avif"].includes(format)) throw new Error("Invalid conversion format");
      const result = await convertRoomImageTask(current, format, new AbortController().signal); current = new File([result.blob], result.name, { type: result.blob.type }); width = result.width; height = result.height;
    } else if (operation.type === "other" && operation.parameters.review && Array.isArray(operation.parameters.annotations)) {
      const overlay = await renderReviewAnnotations(operation.parameters.annotations as ReviewAnnotation[], width, height);
      const [sourceBitmap, overlayBitmap] = await Promise.all([createImageBitmap(current), createImageBitmap(overlay)]);
      try { const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext("2d", { alpha: true }); if (!context) throw new Error("Canvas is unavailable"); context.drawImage(sourceBitmap, 0, 0, width, height); context.drawImage(overlayBitmap, 0, 0, width, height); const blob = await canvas.convertToBlob({ type: "image/png" }); current = new File([blob], current.name.replace(/\.[^.]+$/, "") + "-doodle.png", { type: blob.type }); } finally { sourceBitmap.close(); overlayBitmap.close(); }
    }
  }
  return { blob: current as Blob, name: current.name, mimeType: current.type, width, height };
}
