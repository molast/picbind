"use client";

import { getDatabase } from "../database";
import { fileStorage } from "../file-storage";

const MAX_MESSAGING_IMAGES = 100;

export type CachedMessagingImage = {
  roomId: string;
  providerId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  direction: "incoming" | "outgoing";
  blob: Blob;
};

function imagePath(roomId: string, providerId: string, messageId: string) {
  return `cache/messaging/${fileStorage.segment(roomId)}/${fileStorage.segment(providerId)}/${fileStorage.segment(messageId)}`;
}

export async function storeMessagingImage(image: CachedMessagingImage) {
  const database = getDatabase();
  const filePath = imagePath(image.roomId, image.providerId, image.messageId);
  await fileStorage.write(filePath, image.blob);
  await database.messagingImages.put({
    roomId: image.roomId,
    providerId: image.providerId,
    messageId: image.messageId,
    fileName: image.fileName,
    mimeType: image.mimeType,
    size: image.blob.size,
    createdAt: image.createdAt,
    direction: image.direction,
    filePath,
  });

  const records = await database.messagingImages
    .where("roomId")
    .equals(image.roomId)
    .sortBy("createdAt");
  records.reverse();
  const expired = records.slice(MAX_MESSAGING_IMAGES);
  if (!expired.length) return;

  await database.messagingImages.bulkDelete(
    expired.map((record): [string, string, string] => [
      record.roomId,
      record.providerId,
      record.messageId,
    ]),
  );
  await Promise.all(expired.map((record) => fileStorage.remove(record.filePath)));
}

export async function listMessagingImages(roomId: string) {
  const database = getDatabase();
  const records = await database.messagingImages
    .where("roomId")
    .equals(roomId)
    .sortBy("createdAt");
  const recentRecords = records.slice(-MAX_MESSAGING_IMAGES).reverse();
  const images = await Promise.all(
    recentRecords.map(async (record): Promise<CachedMessagingImage | null> => {
      try {
        const stored = await fileStorage.read(record.filePath);
        return {
          roomId: record.roomId,
          providerId: record.providerId,
          messageId: record.messageId,
          fileName: record.fileName,
          mimeType: record.mimeType,
          size: stored.size,
          createdAt: record.createdAt,
          direction: record.direction || "incoming",
          blob: new Blob([stored], { type: record.mimeType }),
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") {
          await database.messagingImages.delete([
            record.roomId,
            record.providerId,
            record.messageId,
          ]);
          return null;
        }
        throw error;
      }
    }),
  );
  return images
    .filter((image): image is CachedMessagingImage => image !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}
