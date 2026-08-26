import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendImageOperation,
  emptyImageParameterDocument,
  imageParameterDocumentsEqual,
  isValidImageParameterDocument,
  setImageOperation,
  truncateImageParameterDocument,
} from "./image-protocol";

test("compares parameter queues by ordered operation content", () => {
  const left = appendImageOperation(emptyImageParameterDocument(), {
    id: "operation", userId: "owner", time: 1, type: "color",
    params: { contrast: 2, nested: { saturation: 3, brightness: 1 } },
  });
  const equivalent = appendImageOperation(emptyImageParameterDocument(), {
    id: "operation", userId: "owner", time: 1, type: "color",
    params: { nested: { brightness: 1, saturation: 3 }, contrast: 2 },
  });
  const changed = appendImageOperation(emptyImageParameterDocument(), {
    id: "operation", userId: "owner", time: 1, type: "color",
    params: { contrast: 4, nested: { brightness: 1, saturation: 3 } },
  });
  assert.equal(imageParameterDocumentsEqual(left, equivalent), true);
  assert.equal(imageParameterDocumentsEqual(left, changed), false);
});

test("image protocol appends versioned parameter operations without blobs", () => {
  const document = appendImageOperation(emptyImageParameterDocument(), {
    id: "operation-1",
    userId: "guest",
    time: 1,
    type: "crop",
    params: { x: 0, y: 0, width: 0.5, height: 0.5 },
  });
  assert.equal(document.version, 1);
  assert.equal(isValidImageParameterDocument(document), true);
  assert.equal("blob" in document.operations[0].params, false);
});

test("truncates parameter history to operations retained by a Commit", () => {
  const document = {
    version: 1 as const,
    operations: [
      { id: "one", userId: "owner", time: 1, type: "crop" as const, params: {} },
      { id: "two", userId: "owner", time: 2, type: "color" as const, params: {} },
    ],
  };
  assert.deepEqual(truncateImageParameterDocument(document, new Set(["one"])).operations.map(({ id }) => id), ["one"]);
  assert.deepEqual(truncateImageParameterDocument(document, new Set(["two"])).operations, []);
});

test("parameter operations remain an insertion-ordered queue", () => {
  const first = appendImageOperation(emptyImageParameterDocument(), {
    id: "first", userId: "owner", time: 20, type: "crop",
    params: { x: 0, y: 0, width: 1, height: 1 },
  });
  const second = appendImageOperation(first, {
    id: "second", userId: "guest", time: 10, type: "color", params: {},
  });
  assert.deepEqual(second.operations.map(({ id }) => id), ["first", "second"]);
});

test("current parameter JSON keeps one entry per operation type", () => {
  const first = appendImageOperation(emptyImageParameterDocument(), {
    id: "crop-1", userId: "owner", time: 1, type: "crop",
    params: { x: 0.1, y: 0, width: 0.9, height: 1 },
  });
  const withColor = setImageOperation(first, {
    id: "color-1", userId: "owner", time: 2, type: "color", params: { brightness: 10 },
  });
  const updated = setImageOperation(withColor, {
    id: "crop-2", userId: "owner", time: 3, type: "crop",
    params: { x: 0.2, y: 0, width: 0.8, height: 1 },
  });
  assert.deepEqual(updated.operations.map(({id})=>id), ["crop-2", "color-1"]);
  assert.deepEqual(updated.operations[0].params, { x: 0.2, y: 0, width: 0.8, height: 1 });
});

test("image protocol rejects malformed or oversized documents", () => {
  assert.equal(isValidImageParameterDocument({ version: 2, operations: [] }), false);
  assert.equal(isValidImageParameterDocument({ version: 1, operations: [{ id: "x" }] }), false);
  assert.equal(isValidImageParameterDocument({
    version: 1,
    operations: [
      { id: "same", userId: "owner", time: 1, type: "crop", params: {} },
      { id: "same", userId: "owner", time: 2, type: "color", params: {} },
    ],
  }), false);
  assert.equal(isValidImageParameterDocument({
    version: 1,
    operations: Array.from({ length: 101 }, (_, index) => ({
      id: String(index), userId: "guest", time: index, type: "crop", params: {},
    })),
  }), false);
});
