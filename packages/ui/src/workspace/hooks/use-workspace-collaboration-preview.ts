import React from "react";
import { useImageProcessing } from "../../image-processing";
import { readWorkspaceImagePreview, readWorkspaceImageSource } from "../repository";
import { emptyImageParameterDocument, imageParameterDocumentsEqual, type ImageParameterDocument } from "../image-protocol";
import {
  activateCollaborationCardPreview,
  activateCollaborationPreviewCacheEntry,
  activateUncachedCollaborationPreview,
  adoptCollaborationRender,
  clearActiveCollaborationPreview,
  COLLABORATION_PREVIEW_MAX_HEIGHT,
  COLLABORATION_PREVIEW_MAX_WIDTH,
  COLLABORATION_PREVIEW_QUALITY,
  collaborationPreviewCacheArtifacts,
  createCollaborationImageContainer,
  disposeCollaborationImageContainer,
  putCollaborationPreviewCache,
  type CollaborationImageContainer,
  type CollaborationPreviewCacheEntry,
} from "../collaboration-image-container";
import { dimensions } from "../utils/workspace-image-display";
import type { WorkspaceImage } from "../types";

function memorySource(container: CollaborationImageContainer) {
  return {
    kind: "blob" as const,
    blob: container.originalBlob,
    name: container.name,
    mimeType: container.originalBlob.type || container.mimeType,
    cacheKey: container.cacheKey,
  };
}

