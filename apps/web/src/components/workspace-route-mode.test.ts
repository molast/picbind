import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGuestShareToken } from "./workspace-route-mode";

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
