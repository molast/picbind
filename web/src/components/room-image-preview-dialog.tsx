"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FiMaximize, FiX, FiZoomIn, FiZoomOut } from "react-icons/fi";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

type RoomImagePreviewDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  src: string;
  name: string;
};

export default function RoomImagePreviewDialog({
  open,
  onOpenChange,
  src,
  name,
}: RoomImagePreviewDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/80" />
        <Dialog.Content className="fixed inset-4 z-[111] flex flex-col overflow-hidden rounded-md bg-slate-950 shadow-2xl outline-none sm:inset-8">
          <Dialog.Title className="sr-only">{name}</Dialog.Title>
          <TransformWrapper
            initialScale={1}
            minScale={0.2}
            maxScale={8}
            centerOnInit
            wheel={{ step: 0.12 }}
          >
            {({ zoomIn, zoomOut, resetTransform }) => (
              <>
                <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md bg-slate-900/85 p-1 text-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => zoomOut()}
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    <FiZoomOut className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomIn()}
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    <FiZoomIn className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => resetTransform()}
                    className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
                    aria-label="Reset zoom"
                    title="Reset zoom"
                  >
                    <FiMaximize className="h-4 w-4" />
                  </button>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
                      aria-label="Close preview"
                      title="Close preview"
                    >
                      <FiX className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>
                <TransformComponent
                  wrapperClass="!h-full !w-full"
                  contentClass="!flex !h-full !w-full !items-center !justify-center"
                >
                  {/* Blob URLs are local assets and cannot use the Next image optimizer. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={name}
                    className="max-h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] select-none object-contain"
                  />
                </TransformComponent>
              </>
            )}
          </TransformWrapper>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
