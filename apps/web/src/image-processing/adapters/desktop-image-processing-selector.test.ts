import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageProcessingError,
  type ImageProcessingEngine,
  type ImageProcessingService,
  type ImageProcessingSource,
} from "@picbind/shared";
import { DesktopImageProcessingSelector } from "./desktop-image-processing-selector";

function source(mimeType: string): ImageProcessingSource {
  return {
    kind: "blob",
    blob: new Blob([new Uint8Array([1])], { type: mimeType }),
    name: "fixture",
    mimeType,
  };
}

function recordingService(engine: ImageProcessingEngine, calls: string[]): ImageProcessingService {
  const record = (operation: string) => {
    calls.push(operation);
    return Promise.resolve(undefined as never);
  };
  return {
    engine,
    capabilities: () => record("capabilities"),
    inspect: () => record("inspect"),
    renderPreview: () => record("renderPreview"),
    materialize: () => record("materialize"),
    compress: () => record("compress"),
    compareQuality: () => record("compareQuality"),
    convert: () => record("convert"),
    createShareAssets: () => record("createShareAssets"),
    releaseMemorySource: () => record("releaseMemorySource"),
    releasePreviewCache: () => record("releasePreviewCache"),
    releaseTemporary: () => record("releaseTemporary"),
  };
}

test("Desktop selector routes supported sources and documents to Native", async () => {
  const nativeCalls: string[] = [];
  const webCalls: string[] = [];
  const selector = new DesktopImageProcessingSelector(
    recordingService("desktop-native", nativeCalls),
    recordingService("web", webCalls),
  );
  const png = source("image/png");

  await selector.inspect(png);
  await selector.renderPreview({
    source: png,
    document: {
      version: 1,
      operations: [{ id: "crop", userId: "user", time: 1, type: "crop", params: {} }],
    },
    maxWidth: 100,
    maxHeight: 100,
    mimeType: "image/webp",
    quality: 0.8,
  });

  assert.deepEqual(nativeCalls, ["inspect", "renderPreview"]);
  assert.deepEqual(webCalls, []);
});

test("Desktop selector routes legacy sources and unsupported parameters to Web", async () => {
  const nativeCalls: string[] = [];
  const webCalls: string[] = [];
  const selector = new DesktopImageProcessingSelector(
    recordingService("desktop-native", nativeCalls),
    recordingService("web", webCalls),
  );

  await selector.inspect(source("image/gif"));
  await selector.createShareAssets({
    source: source("image/png"),
    document: {
      version: 1,
      operations: [{ id: "filter", userId: "user", time: 1, type: "filter", params: {} }],
    },
    container: { width: 100, height: 100 },
  });

  assert.deepEqual(nativeCalls, []);
  assert.deepEqual(webCalls, ["inspect", "createShareAssets"]);
});

test("Desktop selector never sends a temporary artifact request to Web", async () => {
  const nativeCalls: string[] = [];
  const webCalls: string[] = [];
  const selector = new DesktopImageProcessingSelector(
    recordingService("desktop-native", nativeCalls),
    recordingService("web", webCalls),
  );

  await assert.rejects(
    selector.compress({
      source: source("image/gif"),
      options: { format: "webp" },
      destination: "temporary",
    }),
    (error) => error instanceof ImageProcessingError && error.code === "capabilityUnavailable",
  );
  assert.deepEqual(nativeCalls, []);
  assert.deepEqual(webCalls, []);
});

test("Desktop selector does not hide Native failures behind a Web retry", async () => {
  const webCalls: string[] = [];
  const native = recordingService("desktop-native", []);
  native.inspect = async () => {
    throw new ImageProcessingError("decodeFailed", "native decode failed");
  };
  const selector = new DesktopImageProcessingSelector(
    native,
    recordingService("web", webCalls),
  );

  await assert.rejects(
    selector.inspect(source("image/png")),
    (error) => error instanceof ImageProcessingError && error.code === "decodeFailed",
  );
  assert.deepEqual(webCalls, []);
});
