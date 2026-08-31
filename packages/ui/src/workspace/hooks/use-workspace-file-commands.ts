import React from "react";
import { pickNativeLibraryImages, type NativeLibraryImage } from "../../database/native-image-storage";
import {
  getWorkspaceImageSourceAddress,
  saveCommit,
  saveExternalWorkspaceImage,
  saveWorkspaceImage,
} from "../repository";
import { cachedCommit } from "../utils/workspace-page-utils";
import type { WorkspaceCommit, WorkspaceIdentity, WorkspaceImage } from "../types";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

type LibraryImport = {
  image: WorkspaceImage;
  initial: WorkspaceCommit;
  externalPath?: string;
};

function libraryImport(
  workspaceId: string,
  file: Pick<File, "name" | "type" | "size">,
  source?: Blob,
  externalPath?: string,
): LibraryImport {
  const imageId = id("image");
  const initialCommitId = `initial_${imageId}`;
  const createdAt = Date.now();
  const image: WorkspaceImage = {
    imageId,
    workspaceId,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    width: 0,
    height: 0,
    workspaceLocation: "library",
    state: "private",
    shared: false,
    currentCommitId: initialCommitId,
    previewRevision: 0,
    createdAt,
    updatedAt: createdAt,
    sourceCached: true,
    previewCached: false,
    source,
  };
  const initial: WorkspaceCommit = {
    commitId: initialCommitId,
    imageId,
    authorId: "owner",
    parentCommitId: null,
    mergeParentCommitIds: [],
    operations: [],
    snapshotCached: true,
    snapshotName: file.name,
    snapshotMimeType: file.type,
    createdAt,
  };
  return { image, initial, externalPath };
}

export function useWorkspaceFileCommands({ workspace, desktop, inputRef, setImages, setCommits, setSelectedId, persistWorkspaceLog, loadSource, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  desktop: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  setCommits: React.Dispatch<React.SetStateAction<WorkspaceCommit[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string) => Promise<void>;
  loadSource: (image: WorkspaceImage, materialize?: boolean) => Promise<Blob | null>;
  setNotice: (message: string) => void;
}) {
  const persistImports = React.useCallback(async (imports: LibraryImport[]) => {
    if (!workspace) return;
    await Promise.all(imports.map(async ({ image, initial, externalPath }) => {
      try {
        const sourceAddress = externalPath
          ? await saveExternalWorkspaceImage(image, externalPath)
          : (await saveWorkspaceImage(image), await getWorkspaceImageSourceAddress(image));
        await saveCommit(initial);
        setImages((current) => current.map((candidate) => candidate.imageId === image.imageId
          ? { ...candidate, source: undefined, sourceAddress: sourceAddress || undefined }
          : candidate));
      } catch (error) {
        console.error("Failed to add Library image", error);
        setImages((current) => current.filter((candidate) => candidate.imageId !== image.imageId));
        setCommits((current) => current.filter((commit) => commit.imageId !== image.imageId));
        setNotice(error instanceof Error ? error.message : "The image could not be added");
        return;
      }
      await persistWorkspaceLog(workspace.workspaceId, "imageAdded", image.imageId)
        .catch((error) => console.error("Failed to persist Library image log", error));
    }));
  }, [persistWorkspaceLog, setCommits, setImages, setNotice, workspace]);

  const enqueueImports = React.useCallback((imports: LibraryImport[]) => {
    if (!imports.length) return;
    setImages((current) => [...current, ...imports.map(({ image }) => image)]);
    setCommits((current) => [...current, ...imports.map(({ initial }) => cachedCommit(initial))]);
    setSelectedId(imports.at(-1)!.image.imageId);
  }, [setCommits, setImages, setSelectedId]);

  const addFiles = React.useCallback(async (files: FileList | File[]) => {
    if (!workspace || workspace.role !== "owner") return;
    const imports = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => {
        const externalPath = desktop && typeof (file as File & { path?: unknown }).path === "string"
          ? String((file as File & { path: string }).path)
          : undefined;
        return libraryImport(workspace.workspaceId, file, externalPath ? undefined : file, externalPath);
      });
    enqueueImports(imports);
    try {
      await persistImports(imports);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [desktop, enqueueImports, inputRef, persistImports, workspace]);

  const addNativeFiles = React.useCallback(async (files: NativeLibraryImage[]) => {
    if (!workspace || workspace.role !== "owner") return;
    const imports = files.map((file) => libraryImport(workspace.workspaceId, {
      name: file.name,
      type: file.mimeType,
      size: file.size,
    }, undefined, file.path));
    enqueueImports(imports);
    await persistImports(imports);
  }, [enqueueImports, persistImports, workspace]);

  const chooseFiles = React.useCallback(async () => {
    if (!desktop) {
      inputRef.current?.click();
      return;
    }
    try {
      await addNativeFiles(await pickNativeLibraryImages());
    } catch (error) {
      console.error("Failed to choose Library images", error);
      setNotice(error instanceof Error ? error.message : "The image picker could not be opened");
    }
  }, [addNativeFiles, desktop, inputRef, setNotice]);

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

  return { addFiles, chooseFiles, downloadImage };
}
