import React from "react";
import { readWorkspaceImagePreview, readWorkspaceImageSource } from "../repository";
import { emptyImageParameterDocument, imageParameterDocumentsEqual, type ImageParameterDocument } from "../image-protocol";
import {
  adoptCollaborationPreview, createCollaborationImageContainer, replaceCollaborationDocument,
  type CollaborationImageContainer,
} from "../collaboration-image-container";
import { renderWorkspaceParameterPreview } from "../parameter-preview";
import { parameterDocumentOperations } from "../utils/workspace-operation-mapping";
import { dimensions } from "../utils/workspace-image-display";
import { replayOperations } from "../utils/workspace-operation-replay";
import type { WorkspaceImage } from "../types";

export function useWorkspaceCollaborationPreview({ imagesRef, collaborationContainers, refresh, processingSource, }: {
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  refresh: () => void;
  processingSource: { imageId: string; blob: Blob } | null;
}) {
  const renderSequence = React.useRef(0);
  const latestRenders = React.useRef(new Map<string, number>());

  const syncCollaborationPreview = React.useCallback(async (
    image: WorkspaceImage,
    parameterDocument = image.parameterDocument || emptyImageParameterDocument(),
    sourceOverride?: Blob,
  ) => {
    const requestSequence = ++renderSequence.current;
    latestRenders.current.set(image.imageId, requestSequence);
    let container = collaborationContainers.current.get(image.imageId);
    let created = false;
    if (sourceOverride) {
      container = createCollaborationImageContainer({ imageId: image.imageId, source: sourceOverride, sourceKind: "source", name: image.name,
        mimeType: image.mimeType, width: image.width, height: image.height, parameterDocument: emptyImageParameterDocument() });
      collaborationContainers.current.set(image.imageId, container);
      refresh();
      created = true;
    } else if (!container || container.disposed) {
      const original = image.sourceCached ? await readWorkspaceImageSource(image) : null;
      const source = original || await readWorkspaceImagePreview(image);
      if (!source) return null;
      if (latestRenders.current.get(image.imageId) !== requestSequence) return collaborationContainers.current.get(image.imageId) || null;
      container = createCollaborationImageContainer({ imageId: image.imageId, source, sourceKind: original ? "source" : "preview", name: image.name,
        mimeType: image.mimeType, width: image.width, height: image.height, parameterDocument: emptyImageParameterDocument() });
      collaborationContainers.current.set(image.imageId, container);
      created = true;
    }
    if (imageParameterDocumentsEqual(container.parameterDocument, parameterDocument)) {
      if (created) refresh();
      return container;
    }
    const result = await renderWorkspaceParameterPreview(container.source, { width: container.sourceWidth, height: container.sourceHeight }, parameterDocumentOperations({ ...image, parameterDocument }));
    if (latestRenders.current.get(image.imageId) !== requestSequence) return collaborationContainers.current.get(image.imageId) || null;
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.workspaceLocation === "working")) {
      collaborationContainers.current.delete(image.imageId);
      latestRenders.current.delete(image.imageId);
      return null;
    }
    const previewed = adoptCollaborationPreview(container, parameterDocument, result);
    collaborationContainers.current.set(image.imageId, previewed);
    refresh();
    return previewed;
  }, [collaborationContainers, imagesRef, refresh]);

  const renderCollaborationPreviewSnapshot = React.useCallback(async (image: WorkspaceImage, parameterDocument: ImageParameterDocument) => {
    const container = collaborationContainers.current.get(image.imageId);
    let source: Blob | null = null;
    let width = image.width;
    let height = image.height;
    if (container && !container.disposed) {
      source = container.source;
      width = container.sourceWidth;
      height = container.sourceHeight;
    } else {
      source = image.sourceCached ? await readWorkspaceImageSource(image) : null;
      source ||= await readWorkspaceImagePreview(image);
    }
    if (!source) return null;
    return renderWorkspaceParameterPreview(source, { width, height }, parameterDocumentOperations({ ...image, parameterDocument }));
  }, [collaborationContainers]);

  const syncCollaborationContainer = React.useCallback(async (image: WorkspaceImage, parameterDocument = image.parameterDocument || emptyImageParameterDocument()) => {
    let container = collaborationContainers.current.get(image.imageId);
    if (!container || container.disposed || container.sourceKind !== "source") {
      const source = await readWorkspaceImageSource(image);
      if (!source) return null;
      const sourceSize = await dimensions(source);
      container = createCollaborationImageContainer({ imageId: image.imageId, source, sourceKind: "source", name: image.name, mimeType: image.mimeType,
        width: sourceSize.width, height: sourceSize.height, parameterDocument: emptyImageParameterDocument() });
    }
    const rendered = await replaceCollaborationDocument(container, parameterDocument, parameterDocumentOperations({ ...image, parameterDocument }),
      (source, operations) => replayOperations({ ...image, source, width: container!.sourceWidth, height: container!.sourceHeight }, operations));
    collaborationContainers.current.set(image.imageId, rendered);
    return rendered;
  }, [collaborationContainers]);

  const loadSource = React.useCallback(async (image: WorkspaceImage, materialize = false) => {
    if (processingSource?.imageId === image.imageId) return processingSource.blob;
    const container = collaborationContainers.current.get(image.imageId);
    if (image.workspaceLocation === "working" && materialize) return (await syncCollaborationContainer(image, image.parameterDocument || emptyImageParameterDocument()))?.rendered || null;
    if (image.shared && container && !container.disposed) return container.preview;
    if (image.shared) return (await syncCollaborationPreview(image, image.parameterDocument || emptyImageParameterDocument()))?.preview || null;
    return readWorkspaceImageSource(image);
  }, [collaborationContainers, processingSource, syncCollaborationContainer, syncCollaborationPreview]);

  return { loadSource, syncCollaborationPreview, renderCollaborationPreviewSnapshot, syncCollaborationContainer };
}
