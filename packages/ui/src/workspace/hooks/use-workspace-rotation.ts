import React from "react";
import { emptyImageParameterDocument, setImageOperation } from "../image-protocol";
import { useImageProcessing } from "../../image-processing";
import type { WorkspaceImage, WorkspaceIdentity } from "../types";

export function useWorkspaceRotation({ workspace, selected, loadSource, createOperation, releaseProcessingSource, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  loadSource: (image: WorkspaceImage) => Promise<Blob | null>;
  createOperation: (type: "rotate", parameters: Record<string, unknown>, processed?: { blob: Blob; name: string; mimeType: string; width: number; height: number }) => Promise<void>;
  releaseProcessingSource: () => void;
  setNotice: (message: string) => void;
}) {
  const imageProcessing = useImageProcessing();
  const rotateSelected = React.useCallback(async () => {
    if (!workspace || !selected) return;
    if (selected.workspaceLocation === "working") {
      await createOperation("rotate", { degrees: 90 });
      releaseProcessingSource();
      return;
    }
    const source = await loadSource(selected);
    if (!source) { setNotice("Source data is unavailable"); return; }
    const result = await imageProcessing.materialize({
      source: { kind: "blob", blob: source, name: selected.name, mimeType: source.type || selected.mimeType },
      document: setImageOperation(emptyImageParameterDocument(), {
        id: crypto.randomUUID(), userId: "local", time: Date.now(), type: "rotate", params: { degrees: 90 },
      }),
      output: { format: "source" },
      destination: "memory",
    }, { requestId: `workspace-rotate:${selected.imageId}:${crypto.randomUUID()}` });
    if (result.artifact.kind !== "blob") throw new Error("Rotation did not return a Blob");
    await createOperation("rotate", { degrees: 90 }, {
      blob: result.artifact.blob,
      name: result.name,
      mimeType: result.metadata.mimeType,
      width: result.metadata.width,
      height: result.metadata.height,
    });
    releaseProcessingSource();
  }, [createOperation, imageProcessing, loadSource, releaseProcessingSource, selected, setNotice, workspace]);
  return { rotateSelected };
}
