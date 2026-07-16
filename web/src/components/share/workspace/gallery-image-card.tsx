"use client";

import {
  FiDownload,
  FiEye,
  FiMaximize2,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";
import RoomImageMedia from "../room-image-media";
import type { ShareRoomLabels } from "../share-room-labels";
import type { ConnectionState, RoomImage } from "../share-room-types";
import { formatBytes, middleEllipsisFileName } from "../share-room-formatters";

type GalleryImageCardProps = {
  image: RoomImage;
  connection: ConnectionState;
  isSending: boolean;
  labels: ShareRoomLabels;
  onPreview(imageId: string): void;
  onReview(imageId: string): void;
  onSend(image: RoomImage): void | Promise<void>;
  onCancelTransfer(image: RoomImage): void;
  onDelete(image: RoomImage): void | Promise<void>;
};

export function canReviewRoomImage(image: RoomImage) {
  const status =
    image.transferStatus ||
    (image.direction === "sent" ? "sent" : "received");
  return (
    !image.previewOnly &&
    !image.placeholderOnly &&
    (image.direction === "sent" || status === "sent" || status === "received")
  );
}

export default function GalleryImageCard({
  image,
  connection,
  isSending,
  labels,
  onPreview,
  onReview,
  onSend,
  onCancelTransfer,
  onDelete,
}: GalleryImageCardProps) {
  const status =
    image.transferStatus ||
    (image.direction === "sent" ? "sent" : "received");
  const progress = Math.round((image.progress || 0) * 100);
  const statusLabel =
    status === "waiting"
      ? image.direction === "sent"
        ? image.placeholder
          ? labels.waitingToSend
          : labels.preparingPreview
        : labels.waitingForSender
      : status === "sending"
        ? `${labels.sending} ${progress}%`
        : status === "receiving"
          ? `${labels.receiving} ${progress}%`
          : status === "awaiting-receipt"
            ? labels.awaitingReceipt
            : status === "failed"
              ? labels.transferFailed
              : status === "cancelled"
                ? labels.transferCancelled
              : status === "sent"
                ? labels.sent
                : labels.received;
  const showProgress =
    status === "sending" ||
    status === "receiving" ||
    status === "awaiting-receipt";
  const canReview = canReviewRoomImage(image);
  const isLocalImage = image.direction === "sent";
  const sendReady =
    isLocalImage &&
    Boolean(image.placeholder) &&
    (status === "waiting" || status === "failed" || status === "cancelled");
  const sendComplete = isLocalImage && status === "sent";
  const canDelete =
    isLocalImage &&
    (status === "waiting" || status === "failed" || status === "cancelled");
  const downloadReady = status === "sent" || status === "received";

  return (
    <article className="relative overflow-hidden rounded-md border border-slate-200 bg-white">
      <div
        className="relative aspect-square w-full overflow-hidden bg-slate-100"
        onDoubleClick={() => canReview && onReview(image.id)}
      >
        {image.placeholder && image.direction === "received" ? (
          <RoomImageMedia
            alt={image.name}
            src={image.placeholderOnly ? undefined : image.url}
            placeholder={image.placeholder}
          />
        ) : (
          // Blob URLs are local browser assets and cannot use the Next image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.name}
            className={`h-full w-full object-cover transition duration-200 ${
              image.previewOnly ? "[image-rendering:auto]" : ""
            }`}
          />
        )}
        {canReview ? (
          <button
            type="button"
            onClick={() => onPreview(image.id)}
            className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]"
            aria-label={labels.previewImage}
            title={labels.previewImage}
          >
            <FiMaximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={() => void onDelete(image)}
            disabled={connection !== "connected"}
            className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-500 shadow-sm backdrop-blur transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={labels.deleteImage}
            title={labels.deleteImage}
          >
            <FiTrash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="p-3">
        <div className="truncate text-sm font-semibold text-slate-800" title={image.name}>
          {middleEllipsisFileName(image.name)}
        </div>
        <div className="mt-1 flex min-h-6 items-center justify-between gap-2 text-xs text-slate-500">
          <span>{formatBytes(image.size)}</span>
          {isLocalImage ? (
            <button
              type="button"
              onClick={() =>
                status === "sending"
                  ? onCancelTransfer(image)
                  : void onSend(image)
              }
              disabled={
                status !== "sending" &&
                (!sendReady || isSending || connection !== "connected")
              }
              className={`shrink-0 font-semibold transition ${
                status === "sending"
                  ? "inline-flex items-center gap-1 text-red-600 hover:text-red-700"
                  : sendReady
                  ? "text-[#2f65cf] hover:text-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
                  : sendComplete
                    ? "cursor-default text-emerald-600"
                    : "cursor-default text-slate-400"
              }`}
            >
              {status === "sending" ? (
                <>
                  <FiXCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.cancelTransfer}
                </>
              ) : sendReady ? labels.send : sendComplete ? labels.sent : statusLabel}
            </button>
          ) : (
            <span className="shrink-0">{statusLabel}</span>
          )}
        </div>
        {image.previewOnly ? (
          <div className="mt-2 text-[11px] text-slate-400">{labels.previewOnly}</div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {downloadReady ? (
            <a
              href={image.url}
              download={image.name}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{labels.download}</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="relative flex h-9 cursor-not-allowed items-center justify-center gap-1.5 overflow-hidden rounded-md border border-slate-200 text-xs font-semibold text-slate-400"
            >
              {showProgress ? (
                <span
                  className="absolute inset-y-0 left-0 bg-blue-100/70 transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              ) : null}
              <FiDownload className="relative h-3.5 w-3.5" aria-hidden="true" />
              <span className="relative">{showProgress ? `${progress}%` : labels.download}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onReview(image.id)}
            disabled={!canReview}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-slate-900 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            <FiEye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{labels.review}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
