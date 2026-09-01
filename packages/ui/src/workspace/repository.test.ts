import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  WorkspaceDatabase, clearOperationLogs, clearWorkspaceImageHistory, deleteCollaborationActivitiesAfter, deleteCommitsAfter, deleteWorkspaceImage, listActivities, listCommits,
  listOperationLogs, listProposals, listWorkspaceImages, promoteLocalWorkspace, purgeExpiredCache,
  restoreLocalWorkspace, restoreProvisionedWorkspace, saveActivity, saveCollaborationActivity, saveCommit,
  readWorkspaceCommitSnapshot, readWorkspaceImagePreview, readWorkspaceImageSource,
  saveProposal, saveWorkspace, saveWorkspaceImage,
  setWorkspaceDatabaseForTests,
} from "./repository";
import { defaultWorkspaceStyle, type WorkspaceIdentity, type WorkspaceImage } from "./types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

let database: WorkspaceDatabase;
beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  database = new WorkspaceDatabase(`workspace-test-${crypto.randomUUID()}`);
  setWorkspaceDatabaseForTests(database);
});
afterEach(async () => { database.close(); await database.delete(); setWorkspaceDatabaseForTests(null); });

function workspace(workspaceId: string, role: "owner" | "collaborator" = "owner"): WorkspaceIdentity {
  return { workspaceId, name: "Workspace", role, shareToken: role === "owner" ? null : "share-test",
    ownerCapability: role === "owner" ? "owner-test" : null, createdAt: 1, updatedAt: 1,
    style: defaultWorkspaceStyle() };
}

function image(imageId: string, workspaceId: string): WorkspaceImage {
  return { imageId, workspaceId, name: `${imageId}.png`, mimeType: "image/png", size: 1,
    width: 1, height: 1, workspaceLocation: "library", state: "private", shared: false, currentCommitId: null, previewRevision: 0,
    createdAt: 1, updatedAt: 1,
    source: new Blob([new Uint8Array([1]).buffer as ArrayBuffer], { type: "image/png" }) };
}

test("restores one local Workspace without any login state", async () => {
  const first = await restoreLocalWorkspace(10);
  localStorage.setItem("unrelated-auth-session", "changed");
  const restored = await restoreLocalWorkspace(20);
  assert.equal(restored.workspaceId, first.workspaceId);
  assert.equal(restored.createdAt, 10);
  assert.equal(JSON.stringify(restored).includes("session"), false);
});

test("promotes local Workspace data into an authenticated provisioned Workspace", async () => {
  const local = await restoreLocalWorkspace(10);
  await saveWorkspaceImage(image("local-image", local.workspaceId));
  const provisioned = workspace("remote-workspace");
  provisioned.shareToken = "share-remote";
  provisioned.ownerCapability = "owner-remote";
  const restored = await restoreProvisionedWorkspace(provisioned);
  assert.equal(restored.workspaceId, "remote-workspace");
  assert.equal(localStorage.getItem("picbind.workspace.local-id"), "remote-workspace");
  assert.deepEqual((await listWorkspaceImages("remote-workspace")).map((value) => value.imageId), ["local-image"]);
  assert.equal(await database.workspaces.get(local.workspaceId), undefined);
});

test("switching to another owned Workspace never promotes its existing cache", async () => {
  const first = { ...workspace("workspace-a"), shareToken: "share-a", ownerCapability: "owner-a" };
  const second = { ...workspace("workspace-b"), shareToken: "share-b", ownerCapability: "owner-b" };
  await saveWorkspace(first);
  await saveWorkspaceImage(image("first-image", first.workspaceId));
  localStorage.setItem("picbind.workspace.local-id", first.workspaceId);

  const restored = await restoreProvisionedWorkspace(second);

  assert.equal(restored.workspaceId, second.workspaceId);
  assert.deepEqual(await listWorkspaceImages(second.workspaceId), []);
  assert.deepEqual((await listWorkspaceImages(first.workspaceId)).map((value) => value.imageId), ["first-image"]);
  assert.equal(await database.workspaces.get(first.workspaceId) !== undefined, true);
});

test("isolates image content by Workspace", async () => {
  await saveWorkspaceImage(image("a", "workspace-a"));
  await saveWorkspaceImage(image("b", "workspace-b"));
  assert.deepEqual((await listWorkspaceImages("workspace-a")).map((value) => value.imageId), ["a"]);
  assert.deepEqual((await listWorkspaceImages("workspace-b")).map((value) => value.imageId), ["b"]);
});

