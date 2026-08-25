import React from "react";
import type { CollaborationImageContainer } from "../collaboration-image-container";
import { emptyImageParameterDocument } from "../image-protocol";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspaceSaveCollaboration({ workspace, selected, collaborationContainers, setCollaborationSaving, setSaveCollaborationOpen, setNotice, updateImage, syncCollaborationContainer, saveProcessedCopy, persistCollaborationActivity, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  setCollaborationSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveCollaborationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
  updateImage: (imageId: string, patch: Partial<WorkspaceImage>) => Promise<void>;
  syncCollaborationContainer: (image: WorkspaceImage, document: any) => Promise<CollaborationImageContainer | null>;
  saveProcessedCopy: (source: WorkspaceImage, result: ProcessedImageResult) => Promise<string | undefined>;
  persistCollaborationActivity: (workspaceId: string, kind: string, imageId: string, detail: unknown, actorId?: string) => Promise<void>;
}) {
  const saveCollaborativeCopy = React.useCallback(async (image: WorkspaceImage) => {
    if (!workspace || workspace.role !== "owner" || !image.shared || !image.sourceCached) return false;
    const container = await syncCollaborationContainer(image, image.parameterDocument || emptyImageParameterDocument());
    if (!container) throw new Error("Source data is unavailable");
    const result = { blob: container.rendered, name: container.name, mimeType: container.mimeType, width: container.width, height: container.height };
    await saveProcessedCopy(image, { ...result, operation: "adjust", parameters: {} } as ProcessedImageResult);
    await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", image.imageId, { mode: "copy", commitId: image.currentCommitId }, "owner");
    return true;
  }, [persistCollaborationActivity, saveProcessedCopy, syncCollaborationContainer, workspace]);

  const saveCollaborativeImage = React.useCallback(async (choice: "copy" | "replace" = "copy") => {
    if (!workspace || workspace.role !== "owner" || !selected?.shared || !selected.sourceCached) return;
    setCollaborationSaving(true);
    try {
      if (choice === "copy") {
        await saveCollaborativeCopy(selected);
        setSaveCollaborationOpen(false);
        return;
      }
      const parameterDocument = collaborationContainers.current.get(selected.imageId)?.parameterDocument
        || selected.parameterDocument
        || emptyImageParameterDocument();
      await updateImage(selected.imageId, { parameterDocument });
      await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", selected.imageId, {
        mode: "replace",
        commitId: selected.currentCommitId,
        parameterDocument,
      }, "owner");
      setSaveCollaborationOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save collaborative image");
    } finally { setCollaborationSaving(false); }
  }, [collaborationContainers, saveCollaborativeCopy, selected, setCollaborationSaving, setNotice, setSaveCollaborationOpen, updateImage, workspace]);
  return { saveCollaborativeImage, saveCollaborativeCopy };
}
