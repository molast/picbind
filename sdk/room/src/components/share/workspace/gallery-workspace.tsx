"use client";

import React from "react";
import { FiLoader, FiTerminal, FiUploadCloud } from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import type { ActivityItem, ConnectionState, ImageReactionSignal, RoomImage } from "../share-room-types";
import GalleryImageCard from "./gallery-image-card";
import ImageCompressionDialog from "./image-compression-dialog";
import ImageCropDialog from "./image-crop-dialog";
import ImageResizeDialog from "./image-resize-dialog";
import ImageConversionDialog from "./image-conversion-dialog";
import ImageColorAdjustmentDialog from "./image-color-adjustment-dialog";
import LocalImageList from "./local-image-list";
import ImageResultDialog, {
  type ProcessedImageAction,
  type ProcessedImageActionOutcome,
  type ProcessedImageActionStage,
  type ProcessedImageResult,
} from "./image-result-dialog";
import ImageDeleteConfirmDialog from "./image-delete-confirm-dialog";
import OperationLogDialog from "./operation-log-dialog";

type GalleryWorkspaceProps = {
  inputRef: React.RefObject<HTMLInputElement>;
  images: RoomImage[];
  connection: ConnectionState;
  isSending: boolean;
  isDragging: boolean;
  labels: ShareRoomLabels;
  onChooseImages(): void;
  onFiles(files: FileList | File[]): void | Promise<void>;
  onDraggingChange(dragging: boolean): void;
  onPreview(imageId: string): void;
  onPlaceholderMeasured(imageId: string, width: number, height: number): void;
  onReview(imageId: string): void;
  onSend(image: RoomImage): void | Promise<void>;
  onCancelTransfer(image: RoomImage): void;
  onDelete(image: RoomImage): void | Promise<void>;
  onDeleteLocal(image: RoomImage): void | Promise<void>;
  onArchiveToLibrary(image: RoomImage): void | Promise<void>;
  onMoveToOutbox(image: RoomImage): void | Promise<void>;
  onMoveToLibrary(image: RoomImage): void | Promise<void>;
  onTogglePin(image: RoomImage): void;
  onLike(image: RoomImage): void;
  onWant(image: RoomImage): void;
  reactionSignals: Record<string, ImageReactionSignal>;
  onProcessResult(source: RoomImage, result: ProcessedImageResult, action: ProcessedImageAction, report: (stage: ProcessedImageActionStage) => void): Promise<ProcessedImageActionOutcome>;
  onResolveRejectedImage(imageId: string, save: boolean): Promise<void>;
  compressionRequest: RoomImage | null;
  onCompressionRequestConsumed(): void;
  operationLogs: ActivityItem[];
  onClearOperationLogs(): void | Promise<void>;
};

