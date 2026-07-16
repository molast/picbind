"use client";

import type React from "react";
import {
  FiDownload,
  FiImage,
  FiLoader,
  FiTrash2,
  FiUploadCloud,
} from "react-icons/fi";
import RoomImageMedia from "./room-image-media";
import type { ShareRoomLabels } from "./share-room-labels";
import type { ConnectionState, RoomImage } from "./share-room-types";
import { formatBytes, middleEllipsisFileName } from "./share-room-formatters";

type ImageWorkspaceProps = {
  inputRef: React.RefObject<HTMLInputElement>;
  images: RoomImage[];
  connection: ConnectionState;
  isSending: boolean;
  isDragging: boolean;
  labels: ShareRoomLabels;
  onFiles(files: FileList): void | Promise<void>;
  onDraggingChange(dragging: boolean): void;
  onPreview(imageId: string): void;
  onSend(image: RoomImage): void | Promise<void>;
  onDelete(image: RoomImage): void | Promise<void>;
};

export default function ImageWorkspace({
  inputRef,
  images,
  connection,
  isSending,
  isDragging,
  labels,
  onFiles,
  onDraggingChange,
  onPreview,
  onSend,
  onDelete,
}: ImageWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {labels.workspace}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{labels.cached}</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isSending || connection !== "connected"}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSending ? (
            <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FiUploadCloud className="h-4 w-4" aria-hidden="true" />
          )}
          <span>{isSending ? labels.uploading : labels.upload}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void onFiles(event.target.files);
          }}
        />
      </div>

      <div
        className={`min-h-[260px] flex-1 rounded-lg border-2 border-dashed transition ${
          isDragging
            ? "border-[#2f65cf] bg-blue-50"
            : "border-slate-300 bg-white/70"
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (connection === "connected") onDraggingChange(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => onDraggingChange(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDraggingChange(false);
          if (connection === "connected") void onFiles(event.dataTransfer.files);
        }}
      >
        {images.length ? (
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4 xl:grid-cols-4 2xl:grid-cols-5">
            {images.map((image) => {
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
                          : status === "sent"
                            ? labels.sent
                            : labels.received;
              const showProgress =
                status === "sending" ||
                status === "receiving" ||
                status === "awaiting-receipt";
              const canPreview =
                !image.previewOnly &&
                !image.placeholderOnly &&
                (image.direction === "sent" ||
                  status === "sent" ||
                  status === "received");
              const isLocalImage = image.direction === "sent";
              const sendReady =
                isLocalImage &&
                Boolean(image.placeholder) &&
                (status === "waiting" || status === "failed");
              const sendComplete = isLocalImage && status === "sent";
              const canDelete =
                isLocalImage && (status === "waiting" || status === "failed");
              const downloadReady = status === "sent" || status === "received";

              return (
                <article
                  key={image.id}
                  className="relative overflow-hidden rounded-md border border-slate-200 bg-white"
                >
                  <button
                    type="button"
                    onClick={() => canPreview && onPreview(image.id)}
                    disabled={!canPreview}
                    className="block aspect-square w-full overflow-hidden bg-slate-100 disabled:cursor-default"
                    aria-label={`${image.name} preview`}
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
                        className={`h-full w-full transition duration-200 hover:scale-[1.02] ${
                          image.previewOnly
                            ? "object-contain [image-rendering:auto]"
                            : "object-cover"
                        }`}
                      />
                    )}
                  </button>
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
                  <div className="p-3">
                    <div
                      className="truncate text-sm font-semibold text-slate-800"
                      title={image.name}
                    >
                      {middleEllipsisFileName(image.name)}
                    </div>
                    <div className="mt-1 flex min-h-6 items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{formatBytes(image.size)}</span>
                      {isLocalImage ? (
                        <button
                          type="button"
                          onClick={() => void onSend(image)}
                          disabled={
                            !sendReady || isSending || connection !== "connected"
                          }
                          className={`shrink-0 font-semibold transition ${
                            sendReady
                              ? "text-[#2f65cf] hover:text-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
                              : sendComplete
                                ? "cursor-default text-emerald-600"
                                : "cursor-default text-slate-400"
                          }`}
                        >
                          {sendReady
                            ? labels.send
                            : sendComplete
                              ? labels.sent
                              : statusLabel}
                        </button>
                      ) : (
                        <span className="shrink-0">{statusLabel}</span>
                      )}
                    </div>
                    {image.previewOnly ? (
                      <div className="mt-2 text-[11px] text-slate-400">
                        {labels.previewOnly}
                      </div>
                    ) : null}
                    {downloadReady ? (
                      <a
                        href={image.url}
                        download={image.name}
                        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{labels.download}</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="relative mt-3 flex h-9 w-full cursor-not-allowed items-center justify-center gap-2 overflow-hidden rounded-md border border-slate-200 text-xs font-semibold text-slate-400"
                      >
                        {showProgress ? (
                          <span
                            className="absolute inset-y-0 left-0 bg-blue-100/70 transition-[width] duration-150"
                            style={{ width: `${progress}%` }}
                          />
                        ) : null}
                        <FiDownload className="relative h-3.5 w-3.5" aria-hidden="true" />
                        <span className="relative">
                          {labels.download}
                          {showProgress ? ` · ${progress}%` : ""}
                        </span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            disabled={connection !== "connected"}
            onClick={() => inputRef.current?.click()}
            className="flex h-full min-h-[260px] w-full flex-col items-center justify-center px-6 text-center disabled:cursor-default"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
              <FiImage className="h-7 w-7" aria-hidden="true" />
            </span>
            <span className="mt-4 text-base font-semibold text-slate-800">
              {labels.guestEmpty}
            </span>
            <span className="mt-1 text-sm text-slate-500">{labels.dropHint}</span>
          </button>
        )}
      </div>
    </div>
  );
}
