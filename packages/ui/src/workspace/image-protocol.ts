import {
  IMAGE_PARAMETER_DOCUMENT_VERSION,
  appendImageOperation,
  emptyImageParameterDocument,
  setImageOperation,
  validateImageParameterDocument,
  type ImageOperation,
  type ImageOperationType,
  type ImageParameterDocument,
} from "@picbind/shared";

export const IMAGE_PROTOCOL_VERSION = IMAGE_PARAMETER_DOCUMENT_VERSION;
export {
  appendImageOperation,
  emptyImageParameterDocument,
  setImageOperation,
  type ImageOperation,
  type ImageOperationType,
  type ImageParameterDocument,
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

export function imageParameterDocumentsEqual(
  left: ImageParameterDocument,
  right: ImageParameterDocument,
) {
  if (left.version !== right.version || left.operations.length !== right.operations.length) return false;
  return left.operations.every((operation, index) => {
    const candidate = right.operations[index];
    return operation.id === candidate.id
      && operation.userId === candidate.userId
      && operation.time === candidate.time
      && operation.type === candidate.type
      && stableJson(operation.params) === stableJson(candidate.params);
  });
}

export function isValidImageParameterDocument(value: unknown): value is ImageParameterDocument {
  try {
    validateImageParameterDocument(value);
    return true;
  } catch {
    return false;
  }
}

export function truncateImageParameterDocument(
  document: ImageParameterDocument,
  operationIds: ReadonlySet<string>,
): ImageParameterDocument {
  const firstRemovedIndex = document.operations.findIndex((operation) => !operationIds.has(operation.id));
  return {
    version: IMAGE_PROTOCOL_VERSION,
    operations: document.operations.slice(0, firstRemovedIndex === -1 ? document.operations.length : firstRemovedIndex),
  };
}
