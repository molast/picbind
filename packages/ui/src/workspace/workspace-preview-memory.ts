"use client";

import type { ImageParameterDocument } from "./image-protocol";
import { imageParameterDocumentsEqual } from "./image-protocol";
import { decodeWorkspaceImage, type DecodedWorkspaceImage } from "./image-decoder";
import { initWasm } from "../utils/wasm-runtime";
import { normalizePreviewColor, type WorkspacePreviewColor } from "./workspace-preview-color";

type MaterializedPixelsHandle = {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  free(): void;
};

export type WorkspacePreviewMemory = {
  readonly imageId: string;
  readonly originalSurface: HTMLCanvasElement;
  surface: HTMLCanvasElement;
  width: number;
  height: number;
  revision: number;
  document: ImageParameterDocument;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasDirectChanges: boolean;
  readonly directOperations: readonly WorkspacePreviewDirectOperation[];
  surfaceFor(document: ImageParameterDocument): Promise<HTMLCanvasElement>;
  apply(document: ImageParameterDocument): Promise<void>;
  applyDirect(operation: WorkspacePreviewDirectOperation): Promise<void>;
  undo(): void;
  redo(): void;
  dispose(): void;
};

export type WorkspacePreviewDirectOperation =
  | { type: "crop"; params: { x: number; y: number; width: number; height: number; shape?: "rectangle" | "ellipse" | "lasso" | "smart"; points?: Array<{ x: number; y: number }>; path?: Array<{ x: number; y: number }>; mask?: Uint8Array; masked?: boolean } }
  | { type: "resize"; params: { width: number; height: number } }
  | { type: "rotate"; params: { degrees: number } }
  | { type: "flip"; params: { horizontal?: boolean; vertical?: boolean } }
  | { type: "fillBackground"; params: { color: WorkspacePreviewColor } };

type DirectHistoryEntry = {
  operation: WorkspacePreviewDirectOperation;
  before: HTMLCanvasElement;
  after: HTMLCanvasElement;
};

function documentKey(document: ImageParameterDocument) {
  return JSON.stringify(document);
}

type PreviewMemoryRuntime = {
  decode(blob: Blob): Promise<DecodedWorkspaceImage>;
  render(original: HTMLCanvasElement, document: ImageParameterDocument): Promise<HTMLCanvasElement>;
};

const MAX_CACHED_SURFACES = 3;

function releaseSurface(surface: HTMLCanvasElement) {
  surface.width = surface.height = 1;
}

function transformedCanvas(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  draw(context);
  return canvas;
}

