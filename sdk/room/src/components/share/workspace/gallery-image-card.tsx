"use client";

import React from "react";
import {
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiEye,
  FiImage,
  FiMaximize2,
  FiSend,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";
import { TbBookmarkFilled, TbBookmarkPlus, TbDevicesShare, TbHeartFilled, TbPinned, TbPinnedFilled, TbWorldShare } from "react-icons/tb";
import RoomImageMedia from "../room-image-media";
import type { ShareRoomLabels } from "../share-room-labels";
import type { ConnectionState, ImageReactionSignal, RoomImage } from "../share-room-types";
import { formatBytes, middleEllipsisFileName } from "../share-room-formatters";
import ImageOperationMenu from "./image-operation-menu";
import ImageVersionMenu from "./image-version-menu";

type GalleryImageCardProps = {
  image: RoomImage;
  connection: ConnectionState;
  isSending: boolean;
  labels: ShareRoomLabels;
  onPreview(imageId: string): void;
  onPlaceholderMeasured(imageId: string, width: number, height: number): void;
  onReview(imageId: string): void;
  onSend(image: RoomImage): void | Promise<void>;
  onCancelTransfer(image: RoomImage): void;
  onDelete(image: RoomImage): void | Promise<void>;
  onMoveToLibrary(image: RoomImage): void | Promise<void>;
  onTogglePin(image: RoomImage): void;
  onLike(image: RoomImage): void;
  onWant(image: RoomImage): void;
  reactionSignal?: ImageReactionSignal;
  onConvert(image: RoomImage): void;
  onCompress(image: RoomImage): void;
  onCrop(image: RoomImage): void;
  onResize(image: RoomImage): void;
  onAdjust(image: RoomImage): void;
  versions: RoomImage[];
  onSelectVersion(imageId: string): void;
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
  onPlaceholderMeasured,
  onReview,
  onSend,
  onCancelTransfer,
  onDelete,
  onMoveToLibrary,
  onTogglePin,
  onLike,
  onWant,
  reactionSignal,
  onConvert,
  onCompress,
  onCrop,
  onResize,
  onAdjust,
  versions,
  onSelectVersion,
}: GalleryImageCardProps) {
  const mediaRef = React.useRef<HTMLDivElement | null>(null);
  const [showThumbnail, setShowThumbnail] = React.useState(false);
  const [floatingHearts, setFloatingHearts] = React.useState<Array<{ id: number; left: number }>>([]);
  const heartSequenceRef = React.useRef(0);
  const heartTimersRef = React.useRef(new Set<number>());
  const reactionSequence = reactionSignal?.sequence;
  const reactionCount = reactionSignal?.count;
  const handledReactionSequenceRef = React.useRef(reactionSequence || 0);
  const spawnHearts = React.useCallback((count: number) => {
    for (let index = 0; index < count; index += 1) {
      const showTimer = window.setTimeout(() => {
        heartTimersRef.current.delete(showTimer);
        const id = heartSequenceRef.current++;
        const left = 18 + ((id * 29) % 64);
        setFloatingHearts((current) => [...current, { id, left }]);
        const removeTimer = window.setTimeout(() => {
          heartTimersRef.current.delete(removeTimer);
          setFloatingHearts((current) => current.filter((heart) => heart.id !== id));
        }, 1600);
        heartTimersRef.current.add(removeTimer);
      }, index * 140);
      heartTimersRef.current.add(showTimer);
    }
  }, []);
  React.useEffect(
    () => () => {
      heartTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      heartTimersRef.current.clear();
    },
    [],
  );
  React.useEffect(() => {
    if (
      !reactionSequence ||
      !reactionCount ||
      reactionSequence <= handledReactionSequenceRef.current
    ) {
      return;
    }
    handledReactionSequenceRef.current = reactionSequence;
    spawnHearts(reactionCount);
  }, [reactionCount, reactionSequence, spawnHearts]);
  React.useEffect(() => {
    const media = mediaRef.current;
    if (!media || image.direction !== "received" || !image.placeholder) return;
    const reportSize = () => {
      const rect = media.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        onPlaceholderMeasured(image.id, rect.width, rect.height);
      }
    };
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(media);
    return () => observer.disconnect();
  }, [image.direction, image.id, image.placeholder, onPlaceholderMeasured]);

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
  const canLike = image.direction === "received";
  const sendReady =
    isLocalImage &&
    Boolean(image.placeholder) &&
    image.shareStatus !== "awaiting-response" &&
    image.shareStatus !== "accepted" &&
    image.shareStatus !== "transferring" &&
    (status === "waiting" || status === "failed" || status === "cancelled");
  const sendComplete = isLocalImage && status === "sent";
  const enteredFromLibrary = image.outboxOrigin === "library";
  const canRemove = enteredFromLibrary
    ? isLocalImage &&
      status !== "sending" &&
      status !== "receiving" &&
      status !== "awaiting-receipt" &&
      image.shareStatus !== "awaiting-response" &&
      image.shareStatus !== "accepted" &&
      image.shareStatus !== "transferring"
    : !image.placeholderOnly &&
      status !== "sending" &&
      status !== "receiving" &&
      status !== "awaiting-receipt" &&
      image.shareStatus !== "awaiting-response" &&
      image.shareStatus !== "transferring";
  const downloadReady =
    !image.placeholderOnly &&
    !image.previewOnly &&
    image.blob.size > 0;

  return (
    <article className="relative rounded-md border border-slate-200 bg-white">
      {canReview ? (
        <ImageOperationMenu
          disabled={false}
          labels={labels}
          onConvert={() => onConvert(image)}
          onCompress={() => onCompress(image)}
          onCrop={() => onCrop(image)}
          onResize={() => onResize(image)}
          onAdjust={() => onAdjust(image)}
        />
      ) : null}
      <div
        ref={mediaRef}
        className="relative aspect-[5/3] w-full overflow-hidden rounded-t-[5px] bg-slate-100"
        onClick={(event) => {
          if (!canLike) return;
          if ((event.target as HTMLElement).closest("button, a")) return;
          spawnHearts(1);
          onLike(image);
        }}
        title={canLike ? labels.likeImage : undefined}
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
        {showThumbnail && image.thumbnailUrl ? (
          // Blob URLs are local browser assets and cannot use the Next image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.thumbnailUrl}
            alt=""
            className="pointer-events-none absolute inset-0 z-[5] h-full w-full object-cover"
            aria-hidden="true"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 z-[8] overflow-hidden" aria-hidden="true">
          {floatingHearts.map((heart) => (
            <span
              key={heart.id}
              className="absolute bottom-4 text-2xl text-red-500 drop-shadow-sm"
              style={{
                left: `${heart.left}%`,
                animation: "picbind-image-heart-float 1.6s ease-out forwards",
              }}
            >
              ♥
            </span>
          ))}
        </div>
        {(image.likeCount || 0) > 0 ? (
          <span className="pointer-events-none absolute bottom-2 left-1/2 z-10 inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full bg-white/90 px-2 text-[11px] font-semibold text-red-600 shadow-sm backdrop-blur" title={labels.likeImage}>
            <TbHeartFilled className="h-3.5 w-3.5" aria-hidden="true" />
            {image.likeCount}
          </span>
        ) : null}
        {image.direction === "received" &&
        image.placeholderOnly &&
        image.thumbnailUrl ? (
          <button
            type="button"
            className="absolute bottom-2 left-2 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]"
            aria-label={labels.holdThumbnail}
            title={labels.holdThumbnail}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setShowThumbnail(true);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setShowThumbnail(false);
            }}
            onPointerCancel={() => setShowThumbnail(false)}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                setShowThumbnail(true);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                setShowThumbnail(false);
              }
            }}
            onBlur={() => setShowThumbnail(false)}
          >
            <FiImage className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {image.direction === "received" && image.placeholderOnly ? (
          <button
            type="button"
            onClick={() => onWant(image)}
            disabled={connection !== "connected"}
            className={`absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md shadow-sm backdrop-blur transition disabled:cursor-default ${
              image.wantedByMe
                ? "bg-[#2f65cf] text-white shadow-md ring-2 ring-blue-200"
                : "bg-white/90 text-slate-600 hover:bg-white hover:text-[#2f65cf]"
            }`}
            aria-label={image.wantedByMe ? labels.cancelWantedImage : labels.wantImage}
            title={image.wantedByMe ? labels.cancelWantedImage : labels.wantImage}
          >
            {image.wantedByMe ? <TbBookmarkFilled className="h-3.5 w-3.5" aria-hidden="true" /> : <TbBookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        ) : null}
        {image.direction === "sent" && image.wantedByPeer ? (
          <span className="pointer-events-none absolute bottom-2 right-2 z-10 inline-flex h-7 items-center gap-1 rounded-full bg-blue-50/95 px-2 text-[10px] font-semibold text-[#2f65cf] shadow-sm backdrop-blur" title={labels.wantedByPeer}>
            <TbBookmarkFilled className="h-3.5 w-3.5" aria-hidden="true" />
            {labels.wantedByPeer}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onTogglePin(image)}
          className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf] ${
            image.pinnedAt ? "text-[#2f65cf]" : "text-slate-600"
          }`}
          aria-label={image.pinnedAt ? labels.unpinImage : labels.pinImage}
          title={image.pinnedAt ? labels.unpinImage : labels.pinImage}
          aria-pressed={Boolean(image.pinnedAt)}
        >
          {image.pinnedAt ? <TbPinnedFilled className="h-3.5 w-3.5" aria-hidden="true" /> : <TbPinned className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        {canReview ? (
          <button
            type="button"
            onClick={() => onReview(image.id)}
            className="absolute right-11 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]"
            aria-label={labels.reviewImage}
            title={labels.reviewImage}
          >
            <FiEye className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {image.reviewStatus ? (
          <span
            className={`absolute right-2 z-10 flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-semibold shadow-sm backdrop-blur ${
              image.direction === "sent" && image.wantedByPeer ? "bottom-11" : "bottom-2"
            } ${
              image.reviewStatus === "approved"
                ? "bg-emerald-600/95 text-white"
                : "bg-amber-100/95 text-amber-800"
            }`}
            title={
              image.reviewStatus === "approved"
                ? labels.reviewApproved
                : labels.reviewInProgress
            }
          >
            {image.reviewStatus === "approved" ? (
              <FiCheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <FiClock className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>
              {image.reviewStatus === "approved"
                ? labels.reviewApproved
                : `${labels.reviewInProgress} ${image.reviewAnchorCount || 0}`}
            </span>
          </span>
        ) : null}
        {canReview ? (
          <button
            type="button"
            onClick={() => onPreview(image.id)}
            className="absolute left-11 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]"
            aria-label={labels.previewImage}
            title={labels.previewImage}
          >
            <FiMaximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            onClick={() => void (enteredFromLibrary ? onMoveToLibrary(image) : onDelete(image))}
            disabled={enteredFromLibrary && connection !== "connected"}
            className={`absolute top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-500 shadow-sm backdrop-blur transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45 ${
              canReview ? "right-20" : "right-11"
            }`}
            aria-label={enteredFromLibrary ? labels.removeFromOutbox : labels.deleteImage}
            title={enteredFromLibrary ? labels.removeFromOutbox : labels.deleteImage}
          >
            <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <ImageVersionMenu
          labels={labels}
          versions={versions}
          selectedId={image.id}
          onSelect={onSelectVersion}
        />
      </div>

      <div className="p-3">
        <div className="truncate text-sm font-semibold text-slate-800" title={image.name}>
          {middleEllipsisFileName(image.name)}
        </div>
        <div className="mt-1 flex min-h-10 items-center justify-between gap-2 text-xs text-slate-500">
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
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
            <span
              className={`flex h-3 w-full max-w-40 items-center gap-1.5 transition-opacity ${showProgress ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={!showProgress}
            >
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span
                  className="block h-full rounded-full bg-[#2f65cf] transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </span>
              <span className="w-7 text-right text-[9px] tabular-nums text-slate-400">{progress}%</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {isLocalImage && status === "sending" ? (
              <button
                type="button"
                onClick={() => onCancelTransfer(image)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-red-200 text-red-600 transition hover:bg-red-50 hover:text-red-700"
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
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#2f65cf] text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={labels.send}
                title={labels.send}
              >
                <FiSend className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <span className={`${sendComplete ? "font-semibold text-emerald-600" : ""}`}>
                {sendComplete
                  ? labels.sent
                  : isLocalImage && image.shareStatus === "awaiting-response"
                    ? labels.waitingPeerConfirmation
                    : isLocalImage && image.shareStatus === "accepted"
                      ? labels.peerAccepted
                      : isLocalImage && image.shareStatus === "rejected"
                        ? labels.peerRejected
                        : statusLabel}
              </span>
            )}
            {downloadReady ? (
              <a
                href={image.url}
                download={image.name}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label={labels.download}
                title={labels.download}
              >
                <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="relative flex h-7 w-7 cursor-not-allowed items-center justify-center overflow-hidden rounded-md border border-slate-200 text-slate-400"
                aria-label={labels.download}
                title={labels.download}
              >
                <FiDownload className="relative h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        {image.previewOnly ? (
          <div className="mt-2 text-[11px] text-slate-400">{labels.previewOnly}</div>
        ) : null}
      </div>
    </article>
  );
}
