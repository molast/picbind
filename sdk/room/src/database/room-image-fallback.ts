"use client";

import type { CachedRoomImage } from "./types/storage";

const DATABASE_NAME = "picbind-room-image-fallback";
const DATABASE_VERSION = 1;
const STORE_NAME = "room-images";
const ROOM_INDEX = "room-id";

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
  });
}

function openFallbackDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex(ROOM_INDEX, "roomId", { unique: false });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () =>
        reject(request.error ?? new Error("IndexedDB fallback failed to open")),
      );
      request.addEventListener("blocked", () =>
        reject(new Error("IndexedDB fallback upgrade was blocked")),
      );
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function storeFallbackRoomImage(image: CachedRoomImage) {
  const database = await openFallbackDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  await requestResult(transaction.objectStore(STORE_NAME).put(image));
}

export async function listFallbackRoomImages(roomId: string) {
  const database = await openFallbackDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  return requestResult(
    transaction.objectStore(STORE_NAME).index(ROOM_INDEX).getAll(roomId),
  ) as Promise<CachedRoomImage[]>;
}

export async function deleteFallbackRoomImage(id: string) {
  const database = await openFallbackDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  await requestResult(transaction.objectStore(STORE_NAME).delete(id));
}