function applyDirectOperation(source: HTMLCanvasElement, operation: WorkspacePreviewDirectOperation) {
  if (operation.type === "crop") {
    const { x, y, width, height, shape = "rectangle", points, path, mask } = operation.params;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.00001 || y + height > 1.00001) throw new Error("Invalid selection");
    const pathPoints = (path?.length || 0) >= 3
      ? path
      : (points?.length || 0) >= 3 ? points : undefined;
    const pathBounds = pathPoints?.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      ? pathPoints.reduce((bounds, point) => ({
        left: Math.min(bounds.left, point.x),
        top: Math.min(bounds.top, point.y),
        right: Math.max(bounds.right, point.x),
        bottom: Math.max(bounds.bottom, point.y),
      }), { left: 1, top: 1, right: 0, bottom: 0 })
      : null;
    const cropX = pathBounds && pathBounds.right > pathBounds.left ? Math.max(0, Math.min(1, pathBounds.left)) : x;
    const cropY = pathBounds && pathBounds.bottom > pathBounds.top ? Math.max(0, Math.min(1, pathBounds.top)) : y;
    const cropRight = pathBounds && pathBounds.right > pathBounds.left ? Math.max(cropX, Math.min(1, pathBounds.right)) : Math.min(1, x + width);
    const cropBottom = pathBounds && pathBounds.bottom > pathBounds.top ? Math.max(cropY, Math.min(1, pathBounds.bottom)) : Math.min(1, y + height);
    const sourceX = Math.min(source.width - 1, Math.floor(cropX * source.width));
    const sourceY = Math.min(source.height - 1, Math.floor(cropY * source.height));
    const sourceWidth = Math.max(1, Math.min(source.width - sourceX, Math.ceil(cropRight * source.width) - sourceX));
    const sourceHeight = Math.max(1, Math.min(source.height - sourceY, Math.ceil(cropBottom * source.height) - sourceY));
    return transformedCanvas(sourceWidth, sourceHeight, (context) => {
      if (pathPoints && pathPoints.length >= 3 && pathPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
        context.beginPath();
        context.moveTo(pathPoints[0].x * source.width - sourceX, pathPoints[0].y * source.height - sourceY);
        pathPoints.slice(1).forEach((point) => context.lineTo(point.x * source.width - sourceX, point.y * source.height - sourceY));
        context.closePath();
        context.clip();
      } else if (shape === "ellipse") {
        context.beginPath();
        context.ellipse(sourceWidth / 2, sourceHeight / 2, sourceWidth / 2, sourceHeight / 2, 0, 0, Math.PI * 2);
        context.clip();
      }
      context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      if (shape === "smart" && mask) {
        const pixels = context.getImageData(0, 0, sourceWidth, sourceHeight);
        for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
          if (!mask[(sourceY + y) * source.width + sourceX + x]) pixels.data[(y * sourceWidth + x) * 4 + 3] = 0;
        }
        context.putImageData(pixels, 0, 0);
      }
    });
  }
  if (operation.type === "resize") {
    const width = Math.max(1, Math.min(16384, Math.round(operation.params.width)));
    const height = Math.max(1, Math.min(16384, Math.round(operation.params.height)));
    return transformedCanvas(width, height, (context) => {
      context.drawImage(source, 0, 0, width, height);
    });
  }
  if (operation.type === "flip") {
    const horizontal = operation.params.horizontal !== false;
    const vertical = Boolean(operation.params.vertical);
    return transformedCanvas(source.width, source.height, (context) => {
      context.translate(horizontal ? source.width : 0, vertical ? source.height : 0);
      context.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
      context.drawImage(source, 0, 0);
    });
  }
  if (operation.type === "fillBackground") {
    const color = normalizePreviewColor(operation.params.color);
    return transformedCanvas(source.width, source.height, (context) => {
      if (color.a > 0) {
        context.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
        context.fillRect(0, 0, source.width, source.height);
      }
      context.drawImage(source, 0, 0);
    });
  }
  const degrees = Number(operation.params.degrees);
  if (!Number.isFinite(degrees)) throw new Error("Invalid rotation");
  const radians = degrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const rightAngle = ((degrees % 360) + 360) % 360;
  const width = rightAngle === 90 || rightAngle === 270 ? source.height : Math.max(1, Math.ceil(source.width * cosine + source.height * sine));
  const height = rightAngle === 90 || rightAngle === 270 ? source.width : Math.max(1, Math.ceil(source.width * sine + source.height * cosine));
  return transformedCanvas(width, height, (context) => {
    context.translate(width / 2, height / 2);
    context.rotate(radians);
    context.drawImage(source, -source.width / 2, -source.height / 2);
  });
}

function canvasFromPixels(handle: MaterializedPixelsHandle) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = handle.width;
    canvas.height = handle.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.putImageData(new ImageData(
      new Uint8ClampedArray(handle.bytes),
      handle.width,
      handle.height,
    ), 0, 0);
    return canvas;
  } finally {
    handle.free();
  }
}

async function renderDocument(
  originalSurface: HTMLCanvasElement,
  parameterDocument: ImageParameterDocument,
) {
  if (!parameterDocument.operations.length) return originalSurface;
  const context = originalSurface.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable");
  const pixels = context.getImageData(0, 0, originalSurface.width, originalSurface.height);
  const mod = await initWasm();
  return canvasFromPixels(mod.materialize_rgba_operations_to_rgba(
    new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
    pixels.width,
    pixels.height,
    JSON.stringify(parameterDocument),
  ) as MaterializedPixelsHandle);
}

