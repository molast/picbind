import { ImageProcessingError } from "./errors";
import {
  IMAGE_PARAMETER_DOCUMENT_VERSION,
  type ImageOperation,
  type ImageOperationType,
  type ImageParameterDocument,
  type ImageProcessingSource,
} from "./types";

const OPERATION_TYPES = new Set<ImageOperationType>([
  "crop", "color", "draw", "rotate", "resize", "filter", "annotation", "ai",
]);
const MAX_OPERATIONS = 100;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_OBJECT_DEPTH = 12;

function invalid(message: string): never {
  throw new ImageProcessingError("invalidRequest", message);
}

function finiteNumber(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} must be finite`);
  return value;
}

function validateStructuredValue(value: unknown, depth = 0): void {
  if (depth > MAX_OBJECT_DEPTH) invalid("Operation parameters are too deeply nested");
  if (typeof value === "number" && !Number.isFinite(value)) invalid("Operation parameters contain a non-finite number");
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) invalid("Operation parameter array is too large");
    value.forEach((entry) => validateStructuredValue(entry, depth + 1));
    return;
  }
  if (typeof value !== "object") invalid("Operation parameters must be structured data");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_COLLECTION_ITEMS) invalid("Operation parameter object is too large");
  entries.forEach(([, entry]) => validateStructuredValue(entry, depth + 1));
}

function validateOperation(operation: ImageOperation) {
  if (!operation || typeof operation !== "object") invalid("Operation must be an object");
  if (!operation.id || typeof operation.id !== "string") invalid("Operation id is required");
  if (typeof operation.userId !== "string") invalid("Operation userId is required");
  finiteNumber(operation.time, "Operation time");
  if (!OPERATION_TYPES.has(operation.type)) {
    throw new ImageProcessingError("unsupportedOperation", `Unsupported operation: ${String(operation.type)}`);
  }
  if (!operation.params || typeof operation.params !== "object" || Array.isArray(operation.params)) {
    invalid("Operation params must be an object");
  }
  validateStructuredValue(operation.params);

  if (operation.type === "crop") {
    const x = finiteNumber(operation.params.x, "Crop x");
    const y = finiteNumber(operation.params.y, "Crop y");
    const width = finiteNumber(operation.params.width, "Crop width");
    const height = finiteNumber(operation.params.height, "Crop height");
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      invalid("Crop bounds must be normalized inside the source image");
    }
  }
  if (operation.type === "resize") {
    const width = finiteNumber(operation.params.width, "Resize width");
    const height = finiteNumber(operation.params.height, "Resize height");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384) {
      invalid("Resize dimensions must be integers between 1 and 16384");
    }
  }
  if (operation.type === "rotate") {
    const degrees = finiteNumber(operation.params.degrees, "Rotation degrees");
    if (![90, 180, 270].includes(degrees)) invalid("Rotation must be 90, 180 or 270 degrees");
  }
}

export function validateImageParameterDocument(value: unknown): asserts value is ImageParameterDocument {
  if (!value || typeof value !== "object") invalid("Parameter document is required");
  const document = value as Partial<ImageParameterDocument>;
  if (document.version !== IMAGE_PARAMETER_DOCUMENT_VERSION) invalid("Unsupported parameter document version");
  if (!Array.isArray(document.operations) || document.operations.length > MAX_OPERATIONS) {
    invalid(`Parameter document supports at most ${MAX_OPERATIONS} operations`);
  }
  const ids = new Set<string>();
  for (const operation of document.operations) {
    validateOperation(operation);
    if (ids.has(operation.id)) invalid("Operation ids must be unique");
    ids.add(operation.id);
  }
}

export function validateImageProcessingSource(source: ImageProcessingSource) {
  if (!source || typeof source !== "object" || !source.name) invalid("Image source is required");
  if (source.kind === "blob") {
    if (!(source.blob instanceof Blob)) invalid("Blob source data is required");
    if (!source.mimeType.startsWith("image/")) invalid("Image source mimeType is invalid");
    return;
  }
  if (source.kind !== "stored" || !source.asset) invalid("Stored image reference is required");
  const asset = source.asset;
  if (!asset.id || !asset.revision || !asset.mimeType.startsWith("image/")) {
    invalid("Stored image reference is invalid");
  }
}

export function emptyImageParameterDocument(): ImageParameterDocument {
  return { version: IMAGE_PARAMETER_DOCUMENT_VERSION, operations: [] };
}

export function appendImageOperation(document: ImageParameterDocument, operation: ImageOperation): ImageParameterDocument {
  validateImageParameterDocument(document);
  validateOperation(operation);
  return { version: IMAGE_PARAMETER_DOCUMENT_VERSION, operations: [...document.operations, operation] };
}

export function setImageOperation(document: ImageParameterDocument, operation: ImageOperation): ImageParameterDocument {
  validateImageParameterDocument(document);
  validateOperation(operation);
  const index = document.operations.findIndex((candidate) => candidate.type === operation.type);
  if (index < 0) return appendImageOperation(document, operation);
  const operations = document.operations.filter((candidate) => candidate.type !== operation.type);
  operations.splice(index, 0, operation);
  return { version: IMAGE_PARAMETER_DOCUMENT_VERSION, operations };
}
