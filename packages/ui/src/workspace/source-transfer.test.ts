import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceTransferRegistry } from "./source-transfer";

async function digest(bytes: Uint8Array) {
  const value = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function manifest(bytes: Uint8Array) {
  return {
    requestId: "request-1",
    imageId: "image-1",
    mimeType: "image/png",
    totalChunks: 2,
    totalBytes: bytes.byteLength,
    sha256: await digest(bytes),
    currentCommitId: "commit-1",
  };
}

test("assembles ordered Source chunks and ignores exact duplicates", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const registry = new SourceTransferRegistry();
  assert.equal(registry.start(await manifest(bytes)), true);
  assert.equal(registry.push("request-1", 1, bytes.slice(2)), true);
  assert.equal(registry.push("request-1", 0, bytes.slice(0, 2)), true);
  assert.equal(registry.push("request-1", 0, bytes.slice(0, 2)), true);
  const completed = await registry.complete("request-1");
  assert.deepEqual([...new Uint8Array(await completed!.source.arrayBuffer())], [...bytes]);
  assert.equal(completed?.currentCommitId, "commit-1");
  assert.equal(registry.size, 0);
});

test("waits for chunks that arrive after Source completion", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const missing = new SourceTransferRegistry();
  missing.start(await manifest(bytes));
  missing.push("request-1", 0, bytes.slice(0, 2));
  assert.equal(await missing.complete("request-1"), null);
  assert.equal(missing.isCompletionPending("request-1"), true);
  missing.push("request-1", 1, bytes.slice(2));
  const completed = await missing.complete("request-1");
  assert.deepEqual([...new Uint8Array(await completed!.source.arrayBuffer())], [...bytes]);
  assert.equal(missing.size, 0);
});

test("retains bounded chunks and completion that arrive before Source metadata", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const registry = new SourceTransferRegistry();
  assert.equal(registry.push("request-1", 1, bytes.slice(2)), true);
  assert.equal(await registry.complete("request-1"), null);
  assert.equal(registry.has("request-1"), true);
  assert.equal(registry.start(await manifest(bytes)), true);
  assert.equal(registry.isCompletionPending("request-1"), true);
  assert.equal(registry.push("request-1", 0, bytes.slice(0, 2)), true);

  const completed = await registry.complete("request-1");
  assert.deepEqual([...new Uint8Array(await completed!.source.arrayBuffer())], [...bytes]);
  assert.equal(registry.size, 0);
});

test("rejects corrupt Source chunks and clears request state", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const corrupt = new SourceTransferRegistry();
  corrupt.start(await manifest(bytes));
  corrupt.push("request-1", 0, bytes.slice(0, 2));
  corrupt.push("request-1", 1, new Uint8Array([9, 9]));
  assert.equal(await corrupt.complete("request-1"), null);
  assert.equal(corrupt.size, 0);
});

test("rejects invalid manifests and chunks that exceed the declared size", async () => {
  const registry = new SourceTransferRegistry();
  assert.equal(registry.start({
    requestId: "bad",
    imageId: "image",
    mimeType: "text/plain",
    totalChunks: 0,
    totalBytes: 0,
    sha256: "bad",
  }), false);
  const bytes = new Uint8Array([1, 2]);
  const valid = await manifest(bytes);
  valid.totalChunks = 1;
  registry.start(valid);
  assert.equal(registry.push("request-1", 0, new Uint8Array([1, 2, 3])), false);
  assert.equal(registry.size, 0);
});
