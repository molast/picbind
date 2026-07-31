import type { ReviewAnchor, ReviewOperation } from "../../utils/review-collaboration";
import type { ImagePlaceholderMetadata } from "../../utils/share-placeholder";

export type CachedCompressedImage = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceSize: number;
  name: string;
  type: string;
  format: string;
  size: number;
  blob: Blob;
  createdAt: number;
};

export type CachedRoomImage = {
  id: string;
  roomId: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  direction: "sent" | "received";
  transferStatus?:
    | "waiting"
    | "sending"
    | "awaiting-receipt"
    | "receiving"
    | "sent"
    | "received"
    | "cancelled"
    | "failed";
  progress?: number;
  transferMode?: "p2p" | "r2";
  previewOnly?: boolean;
  placeholderOnly?: boolean;
  placeholder?: ImagePlaceholderMetadata;
  thumbnail?: Blob;
  reviewStatus?: "in-review" | "approved";
  reviewAnchorCount?: number;
  createdAt: number;
};

export type StoredReviewHistory = {
  operations: ReviewOperation[];
  anchors: ReviewAnchor[];
  cursor: number;
};
