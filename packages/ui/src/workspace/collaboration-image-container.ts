import type { ImagePreviewCacheArtifact } from "@picbind/shared";
import type { ImageParameterDocument } from "./image-protocol";
import type { WorkspaceOperation } from "./types";

export type CollaborationRenderResult = {
  blob: Blob;
  name: string;
  mimeType: string;
  width: number;
  height: number;
};

export type CollaborationPreviewCacheEntry = {
  commitId: string;
  artifact: ImagePreviewCacheArtifact;
  width: number;
  height: number;
};

export const COLLABORATION_PREVIEW_CACHE_MAX_ENTRIES = 12;
export const COLLABORATION_PREVIEW_CACHE_MAX_BYTES = 12 * 1024 * 1024;
export const COLLABORATION_PREVIEW_MAX_WIDTH = 720;
export const COLLABORATION_PREVIEW_MAX_HEIGHT = 540;
export const COLLABORATION_PREVIEW_QUALITY = 0.8;

export type CollaborationImageContainer = {
  imageId: string;
  cacheKey: string;
  sourceKind: "source" | "preview";
  originalBlob: Blob;
  originalWidth: number;
  originalHeight: number;
  workingBlob: Blob;
  editorPreviewBlob: Blob | null;
  previewCache: Map<string, CollaborationPreviewCacheEntry>;
  cardPreview: CollaborationPreviewCacheEntry | null;
  activePreview: CollaborationPreviewCacheEntry | null;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  parameterDocument: ImageParameterDocument;
  disposed: boolean;
};

export type CollaborationRenderer = (
  source: Blob,
  operations: WorkspaceOperation[],
) => Promise<CollaborationRenderResult>;

export function createCollaborationImageContainer(input: {
  imageId: string;
  source: Blob;
  sourceKind: "source" | "preview";
  name: string;
  mimeType: string;
  width: number;
  height: number;
  parameterDocument: ImageParameterDocument;
}) {
  const cacheKey = `workspace:${input.imageId}:${crypto.randomUUID()}`;
  return {
    imageId: input.imageId,
    cacheKey,
    sourceKind: input.sourceKind,
    originalBlob: input.source,
    originalWidth: input.width,
    originalHeight: input.height,
    workingBlob: input.source,
    editorPreviewBlob: null,
    previewCache: new Map(),
    cardPreview: null,
    activePreview: null,
    name: input.name,
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    parameterDocument: input.parameterDocument,
    disposed: false,
  } satisfies CollaborationImageContainer;
}

// A formal collaboration update replaces B while A remains immutable.
export function adoptCollaborationRender(
  container: CollaborationImageContainer,
  parameterDocument: ImageParameterDocument,
  result: CollaborationRenderResult,
) {
  assertActive(container);
  return {
    ...container,
    parameterDocument,
    workingBlob: result.blob,
    editorPreviewBlob: null,
    name: result.name,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
  };
}

// Editor drafts are transient processing inputs and are not part of the C file cache.
export function adoptCollaborationEditorPreview(
  container: CollaborationImageContainer,
  preview: Blob,
) {
  assertActive(container);
  return { ...container, editorPreviewBlob: preview };
}

export function clearCollaborationEditorPreview(container: CollaborationImageContainer) {
  assertActive(container);
  return { ...container, editorPreviewBlob: null };
}

