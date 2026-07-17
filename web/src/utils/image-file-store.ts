"use client";

const DB_NAME = "picbind-image-queue";
const DB_VERSION = 1;
const STORE_NAME = "files";
const COMPRESSION_HANDOFF_KEY = "picbind:compression-handoff";
export const COMPRESSION_HANDOFF_EVENT = "picbind:compression-handoff-ready";

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

export async function queueFilesForCompression(files: File[]) {
  const entries = files.map((file) => ({
    id: `handoff-${crypto.randomUUID()}`,
    file,
  }));
  await Promise.all(entries.map(({ id, file }) => storeQueuedImageFile(id, file)));
  localStorage.setItem(
    COMPRESSION_HANDOFF_KEY,
    JSON.stringify(entries.map(({ id }) => id)),
  );
  window.dispatchEvent(new Event(COMPRESSION_HANDOFF_EVENT));
}

export async function consumeFilesForCompression() {
  const raw = localStorage.getItem(COMPRESSION_HANDOFF_KEY);
  localStorage.removeItem(COMPRESSION_HANDOFF_KEY);
  if (!raw) return [];
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      ids = parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    return [];
  }
  const files = await Promise.all(ids.map((id) => getQueuedImageFile(id)));
  await Promise.all(ids.map((id) => deleteQueuedImageFile(id)));
  return files.filter((file): file is File => file instanceof File);
}
