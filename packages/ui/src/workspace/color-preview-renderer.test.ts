import assert from "node:assert/strict";
import { test } from "node:test";
import { colorPreviewOutputSize } from "../components/share/workspace/color-preview-renderer";

test("interactive color preview preserves aspect ratio within its pixel budget", () => {
  const source = { width: 720, height: 420 };
  const output = colorPreviewOutputSize(source.width, source.height, "interactive");

  assert.ok(output.width * output.height <= 150_000);
  assert.ok(Math.abs(output.width / output.height - source.width / source.height) < 0.01);
});

test("settled color preview retains the complete bounded preview surface", () => {
  assert.deepEqual(colorPreviewOutputSize(720, 420, "settled"), {
    width: 720,
    height: 420,
  });
});

test("interactive color preview does not resize a surface already within budget", () => {
  assert.deepEqual(colorPreviewOutputSize(320, 200, "interactive"), {
    width: 320,
    height: 200,
  });
});