export function putCollaborationPreviewCache(
  container: CollaborationImageContainer,
  entry: CollaborationPreviewCacheEntry,
) {
  assertActive(container);
  const previewCache = new Map(container.previewCache);
  const replaced = previewCache.get(entry.commitId);
  previewCache.delete(entry.commitId);
  previewCache.set(entry.commitId, entry);
  const evicted = replaced && replaced.artifact.id !== entry.artifact.id
    ? [replaced.artifact]
    : [];
  let bytes = Array.from(previewCache.values())
    .reduce((total, value) => total + value.artifact.sizeBytes, 0);
  while (previewCache.size > COLLABORATION_PREVIEW_CACHE_MAX_ENTRIES
    || bytes > COLLABORATION_PREVIEW_CACHE_MAX_BYTES) {
    const oldestCommitId = Array.from(previewCache.keys())
      .find((commitId) => commitId !== container.cardPreview?.commitId);
    if (typeof oldestCommitId !== "string") break;
    const oldest = previewCache.get(oldestCommitId);
    previewCache.delete(oldestCommitId);
    if (oldest) {
      bytes -= oldest.artifact.sizeBytes;
      evicted.push(oldest.artifact);
    }
  }
  return { container: { ...container, previewCache }, evicted };
}

export function activateCollaborationCardPreview(
  container: CollaborationImageContainer,
  commitId: string,
) {
  assertActive(container);
  const entry = container.previewCache.get(commitId);
  if (!entry) return null;
  const previewCache = new Map(container.previewCache);
  previewCache.delete(commitId);
  previewCache.set(commitId, entry);
  return { ...container, previewCache, cardPreview: entry };
}

export function activateCollaborationPreviewCacheEntry(
  container: CollaborationImageContainer,
  commitId: string,
) {
  assertActive(container);
  const entry = container.previewCache.get(commitId);
  if (!entry) return null;
  const previewCache = new Map(container.previewCache);
  previewCache.delete(commitId);
  previewCache.set(commitId, entry);
  const released = uncachedActiveArtifact(container, entry.artifact.id);
  return {
    container: { ...container, previewCache, activePreview: entry },
    entry,
    released,
  };
}

export function activateUncachedCollaborationPreview(
  container: CollaborationImageContainer,
  entry: CollaborationPreviewCacheEntry,
) {
  assertActive(container);
  return {
    container: { ...container, activePreview: entry },
    released: uncachedActiveArtifact(container, entry.artifact.id),
  };
}

export function clearActiveCollaborationPreview(container: CollaborationImageContainer) {
  assertActive(container);
  return {
    container: { ...container, activePreview: null },
    released: uncachedActiveArtifact(container),
  };
}

export function collaborationPreviewCacheArtifacts(container: CollaborationImageContainer) {
  const artifacts = [
    ...Array.from(container.previewCache.values(), (entry) => entry.artifact),
    ...(container.cardPreview ? [container.cardPreview.artifact] : []),
    ...(container.activePreview ? [container.activePreview.artifact] : []),
  ];
  return Array.from(new Map(artifacts.map((artifact) => [artifact.id, artifact])).values());
}

export async function replaceCollaborationDocument(
  container: CollaborationImageContainer,
  parameterDocument: ImageParameterDocument,
  operations: WorkspaceOperation[],
  render: CollaborationRenderer,
) {
  assertActive(container);
  if (!operations.length) {
    return {
      ...container,
      parameterDocument,
      workingBlob: container.originalBlob,
      editorPreviewBlob: null,
      width: container.originalWidth,
      height: container.originalHeight,
    };
  }
  return adoptCollaborationRender(
    container,
    parameterDocument,
    await render(container.originalBlob, operations),
  );
}

export function disposeCollaborationImageContainer(container: CollaborationImageContainer) {
  return {
    ...container,
    originalBlob: new Blob(),
    workingBlob: new Blob(),
    editorPreviewBlob: null,
    previewCache: new Map(),
    cardPreview: null,
    activePreview: null,
    disposed: true,
  };
}

function uncachedActiveArtifact(container: CollaborationImageContainer, nextArtifactId?: string) {
  const active = container.activePreview?.artifact;
  if (!active || active.id === nextArtifactId) return null;
  return Array.from(container.previewCache.values()).some((entry) => entry.artifact.id === active.id)
    ? null
    : active;
}

function assertActive(container: CollaborationImageContainer) {
  if (container.disposed) throw new Error("Collaboration image container is disposed");
}