test("separates Workspace operation logs from collaborative image Activity", async () => {
  const now = 40 * 86_400_000;
  await saveActivity("workspace", { eventId: "expired", sequence: 0, actorId: "a", kind: "old", createdAt: 0 });
  for (let index = 0; index < 55; index += 1) {
    await saveActivity("workspace", { eventId: `log-${index}`, sequence: index + 1, actorId: "a", kind: "imageMovedToWorking", createdAt: now + index });
  }
  await saveCollaborationActivity("workspace", { eventId: "activity", sequence: 60, actorId: "a",
    kind: "operationCommitted", imageId: "image", detail: { parameters: { degrees: 90 } }, createdAt: now + 60 });
  assert.deepEqual((await listActivities("workspace", now + 100)).map((value) => value.eventId), ["activity"]);
  assert.equal((await listOperationLogs("workspace", now + 100)).length, 55);
  await clearOperationLogs("workspace");
  assert.equal((await listOperationLogs("workspace", now + 100)).length, 0);
  assert.equal((await listActivities("workspace", now + 100)).length, 0);
});

test("expires collaborator Source and Preview while retaining Owner Source", async () => {
  await saveWorkspace(workspace("collaborator", "collaborator"));
  await saveWorkspaceImage({ ...image("remote", "collaborator"), preview: new Blob(["preview"]) });
  await database.cache.where("workspaceId").equals("collaborator").modify({ expiresAt: 5 });
  assert.equal(await purgeExpiredCache(10), 2);
  const [remote] = await listWorkspaceImages("collaborator");
  assert.equal(remote.source, undefined);
  assert.equal(remote.preview, undefined);

  await saveWorkspace(workspace("owner"));
  await saveWorkspaceImage({ ...image("local", "owner"), preview: new Blob(["preview"]) });
  await database.cache.where("workspaceId").equals("owner").modify({ expiresAt: 5 });
  await purgeExpiredCache(10);
  const [local] = await listWorkspaceImages("owner");
  assert.equal(local.source, undefined);
  assert.equal(local.sourceCached, true);
  assert.equal(local.previewCached, false);
});

test("deleting a collaborator image removes its source and thumbnail cache entries", async () => {
  await saveWorkspace(workspace("collaborator", "collaborator"));
  await saveWorkspaceImage({
    ...image("remote", "collaborator"),
    preview: new Blob(["preview"], { type: "image/webp" }),
  });
  assert.equal(await database.cache.where("workspaceId").equals("collaborator").count(), 2);
  await saveCommit({ commitId: "commit", imageId: "remote", authorId: "owner", parentCommitId: null,
    mergeParentCommitIds: [], operations: [], snapshot: new Blob(["commit"]), createdAt: 1 });
  await saveProposal({ proposalId: "proposal", workspaceId: "collaborator", imageId: "remote",
    authorId: "guest", baseCommitId: "commit", operations: [], state: "pending", createdAt: 1 });
  await saveCollaborationActivity("collaborator", { eventId: "activity", sequence: 1, actorId: "guest",
    kind: "proposalSubmitted", imageId: "remote", createdAt: 1 });

  await deleteWorkspaceImage("remote");

  assert.equal(await database.images.get("remote"), undefined);
  assert.equal(await database.commits.where("imageId").equals("remote").count(), 0);
  assert.equal(await database.proposals.where("imageId").equals("remote").count(), 0);
  assert.equal(await database.activities.where("workspaceId").equals("collaborator").count(), 0);
  assert.equal(await database.cache.where("workspaceId").equals("collaborator").count(), 0);
});

test("clears image operation history while preserving the Library source", async () => {
  await saveWorkspace(workspace("owner"));
  await saveWorkspaceImage({ ...image("working", "owner"), workspaceLocation: "working" });
  await saveCommit({ commitId: "commit", imageId: "working", authorId: "owner", parentCommitId: null,
    mergeParentCommitIds: [], operations: [], snapshot: new Blob(["commit"]), createdAt: 1 });
  await saveProposal({ proposalId: "proposal", workspaceId: "owner", imageId: "working",
    authorId: "guest", baseCommitId: "commit", operations: [], state: "pending", createdAt: 1 });
  await saveCollaborationActivity("owner", { eventId: "activity", sequence: 1, actorId: "owner",
    kind: "operationCommitted", imageId: "working", createdAt: 1 });

  await clearWorkspaceImageHistory("working");

  assert.equal((await listWorkspaceImages("owner")).length, 1);
  assert.equal(await (await readWorkspaceImageSource((await listWorkspaceImages("owner"))[0]))?.text(), String.fromCharCode(1));
  assert.equal((await listCommits("working")).length, 0);
  assert.equal((await listProposals("owner")).length, 0);
  assert.equal((await listActivities("owner", 10)).length, 0);
});

test("metadata-only image updates preserve stored source and thumbnail blobs", async () => {
  await saveWorkspace(workspace("owner"));
  const original = {
    ...image("image", "owner"),
    preview: new Blob(["preview"], { type: "image/webp" }),
  };
  await saveWorkspaceImage(original);
  await saveWorkspaceImage({ ...original, state: "working", workspaceLocation: "working" }, {
    writeBlobs: false,
  });

  const [restored] = await listWorkspaceImages("owner");
  assert.equal(restored.state, "working");
  assert.equal(restored.source, undefined);
  assert.equal(restored.preview, undefined);
  assert.equal(restored.sourceCached, true);
  assert.equal(restored.previewCached, true);
  assert.equal(await (await readWorkspaceImageSource(restored))?.text(), String.fromCharCode(1));
  assert.equal(await (await readWorkspaceImagePreview(restored))?.text(), "preview");
});

