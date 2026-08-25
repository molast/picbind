import assert from "node:assert/strict";
import { test } from "node:test";
import { collaborationActivitiesForImage, currentActivityEventId } from "./activity";
import type { WorkspaceActivity } from "./types";
import { readableActivityName } from "./utils/workspace-activity-display";
import { workspacePersonName } from "./utils/workspace-person-display";

function activity(eventId: string, kind: string, scope: WorkspaceActivity["scope"], imageId = "image"): WorkspaceActivity {
  return { eventId, sequence: 1, actorId: "owner", kind, imageId, detail: {}, createdAt: 1, scope };
}

test("collaborative image Activity excludes generic Workspace logs", () => {
  const values = collaborationActivitiesForImage([
    activity("move", "imageMovedToWorking", "workspaceLog"),
    activity("operation", "operationCommitted", "collaborationActivity"),
    activity("other-image", "operationCommitted", "collaborationActivity", "other"),
  ], "image");
  assert.deepEqual(values.map((value) => value.eventId), ["operation"]);
});

test("collaborative Activity retains JSON operation parameters", () => {
  const value = activity("operation", "operationCommitted", "collaborationActivity");
  value.detail = { operationId: "rotate", operationType: "rotate", parameters: { degrees: 90 } };
  const [result] = collaborationActivitiesForImage([value], "image");
  assert.deepEqual((result.detail as Record<string, unknown>).parameters, { degrees: 90 });
});

test("selects only the latest Activity for the current Commit", () => {
  const first = activity("first", "operationCommitted", "collaborationActivity");
  const latest = activity("latest", "proposalApproved", "collaborationActivity");
  first.detail = {commitId:"commit-1"};
  latest.detail = {commitId:"commit-1"};
  assert.equal(currentActivityEventId([first,latest],"commit-1"),"latest");
  assert.equal(currentActivityEventId([first,latest],"commit-2"),null);
});

test("does not mark a pending proposal as the current applied version", () => {
  const proposal = activity("proposal", "proposalSubmitted", "collaborationActivity");
  proposal.detail = { commitId: "commit-1", proposalId: "proposal-1" };
  assert.equal(currentActivityEventId([proposal], "commit-1"), null);
});

test("rollback transport events are not collaborative Activity entries", () => {
  assert.deepEqual(collaborationActivitiesForImage([
    activity("rollback", "historyRolledBack", "collaborationActivity"),
  ], "image"), []);
});

test("localizes collaborative Activity and protocol guest names for Chinese UI", () => {
  const value = activity("brightness", "operationCommitted", "collaborationActivity");
  value.detail = { operationType: "brightness" };
  assert.equal(readableActivityName(value, "zh"), "亮度 · 已应用");
  assert.equal(workspacePersonName("Guest", "zh"), "访客");
  assert.equal(workspacePersonName("Owner", "zh"), "所有者");
});
