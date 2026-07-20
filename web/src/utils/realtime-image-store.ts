"use client";

import type { ImagePlaceholderMetadata } from "./share-placeholder";

const DB_NAME = "picbind-realtime-images";
const DB_VERSION = 1;
const STORE_NAME = "images";
const ROOM_INDEX = "roomId";

export type CachedRoomImage = {
  id: string;
  roomId: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  direction: "sent" | "received";
  transferStatus?:
    | "waiting"
    | "sending"
    | "awaiting-receipt"
    | "receiving"
    | "sent"
    | "received"
    | "cancelled"
    | "failed";
  progress?: number;
  transferMode?: "p2p" | "r2";
  previewOnly?: boolean;
  placeholderOnly?: boolean;
  placeholder?: ImagePlaceholderMetadata;
  thumbnail?: Blob;
  reviewStatus?: "in-review" | "approved";
  reviewAnchorCount?: number;
  createdAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex(ROOM_INDEX, "roomId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB open failed"));
    });
  }

  return dbPromise;
}

export async function storeRoomImage(image: CachedRoomImage) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(image);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Image cache write failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Image cache write aborted"));
  });
}

export async function listRoomImages(roomId: string) {
  const db = await openDatabase();
  return new Promise<CachedRoomImage[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction
      .objectStore(STORE_NAME)
      .index(ROOM_INDEX)
      .getAll(IDBKeyRange.only(roomId));
    request.onsuccess = () => {
      resolve(
        (request.result as CachedRoomImage[]).sort(
          (left, right) => left.createdAt - right.createdAt,
        ),
      );
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Image cache read failed"));
  });
}

export async function deleteRoomImage(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Image cache delete failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Image cache delete aborted"));
  });
}
