"use client";

import React from "react";
import DropZone from "./drop-zone";
import { Button } from "./ui/button";
import { twMerge } from "tailwind-merge";
import { compressWithWasm } from "@/utils/wasm";

type ZoneItem = {
  id: string;
  file: File;
  previewUrl: string;
  compressedUrl?: string;
  originSize: number;
  compressedSize?: number;
  percent?: number;
  status: "waiting" | "processing" | "done" | "error";
};

const MAX_FILES = 20;
const ALLOWED_FILES = ["image/png", "image/jpeg", "image/webp"];

const formatSize = (size: number) => {
  if (size > 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(size / 1024)} KB`;
};

export default function UploadZone() {
  const [items, setItems] = React.useState<ZoneItem[]>([]);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const handleFiles = React.useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((file) =>
      ALLOWED_FILES.includes(file.type),
    );

    if (!list.length) return;

    setItems((prev) => {
      const remain = MAX_FILES - prev.length;
      const next = list.slice(0, remain).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        originSize: file.size,
        status: "waiting" as const,
      }));
      return [...prev, ...next];
    });
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
        const blob = await compressWithWasm(item.file, 80);
        const url = URL.createObjectURL(blob);
        const size = blob.size;
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
                  compressedSize: size,
                  percent,
                  status: "done",
                }
              : it,
          ),
        );
      } catch (e) {
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
            拖拽多张图片到这里，或点击选择
          </p>
          <p className="mt-1 text-xs text-emerald-100/80">
            最多 {MAX_FILES} 张，每张不超过 5MB
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
            <span className="font-semibold">
              已选中 {items.length} 张图片
            </span>
            <span className="text-[11px] text-slate-300">
              支持批量压缩，完成后可逐张下载
            </span>
          </div>
        </div>

        <div className="max-h-56 overflow-auto">
          {items.map((it) => (
            <div
              key={it.id}
              className="px-4 py-2 flex items-center justify-between border-t border-slate-800"
            >
              <div className="flex items-center space-x-2">
                <div className="h-8 w-8 rounded overflow-hidden bg-slate-700">
                  <img
                    src={it.previewUrl}
                    alt={it.file.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="max-w-[120px] truncate text-[11px]">
                    {it.file.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatSize(it.originSize)}
                    {it.compressedSize
                      ? ` → ${formatSize(it.compressedSize)}`
                      : ""}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end text-[10px] space-y-1">
                {it.status === "processing" && (
                  <span className="text-emerald-300">压缩中…</span>
                )}
                {it.status === "done" && (
                  <>
                    <span className="text-emerald-400">
                      节省 {it.percent}% 文件体积
                    </span>
                    {it.compressedUrl && (
                      <a
                        href={it.compressedUrl}
                        download={it.file.name.replace(/\.(png|webp)$/i, ".jpg")}
                        className="text-emerald-300 hover:text-emerald-200 underline"
                      >
                        下载
                      </a>
                    )}
                  </>
                )}
                {it.status === "error" && (
                  <span className="text-red-400">压缩失败</span>
                )}
              </div>
            </div>
          ))}

          {!items.length && (
            <div className="px-4 py-6 text-center text-slate-500 text-[11px]">
              暂无批量图片，先在上方区域拖拽或点击上传。
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-800 flex justify-between items-center">
          <span className="text-[11px] text-slate-400">
            批量压缩会使用与左侧相同的 WASM 压缩算法。
          </span>
          <Button
            size="sm"
            className="text-xs"
            disabled={!items.length}
            onClick={handleBatchCompress}
          >
            一键批量压缩
          </Button>
        </div>
      </div>
    </div>
  );
}

