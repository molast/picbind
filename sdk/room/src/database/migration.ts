/// <reference path="./types/sql.d.ts" />

import initialSchema from "./migrations/001_init.sql?raw";
import imageWorkspaceSchema from "./migrations/002_image_workspace.sql?raw";
import imageWorkspaceLocationSchema from "./migrations/003_image_workspace_location.sql?raw";
import imageOutboxOriginSchema from "./migrations/004_image_outbox_origin.sql?raw";
import imageUpdatedAtSchema from "./migrations/005_image_updated_at.sql?raw";
import operationLogsSchema from "./migrations/006_room_operation_logs.sql?raw";
import imagePinnedAtSchema from "./migrations/007_image_pinned_at.sql?raw";
import imageInterestSchema from "./migrations/008_image_interest.sql?raw";
import { DATABASE_SCHEMA_VERSION } from "./schema";
import type { DatabaseClient } from "./client";

const migrations = [
  { version: 1, sql: initialSchema },
  { version: 2, sql: imageWorkspaceSchema },
  { version: 3, sql: imageWorkspaceLocationSchema },
  { version: 4, sql: imageOutboxOriginSchema },
  { version: 5, sql: imageUpdatedAtSchema },
  { version: 6, sql: operationLogsSchema },
  { version: 7, sql: imagePinnedAtSchema },
  { version: 8, sql: imageInterestSchema },
] as const;

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