export default function GalleryWorkspace({
  inputRef,
  images,
  connection,
  isSending,
  isDragging,
  labels,
  onChooseImages,
  onFiles,
  onDraggingChange,
  onPreview,
  onPlaceholderMeasured,
  onReview,
  onSend,
  onCancelTransfer,
  onDelete,
  onDeleteLocal,
  onArchiveToLibrary,
  onMoveToOutbox,
  onMoveToLibrary,
  onTogglePin,
  onLike,
  onWant,
  reactionSignals,
  onProcessResult,
  onResolveRejectedImage,
  compressionRequest,
  onCompressionRequestConsumed,
  operationLogs,
  onClearOperationLogs,
}: GalleryWorkspaceProps) {
  const [compressionImage, setCompressionImage] = React.useState<RoomImage | null>(null);
  const [conversionImage, setConversionImage] = React.useState<RoomImage | null>(null);
  const [cropImage, setCropImage] = React.useState<RoomImage | null>(null);
  const [resizeImage, setResizeImage] = React.useState<RoomImage | null>(null);
  const [adjustmentImage, setAdjustmentImage] = React.useState<RoomImage | null>(null);
  const [processedResult, setProcessedResult] = React.useState<{ source: RoomImage; result: ProcessedImageResult } | null>(null);
  const [localPanelCollapsed, setLocalPanelCollapsed] = React.useState(false);
  const [selectedVersions, setSelectedVersions] = React.useState<Record<string, string>>({});
  const [deleteCandidate, setDeleteCandidate] = React.useState<RoomImage | null>(null);
  const [operationLogOpen, setOperationLogOpen] = React.useState(false);
  React.useEffect(() => {
    if (!compressionRequest) return;
    setCompressionImage(compressionRequest);
    onCompressionRequestConsumed();
  }, [compressionRequest, onCompressionRequestConsumed]);
  const localImages = React.useMemo(
    () => images
      .filter((image) => image.direction === "sent" && image.workspaceLocation === "library")
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [images],
  );
  const outboxImages = React.useMemo(
    () => images
      .filter((image) => image.direction === "received" || image.workspaceLocation !== "library")
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [images],
  );
  const versionGroups = React.useMemo(() => {
    const groups = new Map<string, RoomImage[]>();
    outboxImages.forEach((image) => {
      const rootId = image.rootImageId || image.id;
      groups.set(rootId, [...(groups.get(rootId) || []), image]);
    });
    return [...groups.entries()].map(([rootId, versions]) => {
      const latest = [...versions].sort((a, b) => b.version - a.version || b.createdAt - a.createdAt)[0];
      const selectedId = selectedVersions[rootId];
      return {
        rootId,
        versions,
        image: versions.find((item) => item.id === selectedId) || latest,
      };
    }).sort((a, b) => {
      const aPinned = a.image.pinnedAt ?? 0;
      const bPinned = b.image.pinnedAt ?? 0;
      if (aPinned || bPinned) {
        if (!aPinned) return 1;
        if (!bPinned) return -1;
        if (aPinned !== bPinned) return bPinned - aPinned;
      }
      if (a.image.wantedByPeer !== b.image.wantedByPeer) {
        return a.image.wantedByPeer ? -1 : 1;
      }
      return (b.image.updatedAt ?? b.image.createdAt) - (a.image.updatedAt ?? a.image.createdAt);
    });
  }, [outboxImages, selectedVersions]);
  const finishProcessing = React.useCallback((source: RoomImage, result: ProcessedImageResult) => {
    setCompressionImage(null);
    setConversionImage(null);
    setCropImage(null);
    setResizeImage(null);
    setAdjustmentImage(null);
    setProcessedResult({ source, result });
  }, []);
  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">{labels.gallery}</h1>
            <button
              type="button"
              onClick={() => setOperationLogOpen(true)}
              className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-[#2f65cf]"
              aria-label={labels.operationLog}
              title={labels.operationLog}
            >
              <FiTerminal className="h-4 w-4" aria-hidden="true" />
              {operationLogs.length ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
            </button>
          </div>
          <p className="mt-1 text-sm text-slate-500">{labels.cached}</p>
        </div>
        <button
          type="button"
          onClick={onChooseImages}
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
        className={`grid min-h-[260px] flex-1 overflow-hidden rounded-lg border-2 border-dashed transition lg:transition-[grid-template-columns] ${
          localPanelCollapsed
            ? "lg:grid-cols-[44px_minmax(0,1fr)]"
            : "lg:grid-cols-[220px_minmax(0,1fr)]"
        } ${
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
        <LocalImageList images={localImages} labels={labels} disabled={connection !== "connected"} collapsed={localPanelCollapsed} onCollapsedChange={setLocalPanelCollapsed} onChoose={onChooseImages} onAdd={onMoveToOutbox} onDelete={onDeleteLocal} />
        <section className="min-h-0 min-w-0 overflow-y-auto" aria-label={labels.outbox}>
          {versionGroups.length ? (
          <div
            className="grid gap-x-8 gap-y-3 p-3 pr-8 sm:gap-y-4 sm:p-4 sm:pr-8"
            style={{
              gridTemplateColumns:
                "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
            }}
          >
            {versionGroups.map(({ rootId, image, versions }) => (
              <GalleryImageCard
                key={rootId}
                image={image}
                connection={connection}
                isSending={isSending}
                labels={labels}
                onPreview={onPreview}
                onPlaceholderMeasured={onPlaceholderMeasured}
                onReview={onReview}
                onSend={onSend}
                onCancelTransfer={onCancelTransfer}
                onDelete={setDeleteCandidate}
                onMoveToLibrary={onMoveToLibrary}
                onTogglePin={onTogglePin}
                onLike={onLike}
                onWant={onWant}
                reactionSignal={reactionSignals[image.id]}
                onConvert={setConversionImage}
                onCompress={setCompressionImage}
                onCrop={setCropImage}
                onResize={setResizeImage}
                onAdjust={setAdjustmentImage}
                versions={versions}
                onSelectVersion={(imageId) => setSelectedVersions((current) => ({ ...current, [rootId]: imageId }))}
              />
            ))}
          </div>
        ) : <div className="h-full min-h-[260px]" aria-hidden="true" />}
        </section>
      </div>
      <ImageCompressionDialog
        image={compressionImage}
        labels={labels}
        onClose={() => setCompressionImage(null)}
        onSave={finishProcessing}
      />
      <ImageConversionDialog
        image={conversionImage}
        labels={labels}
        onClose={() => setConversionImage(null)}
        onSave={finishProcessing}
      />
      <ImageCropDialog
        image={cropImage}
        labels={labels}
        onClose={() => setCropImage(null)}
        onSave={finishProcessing}
      />
      <ImageResizeDialog
        image={resizeImage}
        labels={labels}
        onClose={() => setResizeImage(null)}
        onSave={finishProcessing}
      />
      <ImageColorAdjustmentDialog
        image={adjustmentImage}
        labels={labels}
        onClose={() => setAdjustmentImage(null)}
        onSave={finishProcessing}
      />
      <ImageResultDialog source={processedResult?.source || null} result={processedResult?.result || null} labels={labels} onClose={() => setProcessedResult(null)} onAction={onProcessResult} onResolveRejected={onResolveRejectedImage} />
      <ImageDeleteConfirmDialog
        image={deleteCandidate}
        labels={labels}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={onDelete}
        onMoveToLibrary={onArchiveToLibrary}
      />
      <OperationLogDialog
        open={operationLogOpen}
        logs={operationLogs}
        labels={labels}
        onClose={() => setOperationLogOpen(false)}
        onClear={onClearOperationLogs}
      />
    </div>
  );
}