test("keeps only the latest 20 Commit snapshots for each image", async () => {
  await saveWorkspace(workspace("workspace"));
  await saveWorkspaceImage(image("image", "workspace"));
  const now = Date.now();
  for (let index = 0; index < 25; index += 1) {
    await saveCommit({ commitId: `commit-${index}`, imageId: "image", authorId: "owner",
      parentCommitId: index ? `commit-${index - 1}` : null, mergeParentCommitIds: [], operations: [],
      snapshot: new Blob([String(index)]), createdAt: now + index });
  }
  const commits = await listCommits("image");
  assert.equal(commits.length, 20);
  assert.equal(commits[0].commitId, "commit-5");
  assert.equal(commits.at(-1)?.commitId, "commit-24");
  assert.equal(commits.every((commit) => commit.snapshot === undefined), true);
  assert.equal(commits.every((commit) => commit.snapshotCached), true);
  assert.equal(await (await readWorkspaceCommitSnapshot(commits.at(-1)!))?.text(), "24");
});

test("resolves the initial Commit from the Library source without storing a duplicate snapshot", async () => {
  await saveWorkspace(workspace("workspace"));
  await saveWorkspaceImage(image("image", "workspace"));
  await saveCommit({
    commitId: "initial_image",
    imageId: "image",
    authorId: "owner",
    parentCommitId: null,
    mergeParentCommitIds: [],
    operations: [],
    snapshotCached: true,
    snapshotName: "image.png",
    snapshotMimeType: "image/png",
    createdAt: Date.now(),
  });

  const [storedImage] = await listWorkspaceImages("workspace");
  assert.equal(storedImage.sourceCached, true);
  assert.equal(await (await readWorkspaceImageSource(storedImage))?.text(), String.fromCharCode(1));
  const [initial] = await listCommits("image");
  assert.equal(initial.snapshot, undefined);
  assert.equal(initial.snapshotCached, true);
  assert.equal(await (await readWorkspaceCommitSnapshot(initial))?.text(), String.fromCharCode(1));
});

test("deletes Commit history after a rollback target", async () => {
  await saveWorkspace(workspace("workspace"));
  await saveWorkspaceImage(image("image", "workspace"));
  for (let index = 1; index <= 3; index += 1) {
    await saveCommit({ commitId: `commit-${index}`, imageId: "image", authorId: "owner",
      parentCommitId: index === 1 ? null : `commit-${index - 1}`, mergeParentCommitIds: [], operations: [],
      createdAt: index });
  }
  assert.deepEqual(await deleteCommitsAfter("image", 1), ["commit-2", "commit-3"]);
  assert.deepEqual((await listCommits("image")).map(({ commitId }) => commitId), ["commit-1"]);
});

test("deletes later collaborative Activity for one image", async () => {
  await saveCollaborationActivity("workspace", {eventId:"keep",sequence:1,actorId:"owner",kind:"operationCommitted",imageId:"image",detail:{},createdAt:1});
  await saveCollaborationActivity("workspace", {eventId:"remove",sequence:2,actorId:"owner",kind:"operationCommitted",imageId:"image",detail:{},createdAt:2});
  await saveCollaborationActivity("workspace", {eventId:"other",sequence:3,actorId:"owner",kind:"operationCommitted",imageId:"other",detail:{},createdAt:3});
  assert.deepEqual(await deleteCollaborationActivitiesAfter("workspace","image",1),["remove"]);
  assert.deepEqual((await listActivities("workspace",10)).map((activity)=>activity.eventId),["keep","other"]);
});

test("promotes images and collaboration records without losing local data", async () => {
  await saveWorkspace(workspace("local"));
  await saveWorkspaceImage({ ...image("image", "local"), preview: new Blob(["preview"]) });
  await saveActivity("local", { eventId: "activity", sequence: 1, actorId: "owner", kind: "imageAdded", createdAt: Date.now() });
  await saveProposal({ proposalId: "proposal", workspaceId: "local", imageId: "image", authorId: "guest",
    baseCommitId: "initial", operations: [], state: "pending", createdAt: Date.now() });
  await promoteLocalWorkspace("local", { ...workspace("shared"), shareToken: "share-new" });

  assert.equal((await listWorkspaceImages("shared"))[0].workspaceId, "shared");
  assert.equal((await listOperationLogs("shared")).length, 1);
  assert.equal((await listProposals("shared"))[0].workspaceId, "shared");
  assert.equal(await database.workspaces.get("local"), undefined);
  assert.ok((await database.cache.where("workspaceId").equals("shared").count()) > 0);
});
