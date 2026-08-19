"use client";

import {
  getDatabase,
  type ImageDeliveryRecord,
  type ImageDeliveryStatus,
} from "../database";

export type ImageDelivery = ImageDeliveryRecord;
export type { ImageDeliveryStatus };

export async function listImageDeliveries(roomId: string) {
  return getDatabase().imageDeliveries
    .where("roomId")
    .equals(roomId)
    .sortBy("updatedAt");
}

export async function upsertImageDelivery(delivery: ImageDelivery) {
  await getDatabase().imageDeliveries.put(delivery);
}

export async function deleteImageDeliveries(roomId: string, imageId: string) {
  await getDatabase().imageDeliveries
    .where("[roomId+imageId]")
    .equals([roomId, imageId])
    .delete();
}
