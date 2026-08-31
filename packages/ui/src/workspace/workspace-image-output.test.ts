import assert from "node:assert/strict";
import test from "node:test";
import {
  workspaceEditedImageName,
  workspaceMaterializeQuality,
} from "./utils/workspace-image-output";

test("workspace materialization keeps PNG lossless and bounds lossy source codecs", () => {
  assert.equal(workspaceMaterializeQuality("image/png"), 100);
  assert.equal(workspaceMaterializeQuality("image/jpeg"), 82);
  assert.equal(workspaceMaterializeQuality("image/webp"), 82);
  assert.equal(workspaceMaterializeQuality("image/avif"), 58);
  assert.equal(workspaceMaterializeQuality("image/jxl"), 100);
});

test("a saved copy keeps the source codec extension and has a distinct name", () => {
  assert.equal(workspaceEditedImageName("boat.641e4e5c.png", "image/png"), "boat.641e4e5c-edited.png");
  assert.equal(workspaceEditedImageName("photo.png", "image/jpeg"), "photo-edited.jpg");
  assert.equal(workspaceEditedImageName("photo.jpg", "image/avif; codecs=av01"), "photo-edited.avif");
});
