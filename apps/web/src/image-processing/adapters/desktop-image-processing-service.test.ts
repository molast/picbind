import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageProcessingError,
  type ImageTaskProgress,
} from "@picbind/shared";
import {
  DesktopImageProcessingService,
  type DesktopNativeBridge,
} from "./desktop-image-processing-service";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type RequestMetadata = Record<string, unknown> & {
  apiVersion: number;
  requestId: string;
  inlineLength: number;
};

function decodeRequest(value: unknown) {
  assert.ok(value instanceof Uint8Array);
  const metadataLength = new DataView(value.buffer, value.byteOffset, value.byteLength)
    .getUint32(0, true);
  const metadataEnd = 4 + metadataLength;
  return {
    metadata: JSON.parse(decoder.decode(value.subarray(4, metadataEnd))) as RequestMetadata,
    bytes: value.slice(metadataEnd),
  };
}

function response(metadata: Record<string, unknown>, bytes = new Uint8Array()) {
  const encoded = encoder.encode(JSON.stringify({ ...metadata, dataLength: bytes.byteLength }));
  const frame = new Uint8Array(4 + encoded.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, encoded.byteLength, true);
  frame.set(encoded, 4);
  frame.set(bytes, 4 + encoded.byteLength);
  return frame;
}

function nativeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    width: 2,
    height: 1,
    format: "png",
    mimeType: "image/png",
    sizeBytes: 4,
    hasAlpha: true,
    frameCount: 1,
    orientationApplied: false,
    ...overrides,
  };
}

function source() {
  return {
    kind: "blob" as const,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
    name: "fixture.png",
    mimeType: "image/png",
  };
}

function cachedSource() {
  return { ...source(), cacheKey: "workspace:image:1" };
}

test("Desktop Adapter sends versioned binary requests and filters progress by requestId", async () => {
  const handlers = new Set<(event: { payload: never }) => void>();
  const progress: ImageTaskProgress[] = [];
  let request: ReturnType<typeof decodeRequest> | undefined;
  const bridge: DesktopNativeBridge = {
    randomUUID: () => "generated-request-id",
    async listen(_event, handler) {
      handlers.add(handler as (event: { payload: never }) => void);
      return () => handlers.delete(handler as (event: { payload: never }) => void);
    },
    async invoke<T>(command: string, args?: unknown) {
      assert.equal(command, "image_processing_execute");
      request = decodeRequest(args);
      for (const handler of handlers) {
        handler({
          payload: {
            requestId: "another-request",
            stage: "encoding",
            completed: 0,
            total: 1,
          } as never,
        });
        handler({
          payload: {
            requestId: "generated-request-id",
            stage: "decoding",
            completed: 1,
            total: 1,
          } as never,
        });
      }
      return response({
        metadata: nativeMetadata(),
        returnedOriginal: false,
        implementation: "test-native",
      }) as T;
    },
  };

  const service = new DesktopImageProcessingService(bridge);
  const metadata = await service.inspect(source(), { requestId: "", onProgress: (value) => progress.push(value) });

  assert.equal(metadata.format, "png");
  assert.equal(request?.metadata.apiVersion, 1);
  assert.equal(request?.metadata.requestId, "generated-request-id");
  assert.equal(request?.metadata.inlineLength, 4);
  assert.deepEqual([...request!.bytes], [1, 2, 3, 4]);
  assert.deepEqual(progress, [{ stage: "decoding", completed: 1, total: 1 }]);
  assert.equal(handlers.size, 0);
});

test("Desktop Adapter returns and releases opaque temporary artifacts", async () => {
  const released: string[] = [];
  const bridge: DesktopNativeBridge = {
    randomUUID: () => "temporary-request",
    async listen() {
      return () => undefined;
    },
    async invoke<T>(command: string, args?: unknown) {
      if (command === "image_processing_release_temporary") {
        released.push((args as { token: string }).token);
        return undefined as T;
      }
      const request = decodeRequest(args);
      assert.equal(request.metadata.destination, "temporary");
      return response({
        metadata: nativeMetadata(),
        returnedOriginal: false,
        implementation: "test-native",
        temporary: {
          token: "opaque-token",
          mimeType: "image/png",
          sizeBytes: 4,
          expiresAt: 123_456,
        },
      }) as T;
    },
  };
  const service = new DesktopImageProcessingService(bridge);
  const result = await service.compress({
    source: source(),
    options: { format: "png", profile: "interactive", quality: 80 },
    destination: "temporary",
  });

  assert.deepEqual(result.artifact, {
    kind: "temporary",
    token: "opaque-token",
    mimeType: "image/png",
    sizeBytes: 4,
    expiresAt: 123_456,
  });
  if (result.artifact.kind !== "temporary") assert.fail("Expected temporary artifact");
  await service.releaseTemporary(result.artifact);
  await service.releaseTemporary(result.artifact);
  assert.deepEqual(released, ["opaque-token", "opaque-token"]);
});