export async function createWorkspacePreviewMemory(
  imageId: string,
  blob: Blob,
  parameterDocument: ImageParameterDocument,
  runtime: PreviewMemoryRuntime = { decode: decodeWorkspaceImage, render: renderDocument },
): Promise<WorkspacePreviewMemory> {
  const decoded = await runtime.decode(blob);
  const originalSurface = document.createElement("canvas");
  originalSurface.width = decoded.width;
  originalSurface.height = decoded.height;
  const context = originalSurface.getContext("2d", { willReadFrequently: true });
  if (!context) {
    decoded.dispose();
    throw new Error("Canvas 2D is unavailable");
  }
  try {
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
  } catch (error) {
    releaseSurface(originalSurface);
    throw error;
  } finally {
    decoded.dispose();
  }

  const cachedSurfaces = new Map<string, HTMLCanvasElement>();
  let initialSurface: HTMLCanvasElement;
  try {
    initialSurface = await runtime.render(originalSurface, parameterDocument);
  } catch (error) {
    releaseSurface(originalSurface);
    throw error;
  }
  cachedSurfaces.set(documentKey(parameterDocument), initialSurface);
  const pendingSurfaces = new Map<string, Promise<HTMLCanvasElement>>();
  let disposed = false;
  let applySequence = 0;
  const undoStack: DirectHistoryEntry[] = [];
  const redoStack: DirectHistoryEntry[] = [];

  const setCurrentSurface = (surface: HTMLCanvasElement) => {
    memory.surface = surface;
    memory.width = surface.width;
    memory.height = surface.height;
    memory.revision += 1;
  };

  const memory: WorkspacePreviewMemory = {
    imageId,
    originalSurface,
    surface: initialSurface,
    width: initialSurface.width,
    height: initialSurface.height,
    revision: 0,
    document: parameterDocument,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get hasDirectChanges() { return undoStack.length > 0; },
    get directOperations() { return undoStack.map((entry) => entry.operation); },
    async surfaceFor(nextDocument) {
      if (disposed) throw new Error("Workspace preview memory is disposed");
      if (imageParameterDocumentsEqual(memory.document, nextDocument)) return memory.surface;
      const key = documentKey(nextDocument);
      const cached = cachedSurfaces.get(key);
      if (cached) {
        cachedSurfaces.delete(key);
        cachedSurfaces.set(key, cached);
        return cached;
      }
      const pending = pendingSurfaces.get(key);
      if (pending) return pending;
      const task = (async () => {
        const rendered = await runtime.render(originalSurface, nextDocument);
        if (disposed) {
          if (rendered !== originalSurface) releaseSurface(rendered);
          throw new Error("Workspace preview memory is disposed");
        }
        cachedSurfaces.set(key, rendered);
        while (cachedSurfaces.size > MAX_CACHED_SURFACES) {
          const oldestKey = cachedSurfaces.keys().next().value;
          if (oldestKey === undefined) break;
          // Editors may still hold an evicted canvas. Drop ownership without resizing it.
          cachedSurfaces.delete(oldestKey);
        }
        return rendered;
      })().finally(() => pendingSurfaces.delete(key));
      pendingSurfaces.set(key, task);
      return task;
    },
    async apply(nextDocument) {
      const sequence = ++applySequence;
      const nextSurface = await memory.surfaceFor(nextDocument);
      if (disposed) throw new Error("Workspace preview memory is disposed");
      if (sequence !== applySequence || imageParameterDocumentsEqual(memory.document, nextDocument)) return;
      undoStack.length = 0;
      redoStack.length = 0;
      setCurrentSurface(nextSurface);
      memory.document = nextDocument;
    },
    async applyDirect(operation) {
      if (disposed) throw new Error("Workspace preview memory is disposed");
      const before = memory.surface;
      const after = applyDirectOperation(before, operation);
      undoStack.push({ operation, before, after });
      const abandoned = redoStack.map((entry) => entry.after);
      redoStack.length = 0;
      abandoned.forEach((surface) => { if (surface !== originalSurface && !cachedSurfacesHas(surface)) releaseSurface(surface); });
      setCurrentSurface(after);
    },
    undo() {
      if (disposed || !undoStack.length) return;
      const entry = undoStack.pop()!;
      redoStack.push(entry);
      setCurrentSurface(entry.before);
    },
    redo() {
      if (disposed || !redoStack.length) return;
      const entry = redoStack.pop()!;
      undoStack.push(entry);
      setCurrentSurface(entry.after);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const surfaces = new Set([
        originalSurface,
        memory.surface,
        ...cachedSurfaces.values(),
        ...undoStack.flatMap((entry) => [entry.before, entry.after]),
        ...redoStack.flatMap((entry) => [entry.before, entry.after]),
      ]);
      surfaces.forEach(releaseSurface);
      cachedSurfaces.clear();
    },
  };
  function cachedSurfacesHas(surface: HTMLCanvasElement) {
    return [...cachedSurfaces.values()].includes(surface);
  }
  return memory;
}
