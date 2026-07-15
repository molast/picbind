"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FiChevronLeft,
  FiChevronRight,
  FiMaximize,
  FiX,
  FiZoomIn,
  FiZoomOut,
} from "react-icons/fi";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

export type PreviewImage = {
  id: string;
  src: string;
  name: string;
};

type RoomImagePreviewDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  images: PreviewImage[];
  activeId: string;
  onActiveChange(id: string): void;
};

export default function RoomImagePreviewDialog({
  open,
  onOpenChange,
  images,
  activeId,
  onActiveChange,
}: RoomImagePreviewDialogProps) {
  const activeIndex = Math.max(
    0,
    images.findIndex((image) => image.id === activeId),
  );
  const active = images[activeIndex];

  const move = React.useCallback(
    (direction: -1 | 1) => {
      if (images.length < 2) return;
      const nextIndex =
        (activeIndex + direction + images.length) % images.length;
      onActiveChange(images[nextIndex].id);
    },
    [activeIndex, images, onActiveChange],
  );

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [move, open]);

  if (!active) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/80" />
        <Dialog.Content className="fixed inset-4 z-[111] grid grid-rows-[minmax(0,1fr)_76px] overflow-hidden rounded-md bg-slate-950 shadow-2xl outline-none sm:inset-8">
          <Dialog.Title className="sr-only">{active.name}</Dialog.Title>
          <div className="relative min-h-0">
            <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-240px)] rounded-md bg-slate-900/85 px-3 py-2 text-xs text-white shadow-lg">
              <div className="truncate font-medium" title={active.name}>
                {active.name}
              </div>
              <div className="mt-0.5 text-white/55">
                {activeIndex + 1} / {images.length}
              </div>
            </div>
            <TransformWrapper
              key={active.id}
              initialScale={1}
              minScale={0.2}
              maxScale={8}
              centerOnInit
              wheel={{ step: 0.12 }}
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md bg-slate-900/85 p-1 text-white shadow-lg">
                    <button type="button" onClick={() => zoomOut()} className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10" aria-label="Zoom out" title="Zoom out">
                      <FiZoomOut className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => zoomIn()} className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10" aria-label="Zoom in" title="Zoom in">
                      <FiZoomIn className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => resetTransform()} className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10" aria-label="Reset zoom" title="Reset zoom">
                      <FiMaximize className="h-4 w-4" />
                    </button>
                    <Dialog.Close asChild>
                      <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10" aria-label="Close preview" title="Close preview">
                        <FiX className="h-4 w-4" />
                      </button>
                    </Dialog.Close>
                  </div>
                  <TransformComponent wrapperClass="!h-full !w-full" contentClass="!flex !h-full !w-full !items-center !justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={active.src} alt={active.name} className="max-h-[calc(100vh-9rem)] max-w-[calc(100vw-4rem)] select-none object-contain" />
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
            {images.length > 1 ? (
              <>
                <button type="button" onClick={() => move(-1)} className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-slate-900/75 text-white shadow-lg hover:bg-slate-800" aria-label="Previous image" title="Previous image">
                  <FiChevronLeft className="h-6 w-6" />
                </button>
                <button type="button" onClick={() => move(1)} className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-slate-900/75 text-white shadow-lg hover:bg-slate-800" aria-label="Next image" title="Next image">
                  <FiChevronRight className="h-6 w-6" />
                </button>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto border-t border-white/10 bg-slate-900 px-3 py-2">
            {images.map((image) => (
              <button key={image.id} type="button" onClick={() => onActiveChange(image.id)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 ${image.id === active.id ? "border-blue-400" : "border-transparent opacity-55 hover:opacity-100"}`} aria-label={`Preview ${image.name}`} title={image.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
