"use client";

import React from "react";
import { FiCheck, FiImage, FiLoader, FiTrash2, FiX, FiZap } from "react-icons/fi";
import {
  clearCompressedImages,
  deleteCompressedImage,
  listCompressedImages,
  type CachedCompressedImage,
} from "@/utils/compressed-image-store";
import type { ShareRoomLabels } from "../share-room-labels";
import { formatBytes, middleEllipsisFileName } from "../share-room-formatters";

type CompressedImagePickerDialogProps = {
  open: boolean;
  labels: ShareRoomLabels;
  onClose(): void;
  onCompress(): void | Promise<void>;
  onSelect(files: File[]): void | Promise<void>;
};

export default function CompressedImagePickerDialog({
  open,
  labels,
  onClose,
  onCompress,
  onSelect,
}: CompressedImagePickerDialogProps) {
  const [items, setItems] = React.useState<CachedCompressedImage[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [urls, setUrls] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    let disposed = false;
    setLoading(true);
    setSelected(new Set());
    void listCompressedImages()
      .then((next) => {
        if (!disposed) setItems(next);
      })
      .catch(() => {
        if (!disposed) setItems([]);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [open]);

  React.useEffect(() => {
    const next = Object.fromEntries(
      items.map((item) => [item.id, URL.createObjectURL(item.blob)]),
    );
    setUrls(next);
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  }, [items]);

  if (!open) return null;
  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const addSelected = () => {
    const files = items
      .filter((item) => selected.has(item.id))
      .map(
        (item) =>
          new File([item.blob], item.name, {
            type: item.type,
            lastModified: item.createdAt,
          }),
      );
    if (files.length) void onSelect(files);
  };
  const removeItem = async (id: string) => {
    await deleteCompressedImage(id);
    setItems((current) => current.filter((item) => item.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };
  const clearItems = async () => {
    await clearCompressedImages();
    setItems([]);
    setSelected(new Set());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <h2 className="text-base font-semibold text-slate-900">{labels.compressedPickerTitle}</h2>
          <div className="flex items-center gap-1">
            {items.length ? <button type="button" onClick={() => void clearItems()} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-red-600 hover:bg-red-50" title={labels.clearCompressedImages}><FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />{labels.clearCompressedImages}</button> : null}
            <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={labels.closeDialog}>
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex min-h-56 items-center justify-center text-slate-500">
              <FiLoader className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          ) : items.length ? (
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {items.map((item) => {
                const isSelected = selected.has(item.id);
                const savedPercent = item.sourceSize
                  ? Math.max(0, Math.round((1 - item.size / item.sourceSize) * 100))
                  : 0;
                return (
                  <div key={item.id} className={`flex items-center gap-2 p-1.5 transition ${isSelected ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                  <button type="button" onClick={() => toggle(item.id)} className="flex min-w-0 flex-1 items-center gap-3 p-1.5 text-left">
                    <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={urls[item.id]} alt={item.name} className="h-full w-full object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800" title={item.name}>
                        {middleEllipsisFileName(item.name, 42)}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span>{item.format.toUpperCase()}</span>
                        <span>{formatBytes(item.size)}</span>
                        <span>{formatBytes(item.sourceSize)} → {formatBytes(item.size)}</span>
                        <span className="font-semibold text-emerald-600">-{savedPercent}%</span>
                      </span>
                    </span>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${isSelected ? "border-[#2f65cf] bg-[#2f65cf] text-white" : "border-slate-300 text-transparent"}`}>
                      <FiCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </button>
                  <button type="button" onClick={() => void removeItem(item.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={labels.removeCachedImage} title={labels.removeCachedImage}><FiTrash2 className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center text-center">
              <FiImage className="h-8 w-8 text-slate-300" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-slate-600">{labels.noCompressedImages}</p>
              <button type="button" onClick={() => void onCompress()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2457bd]">
                <FiZap className="h-4 w-4" aria-hidden="true" />
                {labels.goCompress}
              </button>
            </div>
          )}
        </div>

        {items.length ? (
          <div className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5">
            <button type="button" onClick={onClose} className="h-9 rounded-md px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100">{labels.cancel}</button>
            <button type="button" onClick={addSelected} disabled={!selected.size} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40">
              {labels.addSelected}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
