"use client";

const DB_NAME = "picbind-compressed-images";
const DB_VERSION = 1;
const STORE_NAME = "images";

export type CachedCompressedImage = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceSize: number;
  name: string;
  type: string;
  format: string;
  size: number;
  blob: Blob;
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
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Compressed image cache open failed"));
    });
  }
  return dbPromise;
}

export async function storeCompressedImage(image: CachedCompressedImage) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(image);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Compressed image cache write failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Compressed image cache write aborted"));
  });
}

export async function listCompressedImages() {
  const db = await openDatabase();
  return new Promise<CachedCompressedImage[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      resolve(
        (request.result as CachedCompressedImage[]).sort(
          (left, right) => right.createdAt - left.createdAt,
        ),
      );
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Compressed image cache read failed"));
  });
}
