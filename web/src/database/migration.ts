import initialSchema from "./migrations/001_init.sql";
import { DATABASE_SCHEMA_VERSION } from "./schema";
import type { DatabaseClient } from "./client";

const migrations = [{ version: 1, sql: initialSchema }] as const;

export async function runMigrations(client: DatabaseClient) {
  const [row] = await client.query<{ user_version: number }>(
    "PRAGMA user_version",
  );
  let currentVersion = Number(row?.user_version || 0);

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    await client.transaction([
      { sql: migration.sql },
      { sql: `PRAGMA user_version = ${migration.version}` },
    ]);
    currentVersion = migration.version;
  }

  if (currentVersion !== DATABASE_SCHEMA_VERSION) {
    throw new Error(`Unsupported local database version: ${currentVersion}`);
  }

}
