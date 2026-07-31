"use client";

import { runMigrations } from "./migration";
import type {
  DatabaseWorkerRequest,
  DatabaseWorkerRequestInput,
  DatabaseWorkerResponse,
  SqlStatement,
  SqlValue,
} from "./types/client";

type PendingRequest = {
  resolve(rows: Array<Record<string, SqlValue>>): void;
  reject(error: Error): void;
};

export class DatabaseClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private sequence = 0;

  private constructor() {
    this.worker = new Worker(new URL("./sqlite.worker.ts", import.meta.url), {
      type: "module",
      name: "picbind-sqlite",
    });
    this.worker.addEventListener(
      "message",
      (event: MessageEvent<DatabaseWorkerResponse>) => {
        const response = event.data;
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        if (response.ok) pending.resolve(response.rows);
        else pending.reject(new Error(response.error));
      },
    );
    this.worker.addEventListener("error", (event) => {
      const error = new Error(event.message || "Local database worker failed");
      this.pending.forEach((request) => request.reject(error));
      this.pending.clear();
    });
  }

  static async create() {
    if (typeof window === "undefined") {
      throw new Error("Local database is only available in the browser");
    }
    const client = new DatabaseClient();
    await client.request({ type: "open" });
    await runMigrations(client);
    return client;
  }

  query<T extends Record<string, SqlValue>>(sql: string, bind?: SqlValue[]) {
    return this.request({ type: "execute", statement: { sql, bind } }) as Promise<T[]>;
  }

  async execute(sql: string, bind?: SqlValue[]) {
    await this.request({ type: "execute", statement: { sql, bind } });
  }

  async transaction(statements: SqlStatement[]) {
    if (!statements.length) return;
    await this.request({ type: "transaction", statements });
  }

  private request(
    request: DatabaseWorkerRequestInput,
  ): Promise<Array<Record<string, SqlValue>>> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } satisfies DatabaseWorkerRequest);
    });
  }
}

let clientPromise: Promise<DatabaseClient> | null = null;

export function getDatabaseClient() {
  if (!clientPromise) {
    clientPromise = DatabaseClient.create().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}
