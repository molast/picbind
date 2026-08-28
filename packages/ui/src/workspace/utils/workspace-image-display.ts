import type { WorkspaceImage } from "../types";
import type { WorkspaceIdentity } from "../types";
import { canRenderFromCollaborationSource } from "../image-flow";

export async function dimensions(file: Blob) {
  const bitmap = await createImageBitmap(file);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
}

export function blobFromBytes(value: unknown, mimeType: string) {
  return value instanceof ArrayBuffer ? new Blob([value], { type: mimeType }) : Array.isArray(value) ? new Blob([new Uint8Array(value.map(Number)).buffer as ArrayBuffer], { type: mimeType }) : null;
}

export function placeholderFrom(value: unknown): WorkspaceImage["placeholder"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.width) && Number(candidate.width) > 0
    && Number.isFinite(candidate.height) && Number(candidate.height) > 0
    && typeof candidate.dominantColor === "string"
    && typeof candidate.blurHash === "string"
    ? candidate as WorkspaceImage["placeholder"]
    : undefined;
}

export function collaborationPreviewFor(image: WorkspaceImage, workspace: WorkspaceIdentity | null, containers: Map<string, { sourceKind: "source" | "preview"; workingBlob?: Blob }>) {
  const container = containers.get(image.imageId);
  const usesRenderedState = image.shared || Boolean(image.parameterDocument?.operations.length);
  return usesRenderedState && workspace && container && canRenderFromCollaborationSource(workspace.role, container.sourceKind === "source") ? container.workingBlob : undefined;
}

export function collaborationCardPreviewFor(image: WorkspaceImage, workspace: WorkspaceIdentity | null, containers: Map<string, { sourceKind: "source" | "preview"; cardPreview?: { artifact: { url: string } } | null }>) {
  const container = containers.get(image.imageId);
  if ((!image.shared && !image.parameterDocument?.operations.length) || !workspace || !container
    || !canRenderFromCollaborationSource(workspace.role, container.sourceKind === "source")) return undefined;
  return container.cardPreview?.artifact.url;
}

export function workspaceRenderedDimensions(image: Pick<WorkspaceImage, "width" | "height" | "parameterDocument">) {
  let width = image.width;
  let height = image.height;
  for (const operation of image.parameterDocument?.operations || []) {
    if (operation.type === "crop") {
      const cropWidth = Number(operation.params.width);
      const cropHeight = Number(operation.params.height);
      if (Number.isFinite(cropWidth) && cropWidth > 0) width = Math.max(1, Math.round(width * cropWidth));
      if (Number.isFinite(cropHeight) && cropHeight > 0) height = Math.max(1, Math.round(height * cropHeight));
    } else if (operation.type === "resize") {
      const nextWidth = Number(operation.params.width);
      const nextHeight = Number(operation.params.height);
      if (Number.isFinite(nextWidth) && nextWidth > 0) width = Math.round(nextWidth);
      if (Number.isFinite(nextHeight) && nextHeight > 0) height = Math.round(nextHeight);
    } else if (operation.type === "rotate" && [90, 270].includes(Number(operation.params.degrees))) {
      [width, height] = [height, width];
    }
  }
  return { width, height };
}
