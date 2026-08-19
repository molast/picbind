import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  WorkspaceDatabase, listActivities, listCommits, listProposals, listWorkspaceImages,
  promoteLocalWorkspace, purgeExpiredCache, restoreLocalWorkspace, saveActivity, saveCommit,
  saveProposal, saveWorkspace, saveWorkspaceImage, setWorkspaceDatabaseForTests,
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
    width: 1, height: 1, state: "private", shared: false, currentCommitId: null, previewRevision: 0,
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

test("isolates image content by Workspace", async () => {
  await saveWorkspaceImage(image("a", "workspace-a"));
  await saveWorkspaceImage(image("b", "workspace-b"));
  assert.deepEqual((await listWorkspaceImages("workspace-a")).map((value) => value.imageId), ["a"]);
  assert.deepEqual((await listWorkspaceImages("workspace-b")).map((value) => value.imageId), ["b"]);
});

test("keeps only 50 recent activities and drops entries older than 30 days", async () => {
  const now = 40 * 86_400_000;
  await saveActivity("workspace", { eventId: "expired", sequence: 0, actorId: "a", kind: "old", createdAt: 0 });
  for (let index = 0; index < 55; index += 1) {
    await saveActivity("workspace", { eventId: `event-${index}`, sequence: index + 1, actorId: "a", kind: "message", createdAt: now + index });
  }
  const values = await listActivities("workspace", now + 100);
  assert.equal(values.length, 50);
  assert.equal(values.some((value) => value.eventId === "expired"), false);
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
  assert.ok(local.source);
  assert.equal(local.preview, undefined);
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
});

test("promotes images and collaboration records without losing local data", async () => {
  await saveWorkspace(workspace("local"));
  await saveWorkspaceImage({ ...image("image", "local"), preview: new Blob(["preview"]) });
  await saveActivity("local", { eventId: "activity", sequence: 1, actorId: "owner", kind: "imageAdded", createdAt: Date.now() });
  await saveProposal({ proposalId: "proposal", workspaceId: "local", imageId: "image", authorId: "guest",
    baseCommitId: "initial", operations: [], state: "pending", createdAt: Date.now() });
  await promoteLocalWorkspace("local", { ...workspace("shared"), shareToken: "share-new" });

  assert.equal((await listWorkspaceImages("shared"))[0].workspaceId, "shared");
  assert.equal((await listActivities("shared")).length, 1);
  assert.equal((await listProposals("shared"))[0].workspaceId, "shared");
  assert.equal(await database.workspaces.get("local"), undefined);
  assert.ok((await database.cache.where("workspaceId").equals("shared").count()) > 0);
});
