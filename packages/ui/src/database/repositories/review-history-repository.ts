"use client";

import { getDatabase } from "../database";
import type { StoredReviewHistory } from "../types/storage";
import type { ReviewAnchor, ReviewOperation } from "../../utils/review-collaboration";

export async function loadHistory(
  workspaceId: string,
  imageId: string,
): Promise<StoredReviewHistory | null> {
  const record = await getDatabase().workspaceReviewHistories.get([workspaceId, imageId]);
  if (!record) return null;
  return {
    operations: record.operations,
    anchors: record.anchors,
    cursor: Math.max(0, Math.min(record.operations.length, record.cursor)),
  };
}

export async function saveHistory(
  workspaceId: string,
  imageId: string,
  operations: ReviewOperation[],
  cursor: number,
  anchors: ReviewAnchor[],
) {
  await getDatabase().workspaceReviewHistories.put({
    workspaceId,
    imageId,
    operations,
    anchors,
    cursor: Math.max(0, Math.min(operations.length, cursor)),
    updatedAt: Date.now(),
  });
}

export async function deleteHistory(workspaceId: string, imageId: string) {
  await getDatabase().workspaceReviewHistories.delete([workspaceId, imageId]);
}