test("Desktop Adapter returns preview cache file URLs without inline image bytes", async () => {
  const released: string[] = [];
  const bridge: DesktopNativeBridge = {
    randomUUID: () => "preview-cache-request",
    convertFileSrc: (path, protocol) => `${protocol}://localhost/${path}`,
    async listen() {
      return () => undefined;
    },
    async invoke<T>(command: string, args?: unknown) {
      if (command === "image_processing_release_preview_cache") {
        released.push((args as { token: string }).token);
        return undefined as T;
      }
      const request = decodeRequest(args);
      assert.equal(request.metadata.destination, "cache");
      return response({
        width: 320,
        height: 180,
        implementation: "test-native",
        cache: {
          token: "preview-token",
          mimeType: "image/webp",
          sizeBytes: 321,
        },
      }) as T;
    },
  };
  const service = new DesktopImageProcessingService(bridge);
  const result = await service.renderPreview({
    source: source(),
    document: { version: 1, operations: [] },
    maxWidth: 320,
    maxHeight: 180,
    mimeType: "image/webp",
    quality: 0.8,
    destination: "cache",
  });

  assert.deepEqual(result.artifact, {
    kind: "cache",
    id: "preview-token",
    url: "picbind-preview://localhost/preview-token",
    mimeType: "image/webp",
    sizeBytes: 321,
    engine: "desktop-native",
  });
  if (result.artifact.kind !== "cache") assert.fail("Expected preview cache artifact");
  await service.releasePreviewCache(result.artifact);
  assert.deepEqual(released, ["preview-token"]);
});

test("Desktop Adapter maps AbortSignal to the matching Native cancellation task", async () => {
  let rejectExecution: ((reason: string) => void) | undefined;
  let started!: () => void;
  const executionStarted = new Promise<void>((resolve) => { started = resolve; });
  const bridge: DesktopNativeBridge = {
    randomUUID: () => "unused",
    async listen() {
      return () => undefined;
    },
    invoke<T>(command: string, args?: unknown) {
      if (command === "image_processing_cancel") {
        assert.deepEqual(args, { requestId: "cancel-request" });
        rejectExecution?.(JSON.stringify({ code: "cancelled", message: "cancelled" }));
        return Promise.resolve(true as T);
      }
      started();
      return new Promise<T>((_resolve, reject) => { rejectExecution = reject; });
    },
  };
  const service = new DesktopImageProcessingService(bridge);
  const controller = new AbortController();
  const pending = service.inspect(source(), {
    requestId: "cancel-request",
    signal: controller.signal,
  });
  await executionStarted;
  controller.abort();

  await assert.rejects(
    pending,
    (error) => error instanceof ImageProcessingError && error.code === "cancelled",
  );
});

test("Desktop Adapter exposes stable Native error codes", async () => {
  const bridge: DesktopNativeBridge = {
    randomUUID: () => "error-request",
    async listen() {
      return () => undefined;
    },
    async invoke() {
      throw JSON.stringify({ code: "alphaLossDenied", message: "alpha is protected" });
    },
  };
  const service = new DesktopImageProcessingService(bridge);
  await assert.rejects(
    service.convert({
      source: source(),
      format: "jpeg",
      destination: "memory",
    }),
    (error) => error instanceof ImageProcessingError && error.code === "alphaLossForbidden",
  );
});

test("Desktop Adapter sends a collaboration Blob once and then uses its Native memory key", async () => {
  const requests: ReturnType<typeof decodeRequest>[] = [];
  const released: string[] = [];
  const bridge: DesktopNativeBridge = {
    randomUUID: () => `memory-${requests.length}`,
    async listen() {
      return () => undefined;
    },
    async invoke<T>(command: string, args?: unknown) {
      if (command === "image_processing_release_memory_source") {
        released.push((args as { cacheKey: string }).cacheKey);
        return true as T;
      }
      const request = decodeRequest(args);
      requests.push(request);
      return response({ width: 2, height: 1, implementation: "test-native" }, new Uint8Array([1])) as T;
    },
  };
  const service = new DesktopImageProcessingService(bridge);
  const request = {
    source: cachedSource(),
    document: { version: 1 as const, operations: [] },
    maxWidth: 100,
    maxHeight: 100,
    mimeType: "image/webp" as const,
    quality: 0.8,
  };

  await service.renderPreview(request);
  await service.renderPreview(request);
  assert.deepEqual(requests.map((value) => value.metadata.source), [
    { kind: "inline", cacheKey: "workspace:image:1" },
    { kind: "memory", cacheKey: "workspace:image:1" },
  ]);
  assert.deepEqual(requests.map((value) => value.metadata.inlineLength), [4, 0]);
  await service.releaseMemorySource("workspace:image:1");
  assert.deepEqual(released, ["workspace:image:1"]);
});
