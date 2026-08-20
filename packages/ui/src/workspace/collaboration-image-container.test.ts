import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyImageParameterDocument } from "./image-protocol";
import {
  adoptCollaborationPreview,
  adoptCollaborationRender,
  createCollaborationImageContainer,
  disposeCollaborationImageContainer,
  replaceCollaborationDocument,
} from "./collaboration-image-container";
import type { WorkspaceOperation } from "./types";

const operation: WorkspaceOperation = {
  operationId: "operation", imageId: "image", authorId: "owner", baseCommitId: "initial",
  type: "rotate", parameters: { degrees: 90 }, createdAt: 1,
};

function container() {
  return createCollaborationImageContainer({
    imageId: "image", source: new Blob(["original"]), name: "image.png", mimeType: "image/png",
    sourceKind: "source", width: 10, height: 20, parameterDocument: emptyImageParameterDocument(),
  });
}

test("tracks whether the collaboration container uses Source or thumbnail data", () => {
  assert.equal(container().sourceKind, "source");
  const preview = createCollaborationImageContainer({
    imageId: "preview", source: new Blob(["thumbnail"]), sourceKind: "preview",
    name: "image.webp", mimeType: "image/webp", width: 10, height: 20,
    parameterDocument: emptyImageParameterDocument(),
  });
  assert.equal(preview.sourceKind, "preview");
});

test("keeps the original source isolated while adopting a rendered operation", async () => {
  const original = container();
  const document = { version: 1 as const, operations: [{ id: "operation", userId: "owner", time: 1, type: "rotate" as const, params: { degrees: 90 } }] };
  const updated = adoptCollaborationRender(original, document, {
    blob: new Blob(["rendered"]), name: "rotated.png", mimeType: "image/png", width: 20, height: 10,
  });
  assert.equal(await original.source.text(), "original");
  assert.equal(await updated.source.text(), "original");
  assert.equal(await updated.rendered.text(), "rendered");
});

test("parameter previews do not materialize or replace the full-resolution result", async () => {
  const original = container();
  const document = { version: 1 as const, operations: [{ id: "operation", userId: "owner", time: 1, type: "color" as const, params: { brightness: 20 } }] };
  const updated = adoptCollaborationPreview(original, document, {
    blob: new Blob(["preview"]), width: 10, height: 20,
  });
  assert.equal(await updated.preview.text(), "preview");
  assert.equal(await updated.rendered.text(), "original");
  assert.equal(await updated.source.text(), "original");
});

test("replacing the same parameter document renders equivalent owner and collaborator containers", async () => {
  const document = { version: 1 as const, operations: [{ id: "operation", userId: "owner", time: 1, type: "rotate" as const, params: { degrees: 90 } }] };
  const render = async (source: Blob, operations: WorkspaceOperation[]) => ({
    blob: new Blob([`${await source.text()}:${JSON.stringify(operations.map((value) => value.parameters))}`]),
    name: "rendered.png", mimeType: "image/png", width: 20, height: 10,
  });
  const owner = await replaceCollaborationDocument(container(), document, [operation], render);
  const collaborator = await replaceCollaborationDocument(container(), document, [operation], render);
  assert.equal(await owner.rendered.text(), await collaborator.rendered.text());
  const rolledBack = await replaceCollaborationDocument(owner, emptyImageParameterDocument(), [], render);
  assert.equal(await rolledBack.rendered.text(), "original");
});

test("disposing a collaboration container releases its transient blobs", async () => {
  const disposed = disposeCollaborationImageContainer(container());
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.source.size, 0);
  assert.equal(disposed.rendered.size, 0);
  assert.equal(disposed.preview.size, 0);
});
