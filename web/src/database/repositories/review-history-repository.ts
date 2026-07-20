"use client";

import { getDatabaseClient } from "../client";
import type { SqlValue } from "../types/client";
import type { StoredReviewHistory } from "../types/storage";
import type { ReviewAnchor, ReviewOperation } from "@/utils/review-collaboration";

type ReviewHistoryRow = Record<string, SqlValue> & {
  operations_json: string;
  anchors_json: string;
  cursor: number;
};

function parseList<T>(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadHistory(
  roomId: string,
  imageId: string,
): Promise<StoredReviewHistory | null> {
  const database = await getDatabaseClient();
  const [row] = await database.query<ReviewHistoryRow>(
    `SELECT operations_json, anchors_json, cursor
     FROM review_histories WHERE room_id = ? AND image_id = ?`,
    [roomId, imageId],
  );
  if (!row) return null;
  const operations = parseList<ReviewOperation>(row.operations_json);
  return {
    operations,
    anchors: parseList<ReviewAnchor>(row.anchors_json),
    cursor: Math.max(0, Math.min(operations.length, Number(row.cursor))),
  };
}

export async function saveHistory(
  roomId: string,
  imageId: string,
  operations: ReviewOperation[],
  cursor: number,
  anchors: ReviewAnchor[],
) {
  const database = await getDatabaseClient();
  await database.execute(
    `INSERT INTO review_histories (
       room_id, image_id, operations_json, anchors_json, cursor, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, image_id) DO UPDATE SET
       operations_json = excluded.operations_json,
       anchors_json = excluded.anchors_json,
       cursor = excluded.cursor,
       updated_at = excluded.updated_at`,
    [
      roomId,
      imageId,
      JSON.stringify(operations),
      JSON.stringify(anchors),
      Math.max(0, Math.min(operations.length, cursor)),
      Date.now(),
    ],
  );
}
