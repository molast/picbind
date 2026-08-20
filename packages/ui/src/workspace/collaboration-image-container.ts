import type { ImageParameterDocument } from "./image-protocol";
import type { WorkspaceOperation } from "./types";

export type CollaborationRenderResult = {
  blob: Blob;
  name: string;
  mimeType: string;
  width: number;
  height: number;
};

export type CollaborationImageContainer = {
  imageId: string;
  source: Blob;
  sourceKind: "source" | "preview";
  sourceWidth: number;
  sourceHeight: number;
  rendered: Blob;
  preview: Blob;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  parameterDocument: ImageParameterDocument;
  disposed: boolean;
};

export type CollaborationRenderer = (
  source: Blob,
  operations: WorkspaceOperation[],
) => Promise<CollaborationRenderResult>;

export function createCollaborationImageContainer(input: Omit<CollaborationImageContainer, "rendered" | "preview" | "disposed" | "sourceWidth" | "sourceHeight">) {
  return { ...input, sourceWidth: input.width, sourceHeight: input.height, rendered: input.source, preview: input.source, disposed: false };
}

export function adoptCollaborationRender(
  container: CollaborationImageContainer,
  parameterDocument: ImageParameterDocument,
  result: CollaborationRenderResult,
) {
  if (container.disposed) throw new Error("Collaboration image container is disposed");
  return {
    ...container,
    parameterDocument,
    rendered: result.blob,
    preview: result.blob,
    name: result.name,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
  };
}

export function adoptCollaborationPreview(
  container: CollaborationImageContainer,
  parameterDocument: ImageParameterDocument,
  result: Pick<CollaborationRenderResult, "blob" | "width" | "height">,
) {
  if (container.disposed) throw new Error("Collaboration image container is disposed");
  return {
    ...container,
    parameterDocument,
    preview: result.blob,
    width: result.width,
    height: result.height,
  };
}

export async function replaceCollaborationDocument(
  container: CollaborationImageContainer,
  parameterDocument: ImageParameterDocument,
  operations: WorkspaceOperation[],
  render: CollaborationRenderer,
) {
  if (container.disposed) throw new Error("Collaboration image container is disposed");
  if (!operations.length) {
    return {
      ...container,
      parameterDocument,
      rendered: container.source,
      preview: container.source,
      width: container.sourceWidth,
      height: container.sourceHeight,
    };
  }
  return adoptCollaborationRender(container, parameterDocument, await render(container.source, operations));
}

export function disposeCollaborationImageContainer(container: CollaborationImageContainer) {
  return { ...container, source: new Blob(), rendered: new Blob(), preview: new Blob(), disposed: true };
}
