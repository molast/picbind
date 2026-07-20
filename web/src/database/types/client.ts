export type SqlValue =
  | string
  | number
  | null
  | bigint
  | Uint8Array
  | Int8Array
  | ArrayBuffer;

export type SqlStatement = {
  sql: string;
  bind?: SqlValue[];
};

export type DatabaseWorkerRequest =
  | { id: number; type: "open" }
  | { id: number; type: "execute"; statement: SqlStatement }
  | { id: number; type: "transaction"; statements: SqlStatement[] };

export type DatabaseWorkerRequestInput =
  | { type: "open" }
  | { type: "execute"; statement: SqlStatement }
  | { type: "transaction"; statements: SqlStatement[] };

export type DatabaseWorkerResponse =
  | { id: number; ok: true; rows: Array<Record<string, SqlValue>> }
  | { id: number; ok: false; error: string };
