import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import Dexie from "dexie";
import { getDatabase, PicbindDatabase } from "../database";
import { webImageStorageRepository as repository } from "./web-image-storage-repository";

class MemoryFileHandle {
  constructor(
    private readonly name: string,
    private readonly files: Map<string, Blob>,
  ) {}

  async createWritable() {
    let pending: Blob | null = null;
    return {
      write: async (value: Blob) => {
        pending = value;
      },
      close: async () => {
        if (pending) this.files.set(this.name, pending);
      },
      abort: async () => {
        pending = null;
      },
    };
  }

  async getFile() {
    const blob = this.files.get(this.name);
    if (!blob) throw new DOMException("File not found", "NotFoundError");
    return new File([blob], this.name, { type: blob.type });
  }
}

class MemoryDirectoryHandle {
  private readonly directories = new Map<string, MemoryDirectoryHandle>();
  private readonly files = new Map<string, Blob>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException("Directory not found", "NotFoundError");
    const directory = new MemoryDirectoryHandle();
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!options?.create && !this.files.has(name)) {
      throw new DOMException("File not found", "NotFoundError");
    }
    return new MemoryFileHandle(name, this.files);
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) {
      throw new DOMException("File not found", "NotFoundError");
    }
  }
}

before(() => {
  const root = new MemoryDirectoryHandle();
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => root },
  });
});

beforeEach(async () => {
  const database = getDatabase();
  await Promise.all([
    database.compressedImages.clear(),
    database.queuedFiles.clear(),
    database.workspaceImages.clear(),
    database.workspaceMessagingImages.clear(),
  ]);
});

test("compressed images satisfy metadata and lazy-content operations", async () => {
  const blob = new Blob(["compressed"], { type: "image/webp" });
  await repository.put({
    scope: "compressed",
    id: "compressed-1",
    metadata: {
      id: "compressed-1",
      sourceId: "source-1",
      sourceName: "source.png",
      sourceSize: 20,
      name: "result.webp",
      type: "image/webp",
      format: "webp",
      size: blob.size,
      createdAt: 10,
    },
    mimeType: blob.type,
    data: blob,
    createdAt: 10,
  });

  const page = await repository.list("compressed", "", 10, 0);
  assert.equal(page.length, 1);
  assert.equal(page[0].id, "compressed-1");
  assert.equal(page[0].byteSize, blob.size);
  assert.equal(
    await (await repository.read(
      "compressed",
      "",
      "compressed-1",
      "output",
      blob.type,
    ))?.text(),
    "compressed",
  );

  await repository.delete("compressed", "", "compressed-1");
  assert.equal(await repository.get("compressed", "", "compressed-1"), null);
});

test("workspace metadata is sorted before offset pagination", async () => {
  for (const updatedAt of [10, 30, 20]) {
    await repository.put({
      scope: "workspace",
      scopeKey: "workspace-1",
      id: `image-${updatedAt}`,
      metadata: {
        id: `image-${updatedAt}`,
        workspaceId: "workspace-1",
        name: `image-${updatedAt}.png`,
        type: "image/png",
        size: 1,
        direction: "sent",
        width: 1,
        height: 1,
        createdAt: updatedAt,
        updatedAt,
      },
      mimeType: "image/png",
      data: new Blob([String(updatedAt)], { type: "image/png" }),
      createdAt: updatedAt,
    });
  }

  const firstPage = await repository.list("workspace", "workspace-1", 2, 0);
  const secondPage = await repository.list("workspace", "workspace-1", 2, 2);
  assert.deepEqual(firstPage.map((record) => record.id), ["image-30", "image-20"]);
  assert.deepEqual(secondPage.map((record) => record.id), ["image-10"]);
});

