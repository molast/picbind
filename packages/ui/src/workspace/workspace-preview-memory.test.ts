import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import { initSync } from "@picbind/image-wasm";
import { emptyImageParameterDocument, type ImageParameterDocument } from "./image-protocol";
import { createWorkspacePreviewMemory } from "./workspace-preview-memory";

class TestCanvas {
  width = 4;
  height = 2;
  pixels = new Uint8ClampedArray(32).fill(127);
  clipCalls = 0;
  fillCalls = 0;

  getContext() {
    return {
      drawImage: (source: TestCanvas) => { this.pixels = new Uint8ClampedArray(source.pixels); },
      getImageData: () => ({ data: this.pixels, width: this.width, height: this.height }),
      putImageData: (pixels: ImageData) => { this.pixels = new Uint8ClampedArray(pixels.data); },
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      closePath: () => undefined,
      clip: () => { this.clipCalls += 1; },
      fillRect: () => { this.fillCalls += 1; },
      ellipse: () => undefined,
    };
  }

  toBlob() { throw new Error("Shared pixels must not be encoded"); }
  toDataURL() { throw new Error("Shared pixels must not be encoded"); }
}

function surface(width = 4, height = 2) {
  const canvas = new TestCanvas();
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as HTMLCanvasElement;
}

function stubGlobal(t: TestContext, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else Reflect.deleteProperty(globalThis, key);
  });
}

function resizeDocument(width: number, height = 2): ImageParameterDocument {
  return {
    version: 1,
    operations: [{ id: `resize-${width}`, userId: "owner", time: width, type: "resize", params: { width, height } }],
  };
}

