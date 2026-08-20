import type { WorkspaceImage, WorkspaceImageLocation, WorkspaceRole } from "./types";

export const NORMAL_COMPRESSION_SUGGESTION_BYTES = 1024 * 1024;
export const WEAK_NETWORK_COMPRESSION_SUGGESTION_BYTES = 300 * 1024;

export function normalizeWorkspaceImageLocation(
  image: Pick<WorkspaceImage, "shared" | "state"> & { workspaceLocation?: unknown },
  role: WorkspaceRole,
): WorkspaceImageLocation {
  if (image.workspaceLocation === "library" || image.workspaceLocation === "working") {
    return image.workspaceLocation;
  }
  return role === "collaborator" || image.shared || image.state !== "private"
    ? "working"
    : "library";
}

export function shouldSuggestWorkspaceCompression(size: number, weakNetwork: boolean) {
  const threshold = weakNetwork
    ? WEAK_NETWORK_COMPRESSION_SUGGESTION_BYTES
    : NORMAL_COMPRESSION_SUGGESTION_BYTES;
  return size > threshold;
}

export function sharedWorkingImages(images: WorkspaceImage[]) {
  return images.filter((image) => image.workspaceLocation === "working" && image.shared);
}

export function canRenderFromCollaborationSource(
  role: WorkspaceRole,
  hasSourceContainer: boolean,
) {
  return role === "owner" || hasSourceContainer;
}

export function needsCollaborationPreviewGeneration(
  image: Pick<WorkspaceImage, "sourceCached" | "previewCached" | "placeholder">,
) {
  return Boolean(image.sourceCached && (!image.previewCached || !image.placeholder));
}

export function canStartImageCollaboration(images: WorkspaceImage[], imageId: string) {
  return !images.some((image) => image.imageId !== imageId && image.shared);
}

export function canDeleteWorkspaceImage(image: Pick<WorkspaceImage, "shared">) {
  return !image.shared;
}

export function workspaceOperationStorageMode(image: Pick<WorkspaceImage, "shared">) {
  return image.shared ? "parameters" as const : "newImage" as const;
}

export function browserReportsWeakNetwork() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  return Boolean(connection?.saveData || connection?.effectiveType?.includes("2g"));
}

export function reconcileCollaboratorSnapshot(
  current: WorkspaceImage[],
  incoming: WorkspaceImage[],
) {
  const incomingById = new Map(incoming.map((image) => [image.imageId, image]));
  const incomingIds = new Set(incomingById.keys());
  const currentById = new Map(current.map((image) => [image.imageId, image]));
  return {
    removedImageIds: [...new Set(current
      .filter((image) => !incomingIds.has(image.imageId))
      .map((image) => image.imageId))],
    images: [...incomingById.values()].map((image) => {
      const cached = currentById.get(image.imageId);
      return {
        ...cached,
        ...image,
        workspaceLocation: "working" as const,
        shared: true,
        sourceCached: cached?.sourceCached,
        previewCached: cached?.previewCached,
        placeholder: image.placeholder || cached?.placeholder,
        source: undefined,
        preview: undefined,
        previewRevision: Math.max(image.previewRevision || 0, cached?.previewRevision || 0),
      };
    }),
  };
}
