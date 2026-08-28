import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyImageParameterDocument } from "./image-protocol";
import {
  activateCollaborationPreviewCacheEntry,
  activateCollaborationCardPreview,
  activateUncachedCollaborationPreview,
  adoptCollaborationRender,
  adoptCollaborationEditorPreview,
  clearActiveCollaborationPreview,
  clearCollaborationEditorPreview,
  COLLABORATION_PREVIEW_CACHE_MAX_BYTES,
  COLLABORATION_PREVIEW_CACHE_MAX_ENTRIES,
  createCollaborationImageContainer,
  disposeCollaborationImageContainer,
  putCollaborationPreviewCache,
  replaceCollaborationDocument,
  type CollaborationImageContainer,
} from "./collaboration-image-container";
import type { WorkspaceOperation } from "./types";

const operation: WorkspaceOperation = {
  operationId: "operation", imageId: "image", authorId: "owner", baseCommitId: "initial",
  type: "rotate", parameters: { degrees: 90 }, createdAt: 1,
};

function container(): CollaborationImageContainer {
  return createCollaborationImageContainer({
    imageId: "image", source: new Blob(["original"]), name: "image.png", mimeType: "image/png",
    sourceKind: "source", width: 10, height: 20, parameterDocument: emptyImageParameterDocument(),
  });
}

function previewEntry(commitId: string, sizeBytes = 1) {
  return {
    commitId,
    artifact: {
      kind: "cache" as const,
      id: `cache-${commitId}`,
      url: `picbind-preview://localhost/${commitId}`,
      mimeType: "image/webp" as const,
      sizeBytes,
      engine: "desktop-native" as const,
    },
    width: 10,
    height: 20,
  };
}

test("tracks whether the collaboration container uses Source or thumbnail data", () => {
  assert.equal(container().sourceKind, "source");
  const preview = createCollaborationImageContainer({
    imageId: "preview", source: new Blob(["thumbnail"]), sourceKind: "preview",
    name: "image.webp", mimeType: "image/webp", width: 10, height: 20,
    parameterDocument: emptyImageParameterDocument(),
  });
  assert.equal(preview.sourceKind, "preview");
});

test("keeps the original source isolated while adopting a rendered operation", async () => {
  const original = container();
  const document = { version: 1 as const, operations: [{ id: "operation", userId: "owner", time: 1, type: "rotate" as const, params: { degrees: 90 } }] };
  const updated = adoptCollaborationRender(original, document, {
    blob: new Blob(["rendered"]), name: "rotated.png", mimeType: "image/png", width: 20, height: 10,
  });
  assert.equal(await original.originalBlob.text(), "original");
  assert.equal(await updated.originalBlob.text(), "original");
  assert.equal(await updated.workingBlob.text(), "rendered");
});

test("editor previews never replace A, B, or the C file cache", async () => {
  const original = container();
  const previewed = adoptCollaborationEditorPreview(original, new Blob(["temporary"]));
  assert.equal(await previewed.originalBlob.text(), "original");
  assert.equal(await previewed.workingBlob.text(), "original");
  assert.equal(await previewed.editorPreviewBlob?.text(), "temporary");
  const cleared = clearCollaborationEditorPreview(previewed);
  assert.equal(cleared.editorPreviewBlob, null);
  assert.equal(await cleared.originalBlob.text(), "original");
  assert.equal(await cleared.workingBlob.text(), "original");
});

test("stores commit preview file addresses and moves cache hits to MRU", () => {
  let current = putCollaborationPreviewCache(container(), previewEntry("a")).container;
  current = putCollaborationPreviewCache(current, previewEntry("b")).container;
  const hit = activateCollaborationPreviewCacheEntry(current, "a");
  assert.ok(hit);
  assert.equal(hit.entry.artifact.url, "picbind-preview://localhost/a");
  assert.deepEqual(Array.from(hit.container.previewCache.keys()), ["b", "a"]);
  assert.equal(hit.container.activePreview?.commitId, "a");
});

