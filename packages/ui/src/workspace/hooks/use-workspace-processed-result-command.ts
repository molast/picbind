import React from "react";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { WorkspaceImage, WorkspaceOperation } from "../types";

export function useWorkspaceProcessedResultCommand({ workspace, selected, setEditing, createOperation, queueProcessedResult, releaseProcessingSource, }: {
  workspace: { role: string } | null;
  selected: WorkspaceImage | null;
  setEditing: React.Dispatch<React.SetStateAction<any>>;
  createOperation: (type: WorkspaceOperation["type"], parameters: Record<string, unknown>, processed?: { blob: Blob; name: string; mimeType: string; width: number; height: number }) => Promise<void>;
  queueProcessedResult: (source: WorkspaceImage, result: ProcessedImageResult) => void;
  releaseProcessingSource: () => void;
}) {
  const saveProcessedResult = React.useCallback(async (result: ProcessedImageResult) => {
    if (!workspace || !selected) return;
    const operationType: WorkspaceOperation["type"] = result.operation === "adjust" ? "brightness" : result.operation === "compress" ? "compression" : result.operation === "convert" ? "other" : result.operation;
    if (selected.shared && ["brightness", "crop", "resize"].includes(operationType)) {
      setEditing(null);
      await createOperation(operationType, result.parameters || {}, { blob: result.blob, name: result.name, mimeType: result.blob.type || selected.mimeType, width: result.width, height: result.height });
      releaseProcessingSource();
    } else queueProcessedResult(selected, result);
  }, [createOperation, queueProcessedResult, releaseProcessingSource, selected, setEditing, workspace]);
  return { saveProcessedResult };
}
