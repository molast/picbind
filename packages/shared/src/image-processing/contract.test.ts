import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageProcessingError,
  emptyImageParameterDocument,
  setImageOperation,
  validateImageParameterDocument,
  validateImageProcessingSource,
} from "./index";

test("parameter documents keep one ordered operation per edited type", () => {
  const crop = setImageOperation(emptyImageParameterDocument(), {
    id: "crop-1",
    userId: "owner",
    time: 1,
    type: "crop",
    params: { x: 0, y: 0, width: 0.8, height: 0.8 },
  });
  const color = setImageOperation(crop, {
    id: "color-1",
    userId: "owner",
    time: 2,
    type: "color",
    params: { brightness: 12 },
  });
  const updatedCrop = setImageOperation(color, {
    id: "crop-2",
    userId: "owner",
    time: 3,
    type: "crop",
    params: { x: 0.1, y: 0.1, width: 0.7, height: 0.7 },
  });

  assert.deepEqual(updatedCrop.operations.map((operation) => operation.id), ["crop-2", "color-1"]);
  validateImageParameterDocument(updatedCrop);
});

test("invalid operation parameters use a stable error code", () => {
  assert.throws(
    () => validateImageParameterDocument({
      version: 1,
      operations: [{
        id: "crop-1",
        userId: "owner",
        time: 1,
        type: "crop",
        params: { x: 0.8, y: 0, width: 0.4, height: 1 },
      }],
    }),
    (error) => error instanceof ImageProcessingError && error.code === "invalidRequest",
  );
});

test("stored sources require opaque revisions", () => {
  assert.throws(
    () => validateImageProcessingSource({
      kind: "stored",
      name: "image.png",
      asset: {
        scope: "workspace",
        scopeKey: "workspace",
        id: "image",
        variant: "original",
        mimeType: "image/png",
        revision: "",
      },
    }),
    (error) => error instanceof ImageProcessingError && error.code === "invalidRequest",
  );
});