function fixture(t: TestContext) {
  const canvases: HTMLCanvasElement[] = [];
  stubGlobal(t, "document", {
    createElement: () => {
      const canvas = surface();
      canvases.push(canvas);
      return canvas;
    },
  });
  let decodes = 0;
  let decodedDisposals = 0;
  const renders: Array<{ original: HTMLCanvasElement; document: ImageParameterDocument }> = [];
  const runtime = {
    async decode() {
      decodes += 1;
      return { source: surface(), width: 4, height: 2, dispose: () => { decodedDisposals += 1; } };
    },
    async render(original: HTMLCanvasElement, document: ImageParameterDocument) {
      renders.push({ original, document });
      const operation = document.operations[0];
      return operation ? surface(Number(operation.params.width), Number(operation.params.height)) : original;
    },
  };
  return { runtime, renders, canvases, counts: () => ({ decodes, decodedDisposals }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("decodes once and reuses editor and applied surfaces without encoding", async (t) => {
  const { runtime, renders, counts } = fixture(t);
  const empty = emptyImageParameterDocument();
  const memory = await createWorkspacePreviewMemory("image", new Blob(["source"]), empty, runtime);
  const document = resizeDocument(3);
  const editorSurface = await memory.surfaceFor(document);
  assert.equal(await memory.surfaceFor(document), editorSurface);
  await memory.apply(document);
  assert.equal(memory.surface, editorSurface);
  assert.deepEqual([memory.width, memory.height, memory.revision], [3, 2, 1]);
  await memory.apply(document);
  assert.equal(memory.revision, 1);
  assert.deepEqual(counts(), { decodes: 1, decodedDisposals: 1 });
  assert.equal(renders.length, 2);
  assert.ok(renders.every((render) => render.original === memory.originalSurface));
  await memory.apply(empty);
  assert.equal(memory.surface, memory.originalSurface);
  assert.deepEqual([memory.width, memory.height], [4, 2]);
  memory.dispose();
});

test("direct pixel operations use the shared surface and maintain undo/redo history", async (t) => {
  const { runtime } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  await memory.applyDirect({ type: "resize", params: { width: 7, height: 3 } });
  assert.deepEqual([memory.width, memory.height], [7, 3]);
  assert.equal(memory.canUndo, true);
  assert.equal(memory.canRedo, false);
  assert.equal(memory.hasDirectChanges, true);
  memory.undo();
  assert.deepEqual([memory.width, memory.height], [4, 2]);
  assert.equal(memory.canUndo, false);
  assert.equal(memory.canRedo, true);
  assert.equal(memory.hasDirectChanges, false);
  memory.redo();
  assert.deepEqual([memory.width, memory.height], [7, 3]);
  memory.dispose();
});

test("background fill uses the shared surface and is undoable", async (t) => {
  const { runtime, canvases } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  await memory.applyDirect({ type: "fillBackground", params: { color: { r: 255, g: 255, b: 255, a: 255 } } });
  assert.equal((canvases[1] as unknown as TestCanvas | undefined)?.fillCalls, 1);
  assert.equal(memory.directOperations[0]?.type, "fillBackground");
  memory.undo();
  assert.equal(memory.canRedo, true);
  memory.dispose();
});

test("path crop uses the transformed outline bounds and applies a mask", async (t) => {
  const { runtime, canvases } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  await memory.applyDirect({
    type: "crop",
    params: {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
      shape: "rectangle",
      path: [
        { x: 0.1, y: 0.25 },
        { x: 0.9, y: 0.1 },
        { x: 0.8, y: 0.9 },
        { x: 0.2, y: 0.8 },
      ],
      masked: true,
    },
  });
  assert.deepEqual([memory.width, memory.height], [4, 2]);
  assert.equal((canvases[1] as unknown as TestCanvas | undefined)?.clipCalls, 1);
  assert.equal(memory.directOperations[0]?.type, "crop");
  memory.dispose();
});

test("deduplicates concurrent rendering of the same parameter document", async (t) => {
  const { runtime, renders } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  const pending = deferred<HTMLCanvasElement>();
  let requests = 0;
  runtime.render = async () => { requests += 1; return pending.promise; };
  const document = resizeDocument(3);
  const first = memory.surfaceFor(document);
  const second = memory.surfaceFor(document);
  pending.resolve(surface(3));
  assert.equal(await first, await second);
  assert.equal(requests, 1);
  assert.equal(renders.length, 1);
  memory.dispose();
});

test("the latest Apply wins when an earlier render finishes later", async (t) => {
  const { runtime } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  const first = deferred<HTMLCanvasElement>();
  const second = deferred<HTMLCanvasElement>();
  runtime.render = async (_original, document) => document.operations[0]?.params.width === 3 ? first.promise : second.promise;
  const staleApply = memory.apply(resizeDocument(3));
  const latestDocument = resizeDocument(2);
  const latestApply = memory.apply(latestDocument);
  second.resolve(surface(2));
  await latestApply;
  first.resolve(surface(3));
  await staleApply;
  assert.equal(memory.document, latestDocument);
  assert.equal(memory.width, 2);
  assert.equal(memory.revision, 1);
  memory.dispose();
});

test("eviction and Apply do not resize surfaces still held by an open editor", async (t) => {
  const { runtime } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  const editorSurface = await memory.surfaceFor(resizeDocument(3));
  for (let width = 5; width < 10; width += 1) await memory.apply(resizeDocument(width));
  assert.deepEqual([editorSurface.width, editorSurface.height], [3, 2]);
  assert.deepEqual([memory.originalSurface.width, memory.originalSurface.height], [4, 2]);
  memory.dispose();
});

test("dispose is idempotent and rejects pending pixel renders", async (t) => {
  const { runtime } = fixture(t);
  const memory = await createWorkspacePreviewMemory("image", new Blob(), emptyImageParameterDocument(), runtime);
  const pending = deferred<HTMLCanvasElement>();
  runtime.render = async () => pending.promise;
  const rendering = memory.apply(resizeDocument(3));
  const rejected = assert.rejects(rendering, /disposed/);
  const rendered = surface(3);
  memory.dispose();
  memory.dispose();
  pending.resolve(rendered);
  await rejected;
  assert.deepEqual([rendered.width, rendered.height], [1, 1]);
  assert.deepEqual([memory.originalSurface.width, memory.originalSurface.height], [1, 1]);
  await assert.rejects(memory.surfaceFor(emptyImageParameterDocument()), /disposed/);
});

test("failed initial rendering releases both the decoded bitmap and original canvas", async (t) => {
  const { runtime, canvases, counts } = fixture(t);
  runtime.render = async () => { throw new Error("render failed"); };
  await assert.rejects(createWorkspacePreviewMemory("image", new Blob(), resizeDocument(3), runtime), /render failed/);
  assert.deepEqual(counts(), { decodes: 1, decodedDisposals: 1 });
  assert.deepEqual([canvases[0]!.width, canvases[0]!.height], [1, 1]);
});

test("the production decoder and WASM pixel renderer apply directly from immutable RGBA", async (t) => {
  fixture(t);
  stubGlobal(t, "ImageData", class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  let decodes = 0;
  let closed = 0;
  stubGlobal(t, "createImageBitmap", async () => {
    decodes += 1;
    return Object.assign(surface(), { close: () => { closed += 1; } });
  });
  initSync({ module: await readFile(new URL("../../../wasm/image-wasm/image_wasm_bg.wasm", import.meta.url)) });
  const empty = emptyImageParameterDocument();
  const memory = await createWorkspacePreviewMemory("image", new Blob(), empty);
  const originalPixels = (memory.originalSurface as unknown as TestCanvas).pixels.slice();
  const document = resizeDocument(3);
  const editorBase = await memory.surfaceFor(document);
  await memory.apply(document);
  assert.equal(memory.surface, editorBase);
  assert.deepEqual([memory.width, memory.height], [3, 2]);
  await memory.apply(resizeDocument(2, 1));
  assert.deepEqual([memory.width, memory.height], [2, 1]);
  assert.deepEqual((memory.originalSurface as unknown as TestCanvas).pixels, originalPixels);
  assert.equal(decodes, 1);
  assert.equal(closed, 1);
  await memory.apply(empty);
  assert.equal(memory.surface, memory.originalSurface);
  memory.dispose();
});
