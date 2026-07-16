"use client";

import type React from "react";
import { FiImage, FiLoader, FiUploadCloud } from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import type { ConnectionState, RoomImage } from "../share-room-types";
import GalleryImageCard from "./gallery-image-card";

type GalleryWorkspaceProps = {
  inputRef: React.RefObject<HTMLInputElement>;
  images: RoomImage[];
  connection: ConnectionState;
  isSending: boolean;
  isDragging: boolean;
  labels: ShareRoomLabels;
  onFiles(files: FileList): void | Promise<void>;
  onDraggingChange(dragging: boolean): void;
  onPreview(imageId: string): void;
  onReview(imageId: string): void;
  onSend(image: RoomImage): void | Promise<void>;
  onDelete(image: RoomImage): void | Promise<void>;
};

export default function GalleryWorkspace({
  inputRef,
  images,
  connection,
  isSending,
  isDragging,
  labels,
  onFiles,
  onDraggingChange,
  onPreview,
  onReview,
  onSend,
  onDelete,
}: GalleryWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{labels.gallery}</h1>
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
            {images.map((image) => (
              <GalleryImageCard
                key={image.id}
                image={image}
                connection={connection}
                isSending={isSending}
                labels={labels}
                onPreview={onPreview}
                onReview={onReview}
                onSend={onSend}
                onDelete={onDelete}
              />
            ))}
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
