import React from "react";
import { rotateImage } from "../utils/workspace-operation-replay";
import type { WorkspaceImage, WorkspaceIdentity } from "../types";

export function useWorkspaceRotation({ workspace, selected, loadSource, createOperation, releaseProcessingSource, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  loadSource: (image: WorkspaceImage) => Promise<Blob | null>;
  createOperation: (type: "rotate", parameters: Record<string, unknown>, processed?: { blob: Blob; name: string; mimeType: string; width: number; height: number }) => Promise<void>;
  releaseProcessingSource: () => void;
  setNotice: (message: string) => void;
}) {
  const rotateSelected = React.useCallback(async () => {
    if (!workspace || !selected) return;
    if (selected.shared) { await createOperation("rotate", { degrees: 90 }); releaseProcessingSource(); return; }
    const source = await loadSource(selected);
    if (!source) { setNotice("Source data is unavailable"); return; }
    const result = await rotateImage(source, selected.name, 90);
    await createOperation("rotate", { degrees: 90 }, result);
    releaseProcessingSource();
  }, [createOperation, loadSource, releaseProcessingSource, selected, setNotice, workspace]);
  return { rotateSelected };
}
