import React from "react";
import { useImageProcessing } from "../../image-processing";
import { saveCommit, saveWorkspaceImage } from "../repository";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { WorkspaceCommit, WorkspaceIdentity, WorkspaceImage } from "../types";
import { cachedCommit } from "../utils/workspace-page-utils";

type PendingResult = { source: WorkspaceImage; result: ProcessedImageResult };

export function useWorkspaceProcessedResults({
  workspace, setImages, setCommits, setSelectedId, setEditing, setCompressingToWorkingImageId,
  setPendingProcessedResult, setProcessedResultSaving, pendingProcessedResult, processedResultSaving,
  persistWorkspaceLog, releaseProcessingSource, setNotice,
}: {
  workspace: WorkspaceIdentity | null;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  setCommits: React.Dispatch<React.SetStateAction<WorkspaceCommit[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditing: React.Dispatch<React.SetStateAction<any>>;
  setCompressingToWorkingImageId: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingProcessedResult: React.Dispatch<React.SetStateAction<PendingResult | null>>;
  setProcessedResultSaving: React.Dispatch<React.SetStateAction<boolean>>;
  pendingProcessedResult: PendingResult | null;
  processedResultSaving: boolean;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string, detail?: unknown) => Promise<void>;
  releaseProcessingSource: () => void;
  setNotice: (message: string) => void;
}) {
  const imageProcessing = useImageProcessing();
  const saveProcessedCopy = React.useCallback(async (
    source: WorkspaceImage,
    result: ProcessedImageResult,
    destination: "library" | "working" = "working",
  ) => {
    if (!workspace || workspace.role !== "owner") return;
    const imageId = `image_${crypto.randomUUID()}`;
    const initialCommitId = `initial_${imageId}`;
    const createdAt = Date.now();
    const assets = await imageProcessing.createShareAssets({
      source: {
        kind: "blob",
        blob: result.blob,
        name: result.name,
        mimeType: result.blob.type || source.mimeType,
      },
      container: { width: 320, height: 240 },
    }, { requestId: `workspace-processed-thumbnail:${imageId}` });
    const preview = assets.thumbnail.blob;
    const image: WorkspaceImage = {
      imageId, workspaceId: workspace.workspaceId, name: result.name,
      mimeType: result.blob.type || source.mimeType, size: result.blob.size,
      width: result.width, height: result.height, workspaceLocation: destination,
      state: destination === "library" ? "private" : "working", shared: false,
      currentCommitId: initialCommitId, previewRevision: 0, createdAt, updatedAt: createdAt,
      sourceCached: true, previewCached: true, source: result.blob, preview,
    };
    const initialCommit: WorkspaceCommit = {
      commitId: initialCommitId, imageId, authorId: "owner", parentCommitId: null,
      mergeParentCommitIds: [], operations: [], snapshot: result.blob, snapshotName: result.name,
      snapshotMimeType: image.mimeType, snapshotWidth: result.width, snapshotHeight: result.height, createdAt,
    };
    await saveWorkspaceImage(image);
    await saveCommit(initialCommit);
    setImages((current) => [...current, { ...image, source: undefined, preview: undefined }]);
    setCommits((current) => [...current, cachedCommit(initialCommit)]);
    setSelectedId(imageId);
    setCompressingToWorkingImageId(null);
    setEditing(null);
    await persistWorkspaceLog(workspace.workspaceId, "imageCreatedFromOperation", imageId, {
      sourceImageId: source.imageId, operation: result.operation, destination,
    });
    return imageId;
  }, [imageProcessing, persistWorkspaceLog, setCommits, setCompressingToWorkingImageId, setEditing, setImages, setSelectedId, workspace]);

  const queueProcessedResult = React.useCallback((source: WorkspaceImage, result: ProcessedImageResult) => {
    setEditing(null);
    setPendingProcessedResult({ source, result });
    releaseProcessingSource();
  }, [releaseProcessingSource, setEditing, setPendingProcessedResult]);

  const confirmProcessedResult = React.useCallback(async (destination: "library" | "working") => {
    if (!pendingProcessedResult || processedResultSaving) return;
    setProcessedResultSaving(true);
    try {
      await saveProcessedCopy(pendingProcessedResult.source, pendingProcessedResult.result, destination);
      setPendingProcessedResult(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save processed image");
    } finally {
      setProcessedResultSaving(false);
    }
  }, [pendingProcessedResult, processedResultSaving, saveProcessedCopy, setNotice, setPendingProcessedResult, setProcessedResultSaving]);

  return { saveProcessedCopy, queueProcessedResult, confirmProcessedResult };
}
