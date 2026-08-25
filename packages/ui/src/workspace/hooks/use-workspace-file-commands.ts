import React from "react";
import { saveCommit, saveWorkspaceImage } from "../repository";
import { generateShareThumbnail } from "../../utils/share-thumbnail";
import { dimensions } from "../utils/workspace-image-display";
import { cachedCommit } from "../utils/workspace-page-utils";
import type { WorkspaceCommit, WorkspaceIdentity, WorkspaceImage } from "../types";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function useWorkspaceFileCommands({ workspace, inputRef, setImages, setCommits, setSelectedId, persistWorkspaceLog, loadSource, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  setCommits: React.Dispatch<React.SetStateAction<WorkspaceCommit[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string) => Promise<void>;
  loadSource: (image: WorkspaceImage, materialize?: boolean) => Promise<Blob | null>;
  setNotice: (message: string) => void;
}) {
  const addFiles = React.useCallback(async (files: FileList | File[]) => {
    if (!workspace || workspace.role !== "owner") return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const [size, thumbnail] = await Promise.all([dimensions(file), generateShareThumbnail(file, 320, 240)]);
      const imageId = id("image");
      const initialCommitId = `initial_${imageId}`;
      const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
      const image: WorkspaceImage = { imageId, workspaceId: workspace.workspaceId, name: file.name, mimeType: file.type,
        size: file.size, ...size, workspaceLocation: "library", state: "private", shared: false,
        currentCommitId: initialCommitId, previewRevision: 0, createdAt: Date.now(), updatedAt: Date.now(),
        sourceCached: true, previewCached: true, source: file, preview };
      const initial: WorkspaceCommit = { commitId: initialCommitId, imageId, authorId: "owner", parentCommitId: null,
        mergeParentCommitIds: [], operations: [], snapshot: file, snapshotName: file.name, snapshotMimeType: file.type,
        snapshotWidth: size.width, snapshotHeight: size.height, createdAt: Date.now() };
      await saveWorkspaceImage(image); await saveCommit(initial);
      setImages((current) => [...current, { ...image, source: undefined, preview: undefined }]);
      setCommits((current) => [...current, cachedCommit(initial)]);
      setSelectedId(imageId);
      await persistWorkspaceLog(workspace.workspaceId, "imageAdded", imageId);
    }
    if (inputRef.current) inputRef.current.value = "";
  }, [inputRef, persistWorkspaceLog, setCommits, setImages, setSelectedId, workspace]);

  const downloadImage = React.useCallback(async (image: WorkspaceImage) => {
    const source = await loadSource(image, image.workspaceLocation === "working");
    if (!source) { setNotice("Source data is unavailable"); return false; }
    const url = URL.createObjectURL(source);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = source instanceof File && source.name ? source.name : image.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  }, [loadSource, setNotice]);

  return { addFiles, downloadImage };
}
