import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveGuestShareToken,
  selectOwnerWorkspace,
  workspaceEntryKey,
} from "./workspace-route-mode";

test("explicit workspace entry keeps collaborator mode for the owner's share ID", () => {
  assert.equal(
    resolveGuestShareToken("share_123456789012", "share_123456789012", "collaborator"),
    "share_123456789012",
  );
});

test("ordinary owner route keeps the owner's workspace identity", () => {
  assert.equal(
    resolveGuestShareToken("share_123456789012", "share_123456789012", null),
    undefined,
  );
});

test("a different share ID remains a collaborator route without an explicit mode", () => {
  assert.equal(
    resolveGuestShareToken("share_abcdefghijkl", "share_123456789012", null),
    "share_abcdefghijkl",
  );
});

test("the owner's share ID uses the owner cache entry", () => {
  assert.equal(
    workspaceEntryKey("share_owner", "share_owner", null, "workspace-owner"),
    "owner:workspace-owner",
  );
});

test("different share IDs get isolated page/cache targets", () => {
  assert.equal(
    workspaceEntryKey("share_alice", "share_owner", null, "workspace-owner"),
    "collaborator:share_alice",
  );
  assert.notEqual(
    workspaceEntryKey("share_alice", "share_owner", null, "workspace-owner"),
    workspaceEntryKey("share_bob", "share_owner", null, "workspace-owner"),
  );
});

test("owner lookup checks every authenticated Workspace share ID", () => {
  const workspaces = [
    { id: "workspace-a", shareId: "share_a" },
    { id: "workspace-b", shareId: "share_b" },
  ];
  assert.equal(selectOwnerWorkspace(workspaces, "share_b")?.id, "workspace-b");
  assert.equal(selectOwnerWorkspace(workspaces, "share_unknown")?.id, "workspace-a");
  assert.equal(selectOwnerWorkspace(workspaces, null)?.id, "workspace-a");
});
