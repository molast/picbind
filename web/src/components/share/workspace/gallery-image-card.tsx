"use client";

import {
  FiDownload,
  FiEye,
  FiMaximize2,
  FiSend,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";
import { TbDevicesShare, TbWorldShare } from "react-icons/tb";
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
            onClick={() => onReview(image.id)}
            className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]"
            aria-label={labels.reviewImage}
            title={labels.reviewImage}
          >
            <FiEye className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
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
            className={`absolute top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-500 shadow-sm backdrop-blur transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45 ${
              canReview ? "right-12" : "right-2"
            }`}
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
          <span className="flex items-center gap-1.5">
            <span>{formatBytes(image.size)}</span>
            {image.transferMode ? (
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded ${
                  image.transferMode === "r2"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}
                title={
                  image.transferMode === "r2" ? labels.r2Mode : labels.p2pMode
                }
                role="img"
                aria-label={
                  image.transferMode === "r2" ? labels.r2Mode : labels.p2pMode
                }
              >
                {image.transferMode === "r2" ? (
                  <TbWorldShare className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <TbDevicesShare className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </span>
            ) : null}
          </span>
          {isLocalImage && status === "sending" ? (
            <button
              type="button"
              onClick={() => onCancelTransfer(image)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-red-200 text-red-600 transition hover:bg-red-50 hover:text-red-700"
              aria-label={labels.cancelTransfer}
              title={labels.cancelTransfer}
            >
              <FiXCircle className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : isLocalImage && sendReady ? (
            <button
              type="button"
              onClick={() => void onSend(image)}
              disabled={isSending || connection !== "connected"}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#2f65cf] px-2 text-[11px] font-semibold text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FiSend className="h-3 w-3" aria-hidden="true" />
              <span>{labels.send}</span>
            </button>
          ) : (
            <span className={`shrink-0 ${sendComplete ? "font-semibold text-emerald-600" : ""}`}>
              {sendComplete ? labels.sent : statusLabel}
            </span>
          )}
        </div>
        {image.previewOnly ? (
          <div className="mt-2 text-[11px] text-slate-400">{labels.previewOnly}</div>
        ) : null}

        <div className="mt-3">
          {downloadReady ? (
            <a
              href={image.url}
              download={image.name}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{labels.download}</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="relative flex h-9 w-full cursor-not-allowed items-center justify-center gap-1.5 overflow-hidden rounded-md border border-slate-200 text-xs font-semibold text-slate-400"
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
        </div>
      </div>
    </article>
  );
}
