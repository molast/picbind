import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceCommitId,
  initialWorkspaceCommitId,
  isInitialWorkspaceCommitId,
} from "../utils/id";

test("creates compact UUID Commit IDs", () => {
  assert.match(createWorkspaceCommitId(), /^[0-9a-f]{32}$/);
});

test("derives the initial Commit ID from the image UUID", () => {
  const imageId = "image_4663ccf7-f123-4abc-8123-1234567890ab";
  assert.equal(initialWorkspaceCommitId(imageId), "initial_4663ccf7f1234abc81231234567890ab");
  assert.equal(isInitialWorkspaceCommitId("initial_4663ccf7f1234abc81231234567890ab", imageId), true);
  assert.equal(isInitialWorkspaceCommitId(`initial_${imageId}`, imageId), true);
});
