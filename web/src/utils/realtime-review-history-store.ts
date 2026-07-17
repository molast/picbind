"use client";

import type { ReviewOperation } from "./review-collaboration";

const DB_NAME = "picbind-review-history";
const DB_VERSION = 1;
const STORE_NAME = "histories";

type StoredReviewHistory = {
  key: string;
  roomId: string;
  imageId: string;
  operations: ReviewOperation[];
  cursor: number;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function historyKey(roomId: string, imageId: string) {
  return `${roomId}:${imageId}`;
}

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
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Review history database failed to open"));
    });
  }
  return dbPromise;
}

export async function loadReviewHistory(roomId: string, imageId: string) {
  const db = await openDatabase();
  return new Promise<Pick<StoredReviewHistory, "operations" | "cursor"> | null>(
    (resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction
        .objectStore(STORE_NAME)
        .get(historyKey(roomId, imageId));
      request.onsuccess = () => {
        const value = request.result as StoredReviewHistory | undefined;
        if (!value || !Array.isArray(value.operations)) {
          resolve(null);
          return;
        }
        resolve({
          operations: value.operations,
          cursor: Number.isInteger(value.cursor)
            ? Math.max(0, Math.min(value.operations.length, value.cursor))
            : value.operations.length,
        });
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Review history read failed"));
    },
  );
}

export async function saveReviewHistory(
  roomId: string,
  imageId: string,
  operations: ReviewOperation[],
  cursor: number,
) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key: historyKey(roomId, imageId),
      roomId,
      imageId,
      operations,
      cursor: Math.max(0, Math.min(operations.length, cursor)),
      updatedAt: Date.now(),
    } satisfies StoredReviewHistory);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Review history write failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Review history write aborted"));
  });
}