test("workspace overwrite replaces existing source and thumbnail bytes", async () => {
  const identity = {
    scope: "workspace" as const,
    scopeKey: "workspace",
    id: "image",
  };
  await repository.put({
    ...identity,
    metadata: { id: "image", workspaceId: "workspace", name: "image.png", type: "image/png",
      size: 6, direction: "sent", width: 4, height: 4, createdAt: 1, updatedAt: 1 },
    mimeType: "image/png",
    data: new Blob(["source"], { type: "image/png" }),
    thumbnail: new Blob(["preview"], { type: "image/webp" }),
    thumbnailMimeType: "image/webp",
    createdAt: 1,
  });

  await repository.put({
    ...identity,
    metadata: { id: "image", workspaceId: "workspace", name: "image.png", type: "image/png",
      size: 7, direction: "sent", width: 2, height: 2, createdAt: 1, updatedAt: 2 },
    mimeType: "image/png",
    data: new Blob(["updated"], { type: "image/png" }),
    thumbnail: new Blob(["latest"], { type: "image/webp" }),
    thumbnailMimeType: "image/webp",
    createdAt: 1,
  });

  assert.equal(
    await (await repository.read("workspace", "workspace", "image", "original", "image/png"))?.text(),
    "updated",
  );
  assert.equal(
    await (await repository.read("workspace", "workspace", "image", "thumbnail", "image/webp"))?.text(),
    "latest",
  );
});

test("content reads honor an already-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    repository.read(
      "compressed",
      "",
      "missing",
      "output",
      "image/webp",
      controller.signal,
    ),
    { name: "AbortError" },
  );
});

test("workspace variants can expire independently without deleting metadata", async () => {
  await repository.put({
    scope: "workspace",
    scopeKey: "workspace",
    id: "image",
    metadata: { id: "image", workspaceId: "workspace", name: "image.png", type: "image/png",
      size: 6, direction: "received", width: 1, height: 1, createdAt: 1, updatedAt: 1 },
    mimeType: "image/png",
    data: new Blob(["source"], { type: "image/png" }),
    thumbnail: new Blob(["preview"], { type: "image/webp" }),
    thumbnailMimeType: "image/webp",
    createdAt: 1,
  });

  await repository.deleteVariant("workspace", "workspace", "image", "thumbnail");
  assert.equal(await repository.read("workspace", "workspace", "image", "thumbnail", "image/webp"), null);
  assert.equal(await (await repository.read("workspace", "workspace", "image", "original", "image/png"))?.text(), "source");

  await repository.deleteVariant("workspace", "workspace", "image", "original");
  assert.equal(await repository.read("workspace", "workspace", "image", "original", "image/png"), null);
  assert.ok(await repository.get("workspace", "workspace", "image"));
});

test("legacy records migrate to Workspace tables", async () => {
  const name = `picbind-workspace-migration-${Date.now()}-${Math.random()}`;
  const legacy = new Dexie(name);
  legacy.version(5).stores({
    compressedImages: "id, sourceId, createdAt",
    queuedFiles: "id, createdAt",
    roomImages: "[roomId+id], roomId, id, [roomId+updatedAt], updatedAt",
    reviewHistories: "[roomId+imageId], roomId, imageId, updatedAt",
    operationLogs: "[roomId+id], roomId, [roomId+createdAt], createdAt",
    messagingImages:
      "[roomId+providerId+messageId], roomId, providerId, messageId, [roomId+createdAt], createdAt",
    imageDeliveries:
      "[roomId+id], roomId, imageId, recipientId, [roomId+imageId], [roomId+recipientId], updatedAt",
  });
  await legacy.table("roomImages").put({
    roomId: "workspace-1",
    id: "image-1",
    name: "legacy.png",
    type: "image/png",
    size: 0,
    direction: "sent",
    width: 1,
    height: 1,
    createdAt: 1,
    updatedAt: 1,
    filePath: null,
    thumbnailPath: null,
  });
  legacy.close();

  const migrated = new PicbindDatabase(name);
  await migrated.open();
  const record = await migrated.workspaceImages.get(["workspace-1", "image-1"]);
  assert.equal(record?.workspaceId, "workspace-1");
  assert.equal(record?.name, "legacy.png");
  assert.equal(migrated.tables.some((table) => table.name === "roomImages"), false);
  assert.equal(
    migrated.tables.some((table) => table.name === "workspaceImageDeliveries"),
    false,
  );
  migrated.close();
  await Dexie.delete(name);
});