export function useWorkspaceCollaborationPreview({ imagesRef, collaborationContainers, refresh, processingSource, }: {
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  refresh: () => void;
  processingSource: { imageId: string; blob: Blob } | null;
}) {
  const imageProcessing = useImageProcessing();
  const renderSequence = React.useRef(0);
  const latestRenders = React.useRef(new Map<string, number>());
  const latestTemporaryRenders = React.useRef(new Map<string, number>());
  const previewCacheRenders = React.useRef(new Map<string, Promise<CollaborationPreviewCacheEntry | null>>());
  const [processingImageIds, setProcessingImageIds] = React.useState<ReadonlySet<string>>(() => new Set());

  const setWorkingCardProcessing = React.useCallback((imageId: string, processing: boolean) => {
    setProcessingImageIds((current) => {
      if (current.has(imageId) === processing) return current;
      const next = new Set(current);
      if (processing) next.add(imageId); else next.delete(imageId);
      return next;
    });
  }, []);

  const finishWorkingCardProcessing = React.useCallback((imageId: string, sequence: number) => {
    if (latestRenders.current.get(imageId) !== sequence) return;
    setWorkingCardProcessing(imageId, false);
  }, [setWorkingCardProcessing]);

  const releasePreviewArtifacts = React.useCallback((artifacts: Array<CollaborationPreviewCacheEntry["artifact"]>) => {
    const unique = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    unique.forEach((artifact) => void imageProcessing.releasePreviewCache(artifact).catch(() => undefined));
  }, [imageProcessing]);

  const releaseOrphanedPreviewArtifacts = React.useCallback((container: CollaborationImageContainer, artifacts: Array<CollaborationPreviewCacheEntry["artifact"]>) => {
    const retained = new Set([
      ...Array.from(container.previewCache.values(), (entry) => entry.artifact.id),
      ...(container.cardPreview ? [container.cardPreview.artifact.id] : []),
      ...(container.activePreview ? [container.activePreview.artifact.id] : []),
    ]);
    releasePreviewArtifacts(artifacts.filter((artifact) => !retained.has(artifact.id)));
  }, [releasePreviewArtifacts]);

  const releaseCollaborationContainer = React.useCallback((imageId: string) => {
    const container = collaborationContainers.current.get(imageId);
    latestRenders.current.delete(imageId);
    latestTemporaryRenders.current.delete(imageId);
    setWorkingCardProcessing(imageId, false);
    if (!container) return;
    releasePreviewArtifacts(collaborationPreviewCacheArtifacts(container));
    collaborationContainers.current.set(imageId, disposeCollaborationImageContainer(container));
    collaborationContainers.current.delete(imageId);
    void imageProcessing.releaseMemorySource(container.cacheKey).catch(() => undefined);
    refresh();
  }, [collaborationContainers, imageProcessing, refresh, releasePreviewArtifacts, setWorkingCardProcessing]);

  const createContainer = React.useCallback((image: WorkspaceImage, source: Blob, sourceKind: "source" | "preview", width: number, height: number) => {
    const previous = collaborationContainers.current.get(image.imageId);
    if (previous) {
      releasePreviewArtifacts(collaborationPreviewCacheArtifacts(previous));
      collaborationContainers.current.set(image.imageId, disposeCollaborationImageContainer(previous));
      collaborationContainers.current.delete(image.imageId);
      void imageProcessing.releaseMemorySource(previous.cacheKey).catch(() => undefined);
    }
    const container = createCollaborationImageContainer({
      imageId: image.imageId,
      source,
      sourceKind,
      name: image.name,
      mimeType: source.type || image.mimeType,
      width,
      height,
      parameterDocument: emptyImageParameterDocument(),
    });
    collaborationContainers.current.set(image.imageId, container);
    refresh();
    return container;
  }, [collaborationContainers, imageProcessing, refresh, releasePreviewArtifacts]);

  const cachePreviewForContainer = React.useCallback((
    image: WorkspaceImage,
    parameterDocument: ImageParameterDocument,
    commitId: string,
    workingBlob?: Blob,
  ) => {
    const container = collaborationContainers.current.get(image.imageId);
    if (!container || container.disposed) return Promise.resolve(null);
    const cached = container.previewCache.get(commitId);
    if (cached) {
      const currentImage = imagesRef.current.find((candidate) => candidate.imageId === image.imageId);
      if (currentImage?.currentCommitId === commitId
        && imageParameterDocumentsEqual(container.parameterDocument, parameterDocument)) {
        const activated = activateCollaborationCardPreview(container, commitId);
        if (activated) {
          collaborationContainers.current.set(image.imageId, activated);
          refresh();
        }
      }
      return Promise.resolve(cached);
    }
    const taskKey = `${container.cacheKey}:${commitId}`;
    const pending = previewCacheRenders.current.get(taskKey);
    if (pending) return pending;
    const sequence = ++renderSequence.current;
    const expectedCacheKey = container.cacheKey;
    const task = (async () => {
      const result = await imageProcessing.renderPreview({
        source: workingBlob
          ? {
            kind: "blob",
            blob: workingBlob,
            name: container.name,
            mimeType: workingBlob.type || container.mimeType,
          }
          : memorySource(container),
        document: workingBlob ? emptyImageParameterDocument() : parameterDocument,
        maxWidth: COLLABORATION_PREVIEW_MAX_WIDTH,
        maxHeight: COLLABORATION_PREVIEW_MAX_HEIGHT,
        mimeType: "image/webp",
        quality: COLLABORATION_PREVIEW_QUALITY,
        destination: "cache",
      }, { requestId: `workspace-preview-cache:${image.imageId}:${commitId}:${sequence}` });
      if (result.artifact.kind !== "cache") throw new Error("Preview cache did not return a file address");
      const current = collaborationContainers.current.get(image.imageId);
      if (!current || current.disposed || current.cacheKey !== expectedCacheKey
        || !imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.workspaceLocation === "working")) {
        releasePreviewArtifacts([result.artifact]);
        return null;
      }
      const entry = {
        commitId,
        artifact: result.artifact,
        width: result.width,
        height: result.height,
      } satisfies CollaborationPreviewCacheEntry;
      const updated = putCollaborationPreviewCache(current, entry);
      const currentImage = imagesRef.current.find((candidate) => candidate.imageId === image.imageId);
      const nextContainer = currentImage?.currentCommitId === commitId
        && imageParameterDocumentsEqual(updated.container.parameterDocument, parameterDocument)
        ? activateCollaborationCardPreview(updated.container, commitId) || updated.container
        : updated.container;
      collaborationContainers.current.set(image.imageId, nextContainer);
      releaseOrphanedPreviewArtifacts(nextContainer, updated.evicted);
      refresh();
      return entry;
    })().finally(() => {
      previewCacheRenders.current.delete(taskKey);
    });
    previewCacheRenders.current.set(taskKey, task);
    return task;
  }, [collaborationContainers, imageProcessing, imagesRef, refresh, releaseOrphanedPreviewArtifacts, releasePreviewArtifacts]);

  const syncCollaborationPreview = React.useCallback(async (
    image: WorkspaceImage,
    parameterDocument = image.parameterDocument || emptyImageParameterDocument(),
    sourceOverride?: Blob,
  ) => {
    const requestSequence = ++renderSequence.current;
    latestRenders.current.set(image.imageId, requestSequence);
    latestTemporaryRenders.current.set(image.imageId, requestSequence);
    setWorkingCardProcessing(image.imageId, true);
    let previewOwnsLoading = false;
    try {
      let container = collaborationContainers.current.get(image.imageId);
      let created = false;
      if (sourceOverride) {
        const sourceSize = await dimensions(sourceOverride).catch(() => ({ width: image.width, height: image.height }));
        container = createContainer(image, sourceOverride, "source", sourceSize.width, sourceSize.height);
        created = true;
      } else if (!container || container.disposed) {
        // The repository is touched only once, when A is first established.
        const original = image.sourceCached ? await readWorkspaceImageSource(image) : null;
        const source = original || await readWorkspaceImagePreview(image);
        if (!source) return null;
        if (latestRenders.current.get(image.imageId) !== requestSequence) {
          return collaborationContainers.current.get(image.imageId) || null;
        }
        const sourceSize = await dimensions(source).catch(() => ({ width: image.width, height: image.height }));
        container = createContainer(image, source, original ? "source" : "preview", sourceSize.width, sourceSize.height);
        created = true;
      }
      if (created && imageProcessing.engine === "desktop-native") {
        await imageProcessing.inspect(memorySource(container), {
          requestId: `workspace-memory:${image.imageId}:${requestSequence}`,
        });
      }
      if (imageParameterDocumentsEqual(container.parameterDocument, parameterDocument)) {
        refresh();
        if (image.currentCommitId) {
          const renderedWorkingBlob = parameterDocument.operations.length ? container.workingBlob : undefined;
          const cacheTask = cachePreviewForContainer(image, parameterDocument, image.currentCommitId, renderedWorkingBlob);
          previewOwnsLoading = true;
          void cacheTask.catch(() => undefined)
            .finally(() => finishWorkingCardProcessing(image.imageId, requestSequence));
        }
        return container;
      }
      const result = await imageProcessing.materialize({
        source: memorySource(container),
        document: parameterDocument,
        output: { format: "source", quality: 100 },
        destination: "memory",
      }, { requestId: `workspace-working:${image.imageId}:${requestSequence}` });
      if (latestRenders.current.get(image.imageId) !== requestSequence) {
        return collaborationContainers.current.get(image.imageId) || null;
      }
      if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.workspaceLocation === "working")) {
        releaseCollaborationContainer(image.imageId);
        return null;
      }
      if (result.artifact.kind !== "blob") throw new Error("Collaboration materialization did not return a Blob");
      const rendered = adoptCollaborationRender(container, parameterDocument, {
        blob: result.artifact.blob,
        name: result.name,
        mimeType: result.metadata.mimeType,
        width: result.metadata.width,
        height: result.metadata.height,
      });
      collaborationContainers.current.set(image.imageId, rendered);
      refresh();
      if (image.currentCommitId) {
        const cacheTask = cachePreviewForContainer(image, parameterDocument, image.currentCommitId, rendered.workingBlob);
        previewOwnsLoading = true;
        void cacheTask.catch(() => undefined)
          .finally(() => finishWorkingCardProcessing(image.imageId, requestSequence));
      }
      return rendered;
    } finally {
      if (!previewOwnsLoading) finishWorkingCardProcessing(image.imageId, requestSequence);
    }
  }, [cachePreviewForContainer, collaborationContainers, createContainer, finishWorkingCardProcessing, imageProcessing, imagesRef, refresh, releaseCollaborationContainer, setWorkingCardProcessing]);

  const renderCollaborationPreviewSnapshot = React.useCallback(async (image: WorkspaceImage, parameterDocument: ImageParameterDocument, commitId?: string) => {
    let container = collaborationContainers.current.get(image.imageId);
    if (!container || container.disposed) {
      container = await syncCollaborationPreview(image, image.parameterDocument || emptyImageParameterDocument()) || undefined;
    }
    if (!container || container.disposed) return null;
    const sequence = ++renderSequence.current;
    latestTemporaryRenders.current.set(image.imageId, sequence);
    let entry: CollaborationPreviewCacheEntry | null = null;
    if (commitId) {
      const cached = activateCollaborationPreviewCacheEntry(container, commitId);
      if (cached) {
        collaborationContainers.current.set(image.imageId, cached.container);
        if (cached.released) releasePreviewArtifacts([cached.released]);
        refresh();
        return { url: cached.entry.artifact.url, width: cached.entry.width, height: cached.entry.height };
      }
      entry = await cachePreviewForContainer(image, parameterDocument, commitId);
    } else {
      const result = await imageProcessing.renderPreview({
        source: memorySource(container),
        document: parameterDocument,
        maxWidth: COLLABORATION_PREVIEW_MAX_WIDTH,
        maxHeight: COLLABORATION_PREVIEW_MAX_HEIGHT,
        mimeType: "image/webp",
        quality: COLLABORATION_PREVIEW_QUALITY,
        destination: "cache",
      }, { requestId: `workspace-snapshot:${image.imageId}:${sequence}` });
      if (result.artifact.kind !== "cache") throw new Error("Preview did not return a file address");
      entry = { commitId: "", artifact: result.artifact, width: result.width, height: result.height };
    }
    if (latestTemporaryRenders.current.get(image.imageId) !== sequence) {
      if (entry && !commitId) releasePreviewArtifacts([entry.artifact]);
      return null;
    }
    const current = collaborationContainers.current.get(image.imageId);
    if (!current || current.cacheKey !== container.cacheKey || current.disposed || !entry) {
      if (entry && !commitId) releasePreviewArtifacts([entry.artifact]);
      return null;
    }
    const activated = commitId
      ? activateCollaborationPreviewCacheEntry(current, commitId)
      : activateUncachedCollaborationPreview(current, entry);
    if (!activated) return null;
    collaborationContainers.current.set(image.imageId, activated.container);
    if (activated.released) releasePreviewArtifacts([activated.released]);
    refresh();
    return { url: entry.artifact.url, width: entry.width, height: entry.height };
  }, [cachePreviewForContainer, collaborationContainers, imageProcessing, refresh, releasePreviewArtifacts, syncCollaborationPreview]);

  const clearCollaborationPreviewSnapshot = React.useCallback((imageId: string) => {
    latestTemporaryRenders.current.set(imageId, ++renderSequence.current);
    const container = collaborationContainers.current.get(imageId);
    if (!container || container.disposed || !container.activePreview) return;
    const cleared = clearActiveCollaborationPreview(container);
    collaborationContainers.current.set(imageId, cleared.container);
    if (cleared.released) releasePreviewArtifacts([cleared.released]);
    refresh();
  }, [collaborationContainers, refresh, releasePreviewArtifacts]);

  const syncCollaborationContainer = React.useCallback(async (image: WorkspaceImage, parameterDocument = image.parameterDocument || emptyImageParameterDocument()) => {
    const container = collaborationContainers.current.get(image.imageId);
    if (!container || container.disposed || container.sourceKind !== "source") {
      const source = await readWorkspaceImageSource(image);
      if (!source) return null;
      return syncCollaborationPreview(image, parameterDocument, source);
    }
    return syncCollaborationPreview(image, parameterDocument);
  }, [collaborationContainers, syncCollaborationPreview]);

  const loadSource = React.useCallback(async (image: WorkspaceImage, materialize = false) => {
    if (processingSource?.imageId === image.imageId) return processingSource.blob;
    const container = collaborationContainers.current.get(image.imageId);
    if (image.workspaceLocation === "working" && materialize) {
      return (await syncCollaborationContainer(image, image.parameterDocument || emptyImageParameterDocument()))?.workingBlob || null;
    }
    if (image.shared && container && !container.disposed) return container.workingBlob;
    if (image.shared) {
      return (await syncCollaborationPreview(image, image.parameterDocument || emptyImageParameterDocument()))?.workingBlob || null;
    }
    return readWorkspaceImageSource(image);
  }, [collaborationContainers, processingSource, syncCollaborationContainer, syncCollaborationPreview]);

  return {
    loadSource,
    syncCollaborationPreview,
    renderCollaborationPreviewSnapshot,
    clearCollaborationPreviewSnapshot,
    syncCollaborationContainer,
    releaseCollaborationContainer,
    processingImageIds,
  };
}
