export const IMAGE_PROTOCOL_VERSION = 1 as const;

export type ImageOperationType =
  | "crop" | "color" | "draw" | "rotate" | "resize"
  | "filter" | "annotation" | "ai";

export type ImageOperation = {
  id: string;
  userId: string;
  time: number;
  type: ImageOperationType;
  params: Record<string, unknown>;
};

export type ImageParameterDocument = {
  version: typeof IMAGE_PROTOCOL_VERSION;
  operations: ImageOperation[];
};

export function emptyImageParameterDocument(): ImageParameterDocument {
  return { version: IMAGE_PROTOCOL_VERSION, operations: [] };
}

export function appendImageOperation(
  document: ImageParameterDocument,
  operation: ImageOperation,
): ImageParameterDocument {
  return { version: IMAGE_PROTOCOL_VERSION, operations: [...document.operations, operation] };
}

export function setImageOperation(
  document: ImageParameterDocument,
  operation: ImageOperation,
): ImageParameterDocument {
  const index = document.operations.findIndex((candidate) => candidate.type === operation.type);
  if (index < 0) return appendImageOperation(document, operation);
  const operations = document.operations.filter((candidate) => candidate.type !== operation.type);
  operations.splice(index, 0, operation);
  return { version: IMAGE_PROTOCOL_VERSION, operations };
}

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
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<ImageParameterDocument>;
  if (document.version !== IMAGE_PROTOCOL_VERSION
    || !Array.isArray(document.operations)
    || document.operations.length > 100) return false;
  const operationIds = new Set<string>();
  return document.operations.every((operation) => {
    if (!operation
      || typeof operation.id !== "string"
      || operationIds.has(operation.id)
      || typeof operation.userId !== "string"
      || typeof operation.time !== "number"
      || !Number.isFinite(operation.time)
      || typeof operation.type !== "string"
      || typeof operation.params !== "object"
      || operation.params === null
      || Array.isArray(operation.params)) return false;
    operationIds.add(operation.id);
    return true;
  });
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
