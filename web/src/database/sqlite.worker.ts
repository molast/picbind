import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { DATABASE_FILE } from "./schema";
import type {
  DatabaseWorkerRequest,
  DatabaseWorkerResponse,
  SqlStatement,
} from "./types/client";

let databasePromise: Promise<Database> | null = null;

/**
 * Webpack turns sqlite-wasm's nested OPFS workers into emitted worker chunks.
 * In that transformation the runtime `?vfs=...` query can be dropped, while
 * sqlite3-opfs-async-proxy.js requires it to decide which VFS to install.
 */
function preserveOpfsProxyWorkerVfs() {
  const NativeWorker = globalThis.Worker;
  let proxyWorkerIndex = 0;

  class OpfsCompatibleWorker extends NativeWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      let resolvedURL: string | URL = scriptURL;
      try {
        const url = new URL(scriptURL.toString(), globalThis.location.href);
        const filename = url.pathname.split("/").pop() ?? "";
        if (
          filename.startsWith("sqlite3-opfs-async-proxy") &&
          filename.endsWith(".js") &&
          !url.searchParams.has("vfs")
        ) {
          url.searchParams.set(
            "vfs",
            proxyWorkerIndex++ === 0 ? "opfs" : "opfs-wl",
          );
          resolvedURL = url;
        }
      } catch {
        // Let the native Worker constructor report an invalid URL unchanged.
      }
      super(resolvedURL, options);
    }
  }

  globalThis.Worker = OpfsCompatibleWorker;
  return () => {
    globalThis.Worker = NativeWorker;
  };
}

function openDatabase() {
  if (!databasePromise) {
    const restoreWorker = preserveOpfsProxyWorkerVfs();
    databasePromise = sqlite3InitModule()
      .then((sqlite3) => {
        if (!crossOriginIsolated || !("opfs" in sqlite3)) {
          throw new Error(
            "SQLite OPFS requires cross-origin isolation and OPFS support",
          );
        }
        const database = new sqlite3.oo1.OpfsDb(DATABASE_FILE, "c");
        database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
        return database;
      })
      .finally(restoreWorker);
  }
  return databasePromise;
}

function executeStatement(database: Database, statement: SqlStatement) {
  return database.exec({
    sql: statement.sql,
    bind: statement.bind,
    rowMode: "object",
    returnValue: "resultRows",
  });
}

async function handleRequest(request: DatabaseWorkerRequest) {
  const database = await openDatabase();
  if (request.type === "open") return [];
  if (request.type === "execute") {
    return executeStatement(database, request.statement);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of request.statements) {
      executeStatement(database, statement);
    }
    database.exec("COMMIT");
    return [];
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

self.addEventListener("message", (event: MessageEvent<DatabaseWorkerRequest>) => {
  const request = event.data;
  void handleRequest(request)
    .then((rows) => {
      self.postMessage({ id: request.id, ok: true, rows } satisfies DatabaseWorkerResponse);
    })
    .catch((error: unknown) => {
      self.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : "Local database failed",
      } satisfies DatabaseWorkerResponse);
    });
});
