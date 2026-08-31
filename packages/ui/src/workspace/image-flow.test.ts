import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NORMAL_COMPRESSION_SUGGESTION_BYTES,
  WEAK_NETWORK_COMPRESSION_SUGGESTION_BYTES,
  canRenderFromCollaborationSource,
  canDeleteWorkspaceImage,
  canStartImageCollaboration,
  hasPendingWorkspaceImageChanges,
  needsCollaborationPreviewGeneration,
  normalizeWorkspaceImageLocation,
  reconcileCollaboratorSnapshot,
  sharedWorkingImages,
  shouldSuggestWorkspaceCompression,
  workspaceOperationStorageMode,
} from "./image-flow";
import type { WorkspaceIdentity, WorkspaceImage } from "./types";
import {
  collaborationCardPreviewFor,
  collaborationPreviewFor,
} from "./utils/workspace-image-display";

test("collaborator switches from placeholder to local parameter rendering after receiving Source", () => {
  assert.equal(canRenderFromCollaborationSource("collaborator", false), false);
  assert.equal(canRenderFromCollaborationSource("collaborator", true), true);
  assert.equal(canRenderFromCollaborationSource("owner", false), true);
});

test("reuses complete collaboration preview metadata instead of regenerating it", () => {
  const placeholder = { width: 10, height: 10, dominantColor: "#123456", blurHash: "L00000" };
  assert.equal(needsCollaborationPreviewGeneration({ sourceCached: true, previewCached: true, placeholder }), false);
  assert.equal(needsCollaborationPreviewGeneration({ sourceCached: true, previewCached: false, placeholder }), true);
  assert.equal(needsCollaborationPreviewGeneration({ sourceCached: true, previewCached: true }), true);
});

test("normalizes legacy Workspace images into Library or Working", () => {
  assert.equal(normalizeWorkspaceImageLocation({ shared: false, state: "private" }, "owner"), "library");
  assert.equal(normalizeWorkspaceImageLocation({ shared: true, state: "shared" }, "owner"), "working");
  assert.equal(normalizeWorkspaceImageLocation({ shared: false, state: "private" }, "collaborator"), "working");
  assert.equal(normalizeWorkspaceImageLocation({ shared: false, state: "private", workspaceLocation: "working" }, "owner"), "working");
});

test("allows only one collaborative image and blocks its deletion", () => {
  const collaborative = {
    imageId: "shared",
    shared: true,
  } as WorkspaceImage;
  assert.equal(canStartImageCollaboration([collaborative], "next"), false);
  assert.equal(canStartImageCollaboration([collaborative], "shared"), true);
  assert.equal(canDeleteWorkspaceImage(collaborative), false);
  assert.equal(canDeleteWorkspaceImage({ shared: false }), true);
  assert.equal(workspaceOperationStorageMode({ workspaceLocation: "working" }), "parameters");
  assert.equal(workspaceOperationStorageMode({ workspaceLocation: "library" }), "newImage");
});

test("only non-collaborative Working parameters are pending image changes", () => {
  const parameterDocument = {
    version: 1 as const,
    operations: [{ id: "crop", userId: "owner", time: 1, type: "crop" as const, params: {} }],
  };
  assert.equal(hasPendingWorkspaceImageChanges({
    workspaceLocation: "working", shared: false, parameterDocument,
  }), true);
  assert.equal(hasPendingWorkspaceImageChanges({
    workspaceLocation: "working", shared: true, parameterDocument,
  }), false);
  assert.equal(hasPendingWorkspaceImageChanges({
    workspaceLocation: "library", shared: false, parameterDocument,
  }), false);
  assert.equal(hasPendingWorkspaceImageChanges({
    workspaceLocation: "working", shared: false, parameterDocument: { version: 1, operations: [] },
  }), false);
});

