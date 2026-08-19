"use client";

import { getDatabase } from "../database";
import type { RoomEventItem } from "../../utils/room-event";

const MAX_OPERATION_LOGS = 500;

export async function listOperationLogs(roomId: string) {
  const rows = await getDatabase().operationLogs
    .where("roomId")
    .equals(roomId)
    .sortBy("createdAt");
  return rows.slice(-MAX_OPERATION_LOGS).map(({ roomId: _roomId, ...item }) => item);
}

export async function upsertOperationLog(roomId: string, item: RoomEventItem) {
  const database = getDatabase();
  await database.transaction("rw", database.operationLogs, async () => {
    await database.operationLogs.put({ roomId, ...item });
    const rows = await database.operationLogs
      .where("roomId")
      .equals(roomId)
      .sortBy("createdAt");
    const expiredKeys = rows
      .slice(0, -MAX_OPERATION_LOGS)
      .map((row): [string, string] => [row.roomId, row.id]);
    if (expiredKeys.length) await database.operationLogs.bulkDelete(expiredKeys);
  });
}

export async function clearOperationLogs(roomId: string) {
  await getDatabase().operationLogs.where("roomId").equals(roomId).delete();
}
