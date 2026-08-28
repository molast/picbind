import React from "react";
import { useImageProcessing } from "../../image-processing";
import {
  emptyImageParameterDocument,
  imageParameterDocumentsEqual,
  type ImageOperationType,
} from "../image-protocol";
import { dimensions } from "../utils/workspace-image-display";
import type { WorkspaceImage } from "../types";
import type { WorkspaceCardOperation } from "../components/workspace-gallery-card";
import { adoptCollaborationEditorPreview, clearCollaborationEditorPreview, type CollaborationImageContainer } from "../collaboration-image-container";
import type { WorkspaceProcessingSource } from "./use-workspace-preview";

export function useWorkspaceOperationEditor({ imagesRef, collaborationContainers, loadSource, setSelectedId, setProcessingSource, setEditing, setReviewOpen, setEditorPreparing, setNotice, }: {
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  loadSource: (image: WorkspaceImage, materialize?: boolean) => Promise<Blob | null>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setProcessingSource: React.Dispatch<React.SetStateAction<WorkspaceProcessingSource | null>>;
  setEditing: React.Dispatch<React.SetStateAction<any>>;
  setReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditorPreparing: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
}) {
  const imageProcessing = useImageProcessing();
  const openSequence = React.useRef(0);
  const activeImageId = React.useRef<string | null>(null);
  const openImageOperation = React.useCallback(async (image: WorkspaceImage, operation: WorkspaceCardOperation) => {
    const parameterType: Partial<Record<WorkspaceCardOperation, ImageOperationType>> = { crop: "crop", resize: "resize", adjust: "color", review: "draw" };
    const editableParameterType = parameterType[operation];
    const requestSequence = ++openSequence.current;
    activeImageId.current = image.imageId;
    const usesParameterDocument = Boolean(editableParameterType && image.workspaceLocation === "working");
    setEditorPreparing(usesParameterDocument);
    if (!usesParameterDocument) {
      const source = await loadSource(image, false);
      if (openSequence.current !== requestSequence) return;
      if (!source) { setEditorPreparing(false); setNotice("Source data is unavailable"); return; }
      const sourceSize = await dimensions(source);
      if (openSequence.current !== requestSequence) return;
      const temporaryPreview = source.slice(0, source.size, source.type);
      const container = collaborationContainers.current.get(image.imageId);
      if (container && !container.disposed) {
        collaborationContainers.current.set(image.imageId, adoptCollaborationEditorPreview(container, temporaryPreview));
      }
      setSelectedId(image.imageId);
      setProcessingSource({ imageId: image.imageId, blob: temporaryPreview, posterBlob: temporaryPreview, editorBaseReady: true, ...sourceSize });
      setEditorPreparing(false);
      if (operation === "review") setReviewOpen(true); else setEditing(operation);
      return;
    }

    let container = collaborationContainers.current.get(image.imageId);
    let loadedSource: Blob | null = null;
    let immediatePreview = container?.workingBlob || null;
    if (!immediatePreview) {
      loadedSource = await loadSource(image, false);
      container = collaborationContainers.current.get(image.imageId) || container;
      immediatePreview = container?.workingBlob || loadedSource;
    }
    if (openSequence.current !== requestSequence) return;
    if (!immediatePreview) { setEditorPreparing(false); setNotice("Source data is unavailable"); return; }

    const parameterDocument = container?.parameterDocument || image.parameterDocument || emptyImageParameterDocument();
    const baseDocument = {
      ...parameterDocument,
      operations: parameterDocument.operations.filter((candidate) => candidate.type !== editableParameterType),
    };
    const previewMatchesBase = container
      ? imageParameterDocumentsEqual(container.parameterDocument, baseDocument)
      : parameterDocument.operations.length === 0;
    const waitForEditorBase = operation === "crop" && !previewMatchesBase;
    const immediateSize = container
      ? { width: container.width, height: container.height }
      : { width: image.width, height: image.height };

    setSelectedId(image.imageId);
    const temporaryPreview = immediatePreview.slice(0, immediatePreview.size, immediatePreview.type);
    if (!waitForEditorBase) {
      if (container) {
        container = adoptCollaborationEditorPreview(container, temporaryPreview);
        collaborationContainers.current.set(image.imageId, container);
      }
      setProcessingSource({
        imageId: image.imageId,
        blob: temporaryPreview,
        posterBlob: temporaryPreview,
        editorBaseReady: previewMatchesBase,
        ...immediateSize,
      });
      setEditorPreparing(false);
      if (operation === "review") setReviewOpen(true); else setEditing(operation);
    }
    if (previewMatchesBase) return;

    const source = container?.originalBlob || loadedSource || await loadSource(image, false);
    container = collaborationContainers.current.get(image.imageId) || container;
    const renderSource = container?.originalBlob || source;
    if (openSequence.current !== requestSequence) return;
    if (!renderSource) {
      const current = collaborationContainers.current.get(image.imageId);
      if (current && !current.disposed && current.editorPreviewBlob) {
        collaborationContainers.current.set(image.imageId, clearCollaborationEditorPreview(current));
      }
      activeImageId.current = null;
      setEditing(null);
      setReviewOpen(false);
      setProcessingSource(null);
      setEditorPreparing(false);
      setNotice("Editor base image is unavailable");
      return;
    }
    void imageProcessing.renderPreview({
      source: { kind: "blob", blob: renderSource, name: image.name, mimeType: image.mimeType, cacheKey: container?.cacheKey },
      document: baseDocument,
      maxWidth: 960,
      maxHeight: 720,
      mimeType: "image/webp",
      quality: 0.86,
    }, { requestId: `workspace-editor:${image.imageId}:${requestSequence}` }).then((result) => {
      if (openSequence.current !== requestSequence) return;
      if (result.artifact.kind !== "blob") throw new Error("Editor preview did not return a Blob");
      const current = collaborationContainers.current.get(image.imageId);
      if (current && !current.disposed) {
        collaborationContainers.current.set(image.imageId, adoptCollaborationEditorPreview(current, result.artifact.blob));
      }
      setProcessingSource({
        imageId: image.imageId,
        blob: result.artifact.blob,
        posterBlob: waitForEditorBase ? result.artifact.blob : temporaryPreview,
        editorBaseReady: true,
        width: result.width,
        height: result.height,
      });
      if (waitForEditorBase) {
        setEditorPreparing(false);
        setEditing(operation);
      }
    }).catch((error) => {
      if (openSequence.current !== requestSequence) return;
      const current = collaborationContainers.current.get(image.imageId);
      if (current && !current.disposed && current.editorPreviewBlob) {
        collaborationContainers.current.set(image.imageId, clearCollaborationEditorPreview(current));
      }
      activeImageId.current = null;
      setEditing(null);
      setReviewOpen(false);
      setProcessingSource(null);
      setEditorPreparing(false);
      setNotice(error instanceof Error ? error.message : "Editor preview is unavailable");
    });
  }, [collaborationContainers, imageProcessing, loadSource, setEditing, setEditorPreparing, setNotice, setProcessingSource, setReviewOpen, setSelectedId]);
  const releaseProcessingSource = React.useCallback(() => {
    openSequence.current += 1;
    const imageId = activeImageId.current;
    activeImageId.current = null;
    const container = imageId ? collaborationContainers.current.get(imageId) : null;
    if (container && !container.disposed && container.editorPreviewBlob) {
      collaborationContainers.current.set(imageId!, clearCollaborationEditorPreview(container));
    }
    setEditorPreparing(false);
    setProcessingSource(null);
  }, [collaborationContainers, setEditorPreparing, setProcessingSource]);
  return { openImageOperation, releaseProcessingSource };
}
