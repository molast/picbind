"use client";

import { getDatabaseClient } from "../client";
import type { SqlValue } from "../types/client";
import type { RoomEventItem, RoomEventKind } from "../../utils/room-event";

type OperationLogRow = Record<string, SqlValue> & {
  id: string;
  kind: RoomEventKind;
  title: string;
  detail: string | null;
  progress: number | null;
  created_at: number;
};

export async function listOperationLogs(roomId: string) {
  const database = await getDatabaseClient();
  const rows = await database.query<OperationLogRow>(
    `SELECT id, kind, title, detail, progress, created_at
     FROM room_operation_logs
     WHERE room_id = ?
     ORDER BY created_at ASC
     LIMIT 500`,
    [roomId],
  );
  return rows.map((row): RoomEventItem => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail ?? undefined,
    progress: row.progress === null ? undefined : Number(row.progress),
    createdAt: Number(row.created_at),
  }));
}

export async function upsertOperationLog(roomId: string, item: RoomEventItem) {
  const database = await getDatabaseClient();
  await database.transaction([
    {
      sql: `INSERT INTO room_operation_logs (
              room_id, id, kind, title, detail, progress, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(room_id, id) DO UPDATE SET
              kind = excluded.kind,
              title = excluded.title,
              detail = excluded.detail,
              progress = excluded.progress,
              created_at = excluded.created_at`,
      bind: [
        roomId,
        item.id,
        item.kind,
        item.title,
        item.detail ?? null,
        item.progress ?? null,
        item.createdAt,
      ],
    },
    {
      sql: `DELETE FROM room_operation_logs
            WHERE room_id = ? AND id NOT IN (
              SELECT id FROM room_operation_logs
              WHERE room_id = ?
              ORDER BY created_at DESC
              LIMIT 500
            )`,
      bind: [roomId, roomId],
    },
  ]);
}

export async function clearOperationLogs(roomId: string) {
  const database = await getDatabaseClient();
  await database.execute("DELETE FROM room_operation_logs WHERE room_id = ?", [roomId]);
}
