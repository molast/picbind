import assert from "node:assert/strict";
import { test } from "node:test";
import { isInboundEventAllowed, validateOperation, validateProposal } from "./policy";
import type { WorkspaceImage, WorkspaceOperation, WorkspaceProposal } from "./types";

const image: WorkspaceImage = { imageId: "image", workspaceId: "workspace", name: "image.png",
  mimeType: "image/png", size: 1, width: 1, height: 1, state: "shared", currentCommitId: "commit",
  shared: true, previewRevision: 1, createdAt: 1, updatedAt: 1 };
const operation: WorkspaceOperation = { operationId: "operation", imageId: "image", authorId: "guest",
  baseCommitId: "commit", type: "resize", parameters: { width: 100, height: 100 }, createdAt: 1 };
const proposal: WorkspaceProposal = { proposalId: "proposal", workspaceId: "workspace", imageId: "image",
  authorId: "guest", baseCommitId: "commit", operations: [operation], state: "submitted", createdAt: 1 };

test("accepts business events only from the role that owns them", () => {
  assert.equal(isInboundEventAllowed("collaborator", "styleUpdated", "owner"), true);
  assert.equal(isInboundEventAllowed("collaborator", "styleUpdated", "collaborator"), false);
  assert.equal(isInboundEventAllowed("owner", "proposalSubmit", "collaborator"), true);
  assert.equal(isInboundEventAllowed("owner", "proposalSubmit", "owner"), false);
  assert.equal(isInboundEventAllowed("owner", "message", "collaborator"), true);
});

test("rejects invalid operation bounds before Proposal review", () => {
  assert.equal(validateOperation(operation), true);
  assert.equal(validateOperation({ ...operation, parameters: { width: 0, height: 10 } }), false);
  assert.equal(validateOperation({ ...operation, type: "crop", parameters: { x: 0.8, y: 0, width: 0.3, height: 1 } }), false);
  assert.equal(validateOperation({ ...operation, type: "rotate", parameters: { degrees: 45 } }), false);
});

test("validates Proposal ownership, image state, base Commit and operations", () => {
  assert.equal(validateProposal(proposal, "workspace", image), true);
  assert.equal(validateProposal({ ...proposal, workspaceId: "other" }, "workspace", image), false);
  assert.equal(validateProposal({ ...proposal, operations: [] }, "workspace", image), false);
  assert.equal(validateProposal(proposal, "workspace", { ...image, state: "private", shared: false }), false);
});
