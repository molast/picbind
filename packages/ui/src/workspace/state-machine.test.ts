import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitState,
  transitionImageState,
  transitionProposalState,
  workspaceRuntimeReducer,
} from "./state-machine";
import type { WorkspaceCommit } from "./types";

test("Workspace runtime requires connection and sync transitions", () => {
  assert.equal(workspaceRuntimeReducer("local", { type: "transition", next: "available" }), "local");
  assert.equal(workspaceRuntimeReducer("local", { type: "transition", next: "connecting" }), "connecting");
  assert.equal(workspaceRuntimeReducer("syncing", { type: "transition", next: "available" }), "available");
  assert.equal(workspaceRuntimeReducer("ownerOffline", { type: "transition", next: "syncing" }), "syncing");
});

test("Image and Proposal terminal states reject invalid transitions", () => {
  assert.equal(transitionImageState("private", "committed"), "private");
  assert.equal(transitionImageState("private", "working"), "working");
  assert.equal(transitionProposalState("applied", "rejected"), "applied");
  assert.equal(transitionProposalState("failed", "submitted"), "submitted");
});

test("Commit state derives from Current Commit and snapshot availability", () => {
  const commit: WorkspaceCommit = { commitId: "commit", imageId: "image", authorId: "owner",
    parentCommitId: null, mergeParentCommitIds: [], operations: [], createdAt: 1 };
  assert.equal(commitState(commit, "commit"), "current");
  assert.equal(commitState(commit, "other"), "snapshotExpired");
  assert.equal(commitState({ ...commit, snapshot: new Blob(["snapshot"]) }, "other"), "historical");
  assert.equal(commitState({ ...commit, snapshotCached: true }, "other"), "historical");
});
