import React from "react";
import { useImageProcessing } from "../../image-processing";
import { readWorkspaceImageSource } from "../repository";
import { type ImageOperationType, type ImageParameterDocument } from "../image-protocol";
import { dimensions } from "../utils/workspace-image-display";
import type { WorkspaceImage } from "../types";
import type { WorkspaceCardOperation } from "../components/workspace-gallery-card";

export function useWorkspaceOperationEditor({ imagesRef, collaborationContainers, loadSource, setSelectedId, setProcessingSource, setEditing, setReviewOpen, setEditorPreparing, setNotice, }: {
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, { sourceKind: string; source: Blob; preview: Blob; sourceWidth: number; sourceHeight: number; width: number; height: number; parameterDocument: ImageParameterDocument }>>;
  loadSource: (image: WorkspaceImage, materialize?: boolean) => Promise<Blob | null>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setProcessingSource: React.Dispatch<React.SetStateAction<{ imageId: string; blob: Blob; width: number; height: number } | null>>;
  setEditing: React.Dispatch<React.SetStateAction<any>>;
  setReviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditorPreparing: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
}) {
  const imageProcessing = useImageProcessing();
  const openSequence = React.useRef(0);
  const openImageOperation = React.useCallback(async (image: WorkspaceImage, operation: WorkspaceCardOperation) => {
    const parameterType: Partial<Record<WorkspaceCardOperation, ImageOperationType>> = { crop: "crop", resize: "resize", adjust: "color", review: "draw" };
    const editableParameterType = parameterType[operation];
    const requestSequence = ++openSequence.current;
    const usesParameterDocument = Boolean(editableParameterType && image.workspaceLocation === "working");
    setEditorPreparing(usesParameterDocument);
    let container = usesParameterDocument ? collaborationContainers.current.get(image.imageId) : null;
    if (usesParameterDocument) {
      await loadSource(image, false);
      container = collaborationContainers.current.get(image.imageId) || container;
    }
    const source = usesParameterDocument && container
      ? container.source
      : usesParameterDocument ? await readWorkspaceImageSource(image) : await loadSource(image, image.shared);
    if (openSequence.current !== requestSequence) return;
    if (!source) { setEditorPreparing(false); setNotice("Source data is unavailable"); return; }
    const sourceSize = usesParameterDocument
      ? { width: container?.sourceWidth || image.width, height: container?.sourceHeight || image.height }
      : await dimensions(source);
    if (openSequence.current !== requestSequence) return;
    setSelectedId(image.imageId);
    setProcessingSource({ imageId: image.imageId, blob: source, ...sourceSize });
    if (operation === "review") setReviewOpen(true); else setEditing(operation);
    if (usesParameterDocument) {
      const parameterDocument = container?.parameterDocument || image.parameterDocument || { version: 1 as const, operations: [] };
      const baseDocument = { ...parameterDocument, operations: parameterDocument.operations.filter((candidate) => candidate.type !== editableParameterType) };
      void imageProcessing.renderPreview({
        source: { kind: "blob", blob: source, name: image.name, mimeType: image.mimeType },
        document: baseDocument,
        maxWidth: 960,
        maxHeight: 720,
        mimeType: "image/webp",
        quality: 0.86,
      }, { requestId: `workspace-editor:${image.imageId}:${requestSequence}` }).then((result) => {
        if (openSequence.current !== requestSequence) return;
        setEditorPreparing(false);
        setProcessingSource({ imageId: image.imageId, blob: result.artifact.blob, width: result.width, height: result.height });
      }).catch((error) => {
        if (openSequence.current !== requestSequence) return;
        setEditorPreparing(false);
        setNotice(error instanceof Error ? error.message : "Editor preview is unavailable");
      });
    } else {
      setEditorPreparing(false);
    }
  }, [collaborationContainers, imageProcessing, loadSource, setEditing, setEditorPreparing, setNotice, setProcessingSource, setReviewOpen, setSelectedId]);
  const releaseProcessingSource = React.useCallback(() => {
    openSequence.current += 1;
    setEditorPreparing(false);
    setProcessingSource(null);
  }, [setEditorPreparing, setProcessingSource]);
  return { openImageOperation, releaseProcessingSource };
}
