"use client";

import React from "react";
import DropZone from "./drop-zone";
import { Button } from "./ui/button";
import { twMerge } from "tailwind-merge";
import { compressWithWasm } from "@/utils/wasm";
import Locale from "@/locales";

export type CompressListItem = {
  id: string;
  file: File;
  previewUrl: string;
  compressedUrl?: string;
  compressedFileName?: string;
  originSize: number;
  compressedSize?: number;
  percent?: number;
  status: "waiting" | "processing" | "done" | "error";
};

type ExternalItem = {
  file: File | null;
  compressedUrl?: string;
  compressedFileName?: string;
  compressedSize?: number | null;
  percent?: number;
  status?: CompressListItem["status"];
};

interface UploadZoneProps {
  externalItem?: ExternalItem;
  onSelectItem?: (item: CompressListItem | null) => void;
  onItemsChange?: (items: CompressListItem[]) => void;
}

const MAX_FILES = 20;
const ALLOWED_FILES = ["image/png", "image/jpeg", "image/webp"];

const formatSize = (size: number) => {
  if (size > 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size > 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
};

const createItem = (file: File): CompressListItem => ({
  id: crypto.randomUUID(),
  file,
  previewUrl: URL.createObjectURL(file),
  originSize: file.size,
  status: "waiting",
});

export default function UploadZone({ externalItem, onSelectItem, onItemsChange }: UploadZoneProps) {
  const compressLocale = Locale.Photo.Compress;
  const [items, setItems] = React.useState<CompressListItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const itemsRef = React.useRef<CompressListItem[]>([]);

  const handleFiles = React.useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((file) =>
      ALLOWED_FILES.includes(file.type),
    );

    if (!list.length) return;

    setItems((prev) => {
      const remain = MAX_FILES - prev.length;
      const next = list.slice(0, remain).map(createItem);
      if (next[0] && !selectedId) {
        setSelectedId(next[0].id);
      }
      return [...prev, ...next];
    });
  }, [selectedId]);

  React.useEffect(() => {
    itemsRef.current = items;
    if (!selectedId && items[0]) {
      setSelectedId(items[0].id);
      return;
    }

    const current = items.find((it) => it.id === selectedId) ?? null;
    onSelectItem?.(current);
    onItemsChange?.(items);
  }, [items, onItemsChange, onSelectItem, selectedId]);

  React.useEffect(() => {
    if (!externalItem?.file) return;

    const externalFile = externalItem.file;
    const externalId = `external-${externalFile.name}-${externalFile.size}-${externalFile.lastModified}`;
    const nextPreviewUrl = URL.createObjectURL(externalFile);

    setItems((prev) => {
      const currentExternal = prev.find((it) => it.id.startsWith("external-"));
      if (currentExternal?.previewUrl) {
        URL.revokeObjectURL(currentExternal.previewUrl);
      }

      const rest = prev.filter((it) => !it.id.startsWith("external-"));
      return [
        {
          id: externalId,
          file: externalFile,
          previewUrl: nextPreviewUrl,
          originSize: externalFile.size,
          compressedUrl: externalItem.compressedUrl,
          compressedFileName: externalItem.compressedFileName,
          compressedSize: externalItem.compressedSize ?? undefined,
          percent: externalItem.percent,
          status: externalItem.status ?? "waiting",
        },
        ...rest,
      ];
    });

    setSelectedId((prev) => {
      if (!prev || prev.startsWith("external-")) {
        return externalId;
      }
      return prev;
    });
  }, [
    externalItem?.compressedSize,
    externalItem?.compressedUrl,
    externalItem?.file,
    externalItem?.percent,
    externalItem?.status,
  ]);

  React.useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => {
        if (it.previewUrl) {
          URL.revokeObjectURL(it.previewUrl);
        }
        if (it.compressedUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(it.compressedUrl);
        }
      });
    };
  }, []);

  const handleClickUpload = () => {
    fileRef.current?.click();
  };

  const handleBatchCompress = async () => {
    setItems((prev) =>
      prev.map((it) =>
        it.status === "waiting" ? { ...it, status: "processing" } : it,
      ),
    );

    for (const item of items) {
      if (item.status !== "waiting") continue;
      try {
        const compressed = await compressWithWasm(item.file, 80);
        const url = URL.createObjectURL(compressed.blob);
        const size = compressed.blob.size;
        const percent = Math.max(
          0,
          Math.round(((item.originSize - size) / item.originSize) * 100),
        );
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  compressedUrl: url,
                  compressedFileName: compressed.fileName,
                  compressedSize: size,
                  percent,
                  status: "done",
                }
              : it,
          ),
        );
      } catch (_error) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, status: "error" } : it,
          ),
        );
      }
    }
  };

  return (
    <div className="w-full flex flex-col space-y-3">
      <DropZone onDrop={handleFiles}>
        <div
          className={twMerge(
            "w-full rounded-2xl border-2 border-dashed border-emerald-200/80 bg-emerald-900/40 px-4 py-6",
            "flex flex-col items-center justify-center text-center cursor-pointer backdrop-blur-sm",
          )}
          onClick={handleClickUpload}
        >
          <p className="text-sm font-medium text-emerald-50">
            {compressLocale.dropzoneTitle}
          </p>
          <p className="mt-1 text-xs text-emerald-100/80">
            {compressLocale.dropzoneLimit(MAX_FILES)}
          </p>
        </div>
      </DropZone>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept={ALLOWED_FILES.join(",")}
        onChange={(ev) => handleFiles(ev.currentTarget.files ?? [])}
      />

      <div className="w-full rounded-xl bg-slate-950/90 text-slate-50 text-xs overflow-hidden border border-white/10">
        <div className="px-4 py-2 flex items-center justify-between bg-slate-900/90">
          <div className="flex flex-col">
            <span className="font-semibold">{compressLocale.selectedCount(items.length)}</span>
            <span className="text-[11px] text-slate-300">
              {compressLocale.batchHint}
            </span>
          </div>
        </div>

        <div className="max-h-56 overflow-auto">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setSelectedId(it.id)}
              className={twMerge(
                "w-full px-4 py-2 flex items-center justify-between border-t border-slate-800 text-left transition-colors",
                selectedId === it.id ? "bg-white/10" : "hover:bg-white/5",
              )}
            >
              <div className="flex items-center space-x-2">
                <div className="h-8 w-8 rounded overflow-hidden bg-slate-700 ring-1 ring-white/10">
                  <img
                    src={it.previewUrl}
                    alt={it.file.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="max-w-[160px] truncate text-[11px]">
                    {it.file.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatSize(it.originSize)}
                    {it.compressedSize ? ` -> ${formatSize(it.compressedSize)}` : ""}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end text-[10px] space-y-1">
                {it.status === "processing" && (
                  <span className="text-emerald-300">{compressLocale.compressing}</span>
                )}
                {it.status === "done" && (
                  <>
                    <span className="text-emerald-400">
                      {compressLocale.savedShort(it.percent ?? 0)}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(it.id);
                        }}
                        className="text-slate-300 hover:text-white underline"
                      >
                        {compressLocale.compareAction}
                      </button>
                      {it.compressedUrl && (
                        <a
                          href={it.compressedUrl}
                          download={it.compressedFileName || it.file.name}
                          onClick={(event) => event.stopPropagation()}
                          className="text-emerald-300 hover:text-emerald-200 underline"
                        >
                          {compressLocale.downloadAction}
                        </a>
                      )}
                    </div>
                  </>
                )}
                {it.status === "error" && (
                  <span className="text-red-400">{compressLocale.failed}</span>
                )}
                {it.status === "waiting" && (
                  <span className="text-slate-400">{compressLocale.waiting}</span>
                )}
              </div>
            </button>
          ))}

          {!items.length && (
            <div className="px-4 py-6 text-center text-slate-500 text-[11px]">
              {compressLocale.emptyList}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-800 flex justify-between items-center">
          <span className="text-[11px] text-slate-400">
            {compressLocale.batchFooter}
          </span>
          <Button
            size="sm"
            className="text-xs"
            disabled={!items.some((it) => it.status === "waiting")}
            onClick={handleBatchCompress}
          >
            {compressLocale.batchAction}
          </Button>
        </div>
      </div>
    </div>
  );
}
