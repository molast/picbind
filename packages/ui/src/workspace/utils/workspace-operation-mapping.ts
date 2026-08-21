import type { WorkspaceImage, WorkspaceOperation } from "../types";
import type { ImageOperationType } from "../image-protocol";

export function protocolOperationType(operation: WorkspaceOperation["type"], parameters: Record<string, unknown>): ImageOperationType {
  if (operation === "brightness" || operation === "contrast" || operation === "saturation") return "color";
  if (operation === "other" && parameters.review) return "draw";
  if (operation === "other") return "filter";
  if (operation === "compression") return "filter";
  return operation;
}

export function parameterDocumentOperations(image: WorkspaceImage): WorkspaceOperation[] {
  return (image.parameterDocument?.operations || []).map((operation) => {
    const explicitType = operation.params.workspaceOperationType;
    const type: WorkspaceOperation["type"] = typeof explicitType === "string"
      ? explicitType as WorkspaceOperation["type"]
      : operation.type === "color" ? "brightness"
        : operation.type === "filter" ? "other"
          : operation.type === "draw" ? "other"
            : operation.type === "crop" || operation.type === "resize" || operation.type === "rotate" ? operation.type : "other";
    const { workspaceOperationType: _workspaceOperationType, ...parameters } = operation.params;
    return { operationId: operation.id, imageId: image.imageId, authorId: operation.userId, baseCommitId: image.currentCommitId || `initial_${image.imageId}`, type, parameters, createdAt: operation.time };
  });
}

export function numberParameter(parameters: Record<string, unknown>, key: string) {
  const value = Number(parameters[key]);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${key}`);
  return value;
}
