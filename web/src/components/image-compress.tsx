import React from "react";
import { twMerge } from "tailwind-merge";
import { Tool, Status } from "@/types";
import AlertBar from "./alert-bar";
import { ConfirmModal } from "./confirm-modal";
import UploadZone, { type CompressListItem } from "./upload-zone";
import { compressWithWasm } from "@/utils/wasm";
import Locale from "@/locales";

const formatSize = (size: number) => {
  if (size > 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (size > 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${size} B`;
};

interface PropsData {
  expand: boolean;
  file: File | null;
  tool: Tool;
  status: string;
  setStatus: (status: Status) => void;
  result: string;
  setResult: (result: string) => void;
  onArchiveChange?: (items: Array<{ name: string; url: string }> ) => void;
}

function ImageCompress({
  expand,
  file,
  tool,
  status,
  setStatus,
  result,
  setResult,
  onArchiveChange,
}: PropsData) {
  const compressLocale = Locale.Photo.Compress;
  const [errorInfo, setErrorInfo] = React.useState<any>(null);
  const [compressing, setCompressing] = React.useState(false);
  const [compressedSize, setCompressedSize] = React.useState<number | null>(null);
  const [compareItem, setCompareItem] = React.useState<CompressListItem | null>(null);
  const [items, setItems] = React.useState<CompressListItem[]>([]);

  React.useEffect(() => {
    if (!file) {
      setResult("");
      setCompressedSize(null);
      return;
    }

    let compressedObjectUrl: string | null = null;

    const run = async () => {
      try {
        setCompressing(true);
        setStatus("Pending");
        setErrorInfo(null);

        const compressedBlob = await compressWithWasm(file, 80);
        compressedObjectUrl = URL.createObjectURL(compressedBlob);
        setCompressedSize(compressedBlob.size);
        setResult(compressedObjectUrl);
        setStatus("Done");
      } catch (err) {
        console.error(err);
        setErrorInfo(err);
        setCompressedSize(null);
        setStatus("Error");
      } finally {
        setCompressing(false);
      }
    };

    run();

    return () => {
      if (compressedObjectUrl) {
        URL.revokeObjectURL(compressedObjectUrl);
      }
    };
  }, [file, setResult, setStatus]);

  const handleStop = () => {
    setStatus("Finish");
  };

  const displayOriginalSize = compareItem?.originSize ?? 0;
  const displayCompressedSize = compareItem?.compressedSize ?? null;
  const displaySavedSize =
    displayCompressedSize !== null
      ? Math.max(displayOriginalSize - displayCompressedSize, 0)
      : 0;
  const displaySavedPercent =
    displayCompressedSize !== null && displayOriginalSize > 0
      ? Math.round((displaySavedSize / displayOriginalSize) * 100)
      : (compareItem?.percent ?? 0);

  React.useEffect(() => {
    const archiveItems = items
      .filter((it) => it.status === "done" && it.compressedUrl)
      .map((it) => ({
        name: it.file.name.replace(/\.(png|webp)$/i, ".jpg"),
        url: it.compressedUrl as string,
      }));
    onArchiveChange?.(archiveItems);
  }, [items, onArchiveChange]);

  return (
    <div
      id="image-compress"
      className="w-full h-full flex flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900"
    >
      <div className="flex-1 w-full flex flex-col items-center justify-center px-4">
        {status === "Error" && (
          <div className="mb-4 w-full max-w-2xl">
            <AlertBar errInfo={errorInfo} />
          </div>
        )}
        {compareItem && (
          <div className="mb-4 grid w-full max-w-5xl gap-4 md:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-200">
                {compressLocale.originalTitle}
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="flex min-h-[260px] items-center justify-center">
                  <img
                    src={compareItem.previewUrl}
                    alt={compareItem.file.name || "original image"}
                    className="max-h-[360px] w-auto max-w-full rounded-lg object-contain"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {compressLocale.sourceLabel}
                  </div>
                  <div className="mt-3 break-all font-medium text-slate-100">
                    {compareItem.file.name || "-"}
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">{compressLocale.originalSize}</span>
                      <span className="font-medium text-slate-100">
                        {formatSize(displayOriginalSize)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">{compressLocale.imageType}</span>
                      <span className="font-medium uppercase text-slate-100">
                        {compareItem.file.type.split("/")[1] || "-"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-slate-200">
                {compressLocale.resultTitle}
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="flex min-h-[260px] items-center justify-center">
                  {compareItem.compressedUrl ? (
                    <img
                      src={compareItem.compressedUrl}
                      alt="compressed image"
                      className="max-h-[360px] w-auto max-w-full rounded-lg object-contain"
                    />
                  ) : (
                    <span className="text-sm text-slate-400">
                      {compareItem.status === "processing"
                        ? compressLocale.compressing
                        : compressLocale.waitingResult}
                    </span>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    {compressLocale.resultLabel}
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">{compressLocale.compressedSize}</span>
                      <span className="font-medium text-slate-100">
                        {displayCompressedSize !== null ? formatSize(displayCompressedSize) : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">{compressLocale.savedSpace}</span>
                      <span className="font-medium text-emerald-300">
                        {displayCompressedSize !== null ? formatSize(displaySavedSize) : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">{compressLocale.savedPercent}</span>
                      <span className="font-medium text-emerald-300">
                        {displayCompressedSize !== null ? `${displaySavedPercent}%` : "-"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="w-full max-w-2xl">
          <UploadZone
            externalItem={{
              file,
              compressedUrl: result || undefined,
              compressedSize,
              percent:
                compressedSize !== null && file?.size
                  ? Math.round(((file.size - compressedSize) / file.size) * 100)
                  : undefined,
              status:
                compressedSize !== null
                  ? "done"
                  : compressing
                    ? "processing"
                    : "waiting",
            }}
            onSelectItem={setCompareItem}
            onItemsChange={setItems}
          />
        </div>
      </div>

      <div className="w-full h-12 md:h-14" />
      <div
        className={twMerge(
          "action flex justify-between space-x-4 fixed left-0 bottom-0 w-full px-4 py-2 bg-background/95 md:px-12",
          expand && "md:px-12",
        )}
      >
        <div className="text-xs text-slate-400 flex items-center">
          {compressing
            ? compressLocale.working
            : file
              ? compressLocale.doneHint
              : compressLocale.emptyHint}
        </div>
        <ConfirmModal confirm={handleStop} />
      </div>
    </div>
  );
}

export default ImageCompress;