test("uses the previous normal and weak-network compression thresholds", () => {
  assert.equal(shouldSuggestWorkspaceCompression(NORMAL_COMPRESSION_SUGGESTION_BYTES, false), false);
  assert.equal(shouldSuggestWorkspaceCompression(NORMAL_COMPRESSION_SUGGESTION_BYTES + 1, false), true);
  assert.equal(shouldSuggestWorkspaceCompression(WEAK_NETWORK_COMPRESSION_SUGGESTION_BYTES, true), false);
  assert.equal(shouldSuggestWorkspaceCompression(WEAK_NETWORK_COMPRESSION_SUGGESTION_BYTES + 1, true), true);
});

test("removes images missing from an Owner snapshot and preserves local thumbnail data", () => {
  const base: WorkspaceImage = {
    imageId: "keep",
    workspaceId: "workspace",
    name: "old.png",
    mimeType: "image/png",
    size: 10,
    width: 1,
    height: 1,
    workspaceLocation: "working",
    state: "shared",
    shared: true,
    currentCommitId: null,
    previewRevision: 1,
    createdAt: 1,
    updatedAt: 1,
    previewCached: true,
    placeholder: { width: 100, height: 50, dominantColor: "#123456", blurHash: "L00000" },
  };
  const result = reconcileCollaboratorSnapshot(
    [base, { ...base, imageId: "remove" }],
    [{ ...base, name: "current.png", previewCached: undefined, previewRevision: 2 }],
  );

  assert.deepEqual(result.removedImageIds, ["remove"]);
  assert.equal(result.images[0].name, "current.png");
  assert.equal(result.images[0].preview, undefined);
  assert.equal(result.images[0].previewCached, true);
  assert.deepEqual(result.images[0].placeholder, base.placeholder);
  assert.equal(result.images[0].previewRevision, 2);
});

test("deduplicates concurrent collaborator images by image id", () => {
  const base: WorkspaceImage = {
    imageId: "same",
    workspaceId: "workspace",
    name: "old.png",
    mimeType: "image/png",
    size: 10,
    width: 1,
    height: 1,
    workspaceLocation: "working",
    state: "shared",
    shared: true,
    currentCommitId: null,
    previewRevision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const result = reconcileCollaboratorSnapshot(
    [base, {...base}],
    [base, {...base,name:"latest.png",previewRevision:2}],
  );
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].name, "latest.png");
  assert.equal(result.images[0].previewRevision, 2);
});

test("shares only images that are both in Working and explicitly shared", () => {
  const base: WorkspaceImage = {
    imageId: "working-shared",
    workspaceId: "workspace",
    name: "image.png",
    mimeType: "image/png",
    size: 1,
    width: 1,
    height: 1,
    workspaceLocation: "working",
    state: "shared",
    shared: true,
    currentCommitId: null,
    previewRevision: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  assert.deepEqual(sharedWorkingImages([
    base,
    { ...base, imageId: "working-private", shared: false },
    { ...base, imageId: "library-shared", workspaceLocation: "library" },
  ]).map((image) => image.imageId), ["working-shared"]);
});

test("stopped collaboration ignores stale B and C container data", () => {
  const image = {
    imageId: "stopped",
    workspaceId: "workspace",
    name: "stopped.png",
    mimeType: "image/png",
    size: 1,
    width: 10,
    height: 10,
    workspaceLocation: "working",
    state: "working",
    shared: false,
    currentCommitId: "initial_stopped",
    previewRevision: 1,
    parameterDocument: { version: 1 as const, operations: [] },
    createdAt: 1,
    updatedAt: 1,
  } satisfies WorkspaceImage;
  const workingBlob = new Blob(["stale-working"]);
  const container = {
    sourceKind: "source" as const,
    workingBlob,
    cardPreview: { artifact: { url: "picbind-preview://localhost/stale" } },
  };
  const workspace = { role: "owner" } as WorkspaceIdentity;

  assert.equal(collaborationPreviewFor(image, workspace, new Map([[image.imageId, container]])), undefined);
  assert.equal(collaborationCardPreviewFor(image, workspace, new Map([[image.imageId, container]])), undefined);
});