test("keeps the working card on its stable preview while other commits enter the LRU", () => {
  let current = putCollaborationPreviewCache(container(), previewEntry("current")).container;
  current = activateCollaborationCardPreview(current, "current")!;
  for (let index = 0; index < COLLABORATION_PREVIEW_CACHE_MAX_ENTRIES; index += 1) {
    current = putCollaborationPreviewCache(current, previewEntry(`history-${index}`)).container;
  }
  assert.equal(current.cardPreview?.commitId, "current");
  assert.equal(current.previewCache.has("current"), true);
  assert.equal(current.previewCache.has("history-0"), false);
});

test("evicts least recently used preview files by entry count", () => {
  let current = container();
  let evicted: string[] = [];
  for (let index = 0; index <= COLLABORATION_PREVIEW_CACHE_MAX_ENTRIES; index += 1) {
    const updated = putCollaborationPreviewCache(current, previewEntry(`commit-${index}`));
    current = updated.container;
    evicted = [...evicted, ...updated.evicted.map((artifact) => artifact.id)];
  }
  assert.equal(current.previewCache.size, COLLABORATION_PREVIEW_CACHE_MAX_ENTRIES);
  assert.equal(current.previewCache.has("commit-0"), false);
  assert.deepEqual(evicted, ["cache-commit-0"]);
});

test("evicts least recently used preview files by total file bytes", () => {
  const firstSize = Math.floor(COLLABORATION_PREVIEW_CACHE_MAX_BYTES * 0.6);
  let current = putCollaborationPreviewCache(container(), previewEntry("a", firstSize)).container;
  const updated = putCollaborationPreviewCache(current, previewEntry("b", firstSize));
  current = updated.container;
  assert.deepEqual(Array.from(current.previewCache.keys()), ["b"]);
  assert.deepEqual(updated.evicted.map((artifact) => artifact.id), ["cache-a"]);
});

test("closing an active cached preview keeps its file in the LRU pool", () => {
  const cached = putCollaborationPreviewCache(container(), previewEntry("a")).container;
  const active = activateCollaborationPreviewCacheEntry(cached, "a");
  assert.ok(active);
  const cleared = clearActiveCollaborationPreview(active.container);
  assert.equal(cleared.container.activePreview, null);
  assert.equal(cleared.container.previewCache.has("a"), true);
  assert.equal(cleared.released, null);
});

test("closing an uncached proposal preview releases its file address", () => {
  const entry = previewEntry("");
  const active = activateUncachedCollaborationPreview(container(), entry);
  const cleared = clearActiveCollaborationPreview(active.container);
  assert.equal(cleared.released?.id, entry.artifact.id);
});

test("replacing the same parameter document renders equivalent owner and collaborator containers", async () => {
  const document = { version: 1 as const, operations: [{ id: "operation", userId: "owner", time: 1, type: "rotate" as const, params: { degrees: 90 } }] };
  const render = async (source: Blob, operations: WorkspaceOperation[]) => ({
    blob: new Blob([`${await source.text()}:${JSON.stringify(operations.map((value) => value.parameters))}`]),
    name: "rendered.png", mimeType: "image/png", width: 20, height: 10,
  });
  const owner = await replaceCollaborationDocument(container(), document, [operation], render);
  const collaborator = await replaceCollaborationDocument(container(), document, [operation], render);
  assert.equal(await owner.workingBlob.text(), await collaborator.workingBlob.text());
  const rolledBack = await replaceCollaborationDocument(owner, emptyImageParameterDocument(), [], render);
  assert.equal(await rolledBack.workingBlob.text(), "original");
});

test("disposing a collaboration container releases its transient blobs", async () => {
  const disposed = disposeCollaborationImageContainer(container());
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.originalBlob.size, 0);
  assert.equal(disposed.workingBlob.size, 0);
  assert.equal(disposed.editorPreviewBlob, null);
  assert.equal(disposed.previewCache.size, 0);
  assert.equal(disposed.cardPreview, null);
  assert.equal(disposed.activePreview, null);
});
