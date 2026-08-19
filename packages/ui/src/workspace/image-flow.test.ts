import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NORMAL_COMPRESSION_SUGGESTION_BYTES,
  WEAK_NETWORK_COMPRESSION_SUGGESTION_BYTES,
  normalizeWorkspaceImageLocation,
  reconcileCollaboratorSnapshot,
  sharedWorkingImages,
  shouldSuggestWorkspaceCompression,
} from "./image-flow";
import type { WorkspaceImage } from "./types";

test("normalizes legacy Workspace images into Library or Working", () => {
  assert.equal(normalizeWorkspaceImageLocation({ shared: false, state: "private" }, "owner"), "library");
  assert.equal(normalizeWorkspaceImageLocation({ shared: true, state: "shared" }, "owner"), "working");
  assert.equal(normalizeWorkspaceImageLocation({ shared: false, state: "private" }, "collaborator"), "working");
  assert.equal(normalizeWorkspaceImageLocation({ shared: false, state: "private", workspaceLocation: "working" }, "owner"), "working");
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
  };
  const result = reconcileCollaboratorSnapshot(
    [base, { ...base, imageId: "remove" }],
    [{ ...base, name: "current.png", previewCached: undefined, previewRevision: 2 }],
  );

  assert.deepEqual(result.removedImageIds, ["remove"]);
  assert.equal(result.images[0].name, "current.png");
  assert.equal(result.images[0].preview, undefined);
  assert.equal(result.images[0].previewCached, true);
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
