"use client";

import React from "react";
import { FiDownloadCloud, FiImage, FiX } from "react-icons/fi";
import { formatBytes } from "../share-room-formatters";
import type { ImageShareRequest } from "../../../utils/image-workspace-messages";
import RoomImageMedia from "../room-image-media";

type ImageShareRequestDialogProps = {
  request: ImageShareRequest | null;
  thumbnail: Blob | null;
  onPlaceholderMeasured(imageId: string, width: number, height: number): void;
  onDecision(decision: "accept" | "reject"): void;
};

export default function ImageShareRequestDialog({ request, thumbnail, onPlaceholderMeasured, onDecision }: ImageShareRequestDialogProps) {
  const mediaRef = React.useRef<HTMLDivElement | null>(null);
  const [showThumbnail, setShowThumbnail] = React.useState(false);
  const thumbnailUrl = React.useMemo(
    () => (thumbnail ? URL.createObjectURL(thumbnail) : null),
    [thumbnail],
  );
  React.useEffect(
    () => () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    },
    [thumbnailUrl],
  );
  React.useEffect(() => setShowThumbnail(false), [request, thumbnail]);
  React.useEffect(() => {
    const media = mediaRef.current;
    if (!request?.payload.placeholder || !media) return;
    const reportSize = () => {
      const rect = media.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        onPlaceholderMeasured(request.payload.image.imageId, rect.width, rect.height);
      }
    };
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(media);
    return () => observer.disconnect();
  }, [onPlaceholderMeasured, request]);
  React.useEffect(() => {
    if (!request) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onDecision("reject");
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onDecision, request]);
  if (!request) return null;
  const image = request.payload.image;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="接收处理后的图片">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]"><FiDownloadCloud className="h-5 w-5" aria-hidden="true" /></span>
          <button type="button" onClick={() => onDecision("reject")} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="拒绝"><FiX className="h-4 w-4" /></button>
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-900">对方分享了一张图片</h2>
        {request.payload.placeholder ? (
          <div ref={mediaRef} className="relative mt-4 aspect-[5/3] overflow-hidden rounded-md bg-slate-100">
            <RoomImageMedia alt={image.name} placeholder={request.payload.placeholder} />
            {showThumbnail && thumbnailUrl ? (
              <img src={thumbnailUrl} alt="" className="pointer-events-none absolute inset-0 z-[5] h-full w-full object-cover" aria-hidden="true" />
            ) : null}
            {thumbnailUrl ? (
              <button
                type="button"
                className="absolute bottom-2 left-2 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]"
                aria-label="长按查看缩略图"
                title="长按查看缩略图"
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setShowThumbnail(true);
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
                  if (event.key === " " || event.key === "Enter") setShowThumbnail(false);
                }}
                onBlur={() => setShowThumbnail(false)}
              >
                <FiImage className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="mt-1 break-words text-sm text-slate-600">{image.name}</p>
        <p className="mt-2 text-xs text-slate-500">{image.type.split("/")[1]?.toUpperCase()} · {formatBytes(image.size)}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onDecision("reject")} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">拒绝</button>
          <button type="button" onClick={() => onDecision("accept")} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd]">接收</button>
        </div>
      </section>
    </div>
  );
}
