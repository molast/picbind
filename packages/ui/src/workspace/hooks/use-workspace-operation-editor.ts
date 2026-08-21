import React from "react";
import { readWorkspaceImageSource } from "../repository";
import { emptyImageParameterDocument, type ImageOperationType } from "../image-protocol";
import { dimensions } from "../utils/workspace-image-display";
import { parameterDocumentOperations } from "../utils/workspace-operation-mapping";
import { renderWorkspaceParameterPreview } from "../parameter-preview";
import type { WorkspaceImage } from "../types";
import type { WorkspaceCardOperation } from "../components/workspace-gallery-card";

export function useWorkspaceOperationEditor({ imagesRef, collaborationContainers, loadSource, setSelectedId, setProcessingSource, setEditing, setReviewOpen, setEditorPreparing, setNotice, }: {
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, { sourceKind: string; source: Blob; sourceWidth: number; sourceHeight: number }>>;
  loadSource: (image: WorkspaceImage, materialize?: boolean) => Promise<Blob | null>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setProcessingSource: React.Dispatch<React.SetStateAction<{ imageId: string; blob: Blob; width: number; height: number } | null>>;
  setEditing: React.Dispatch<React.SetStateAction<any>>;
  setReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditorPreparing: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
}) {
  const openSequence = React.useRef(0);
  const openImageOperation = React.useCallback(async (image: WorkspaceImage, operation: WorkspaceCardOperation) => {
    const parameterType: Partial<Record<WorkspaceCardOperation, ImageOperationType>> = { crop: "crop", resize: "resize", adjust: "color", review: "draw" };
    const editableParameterType = parameterType[operation];
    const requestSequence = ++openSequence.current;
    setEditorPreparing(Boolean(editableParameterType && image.shared));
    const container = image.shared ? collaborationContainers.current.get(image.imageId) : null;
    const source = editableParameterType && container?.sourceKind === "source"
      ? container.source
      : editableParameterType && image.shared ? await readWorkspaceImageSource(image) : await loadSource(image, image.shared);
    if (openSequence.current !== requestSequence) return;
    if (!source) { setEditorPreparing(false); setNotice("Source data is unavailable"); return; }
    const sourceSize = editableParameterType && image.shared
      ? { width: container?.sourceWidth || image.width, height: container?.sourceHeight || image.height }
      : await dimensions(source);
    if (openSequence.current !== requestSequence) return;
    setSelectedId(image.imageId);
    setProcessingSource({ imageId: image.imageId, blob: source, ...sourceSize });
    if (operation === "review") setReviewOpen(true); else setEditing(operation);
    if (editableParameterType && image.shared) {
      const parameterDocument = image.parameterDocument || emptyImageParameterDocument();
      const baseDocument = { ...parameterDocument, operations: parameterDocument.operations.filter((candidate) => candidate.type !== editableParameterType) };
      void renderWorkspaceParameterPreview(source, sourceSize, parameterDocumentOperations({ ...image, parameterDocument: baseDocument })).then((result) => {
        if (openSequence.current !== requestSequence) return;
        setEditorPreparing(false);
        setProcessingSource({ imageId: image.imageId, blob: result.blob, width: result.width, height: result.height });
      }).catch((error) => {
        if (openSequence.current !== requestSequence) return;
        setEditorPreparing(false);
        setNotice(error instanceof Error ? error.message : "Editor preview is unavailable");
      });
    }
  }, [collaborationContainers, loadSource, setEditing, setEditorPreparing, setNotice, setProcessingSource, setReviewOpen, setSelectedId]);
  const releaseProcessingSource = React.useCallback(() => {
    openSequence.current += 1;
    setEditorPreparing(false);
    setProcessingSource(null);
  }, [setEditorPreparing, setProcessingSource]);
  return { openImageOperation, releaseProcessingSource };
}
