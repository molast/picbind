"use client";

const DB_NAME = "picbind-image-queue";
const DB_VERSION = 1;
const STORE_NAME = "files";

type StoredImageFile = {
  id: string;
  file: File;
  createdAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openImageQueueDb() {
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
        reject(request.error ?? new Error("IndexedDB open failed"));
    });
  }

  return dbPromise;
}

async function runFileStoreTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
) {
  const db = await openImageQueueDb();

  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = action(store);
    let result: T | undefined;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB request failed"));
    }

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function storeQueuedImageFile(id: string, file: File) {
  await runFileStoreTransaction("readwrite", (store) =>
    store.put({ id, file, createdAt: Date.now() } satisfies StoredImageFile),
  );
}

export async function getQueuedImageFile(id: string) {
  const entry = await runFileStoreTransaction<StoredImageFile | undefined>(
    "readonly",
    (store) => store.get(id) as IDBRequest<StoredImageFile | undefined>,
  );
  return entry?.file ?? null;
}

export async function deleteQueuedImageFile(id: string) {
  await runFileStoreTransaction("readwrite", (store) => store.delete(id));
}
