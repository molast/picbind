import React from "react";
import { FaWeixin } from "react-icons/fa";
import { FiArrowRight, FiChevronLeft, FiChevronRight, FiGrid, FiImage, FiList } from "react-icons/fi";
import { TbGridDots } from "react-icons/tb";
import { getLang, getWorkspaceLabels, type WorkspaceEditorLabels } from "../../locales";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import {
  WorkspaceGalleryCard,
  type WorkspaceCardOperation,
  type WorkspaceGalleryViewMode,
} from "./workspace-gallery-card";
import { WorkspaceLibraryItem } from "./workspace-library";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;
const WORKING_VIEW_MODE_KEY = "picbind.workspace.working-view-mode";

function isWorkingViewMode(value: string | null): value is WorkspaceGalleryViewMode {
  return value === "list" || value === "grid" || value === "compact";
}

export function WorkspaceGallery({
  libraryCollapsed,
  libraryImages,
  workingImages,
  workingImagesSorted,
  selectedId,
  role,
  dragging,
  onlinePeers,
  requestingSourceIds,
  movingToWorkingImageIds,
  processingImageIds,
  collaborationCardPreviewFor,
  messagingVisible,
  messagingConnected,
  messagingUnreadCount,
  messagingBusy,
  messagingLabels,
  onToggleLibrary,
  onUpload,
  onImageDimensions,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onSelect,
  onAddToWorking,
  onDeleteLibrary,
  onPin,
  onMoveToLibrary,
  onRequestSource,
  onDownload,
  onSend,
  onOpenMessagingChat,
  onMaximize,
  onOperation,
}: {
  libraryCollapsed: boolean;
  libraryImages: WorkspaceImage[];
  workingImages: WorkspaceImage[];
  workingImagesSorted: WorkspaceImage[];
  selectedId?: string | null;
  role: WorkspaceIdentity["role"];
  dragging: boolean;
  onlinePeers: number;
  requestingSourceIds: Set<string>;
  movingToWorkingImageIds: ReadonlySet<string>;
  processingImageIds: ReadonlySet<string>;
  collaborationCardPreviewFor(image: WorkspaceImage): string | undefined;
  messagingVisible: boolean;
  messagingConnected: boolean;
  messagingUnreadCount: number;
  messagingBusy: boolean;
  messagingLabels: WorkspaceEditorLabels;
  onToggleLibrary(): void;
  onUpload(): void;
  onImageDimensions(image: WorkspaceImage, width: number, height: number): void;
  onDragEnter(event: React.DragEvent<HTMLDivElement>): void;
  onDragOver(event: React.DragEvent<HTMLDivElement>): void;
  onDragLeave(event: React.DragEvent<HTMLDivElement>): void;
  onDrop(event: React.DragEvent<HTMLDivElement>): void;
  onSelect(imageId: string): void;
  onAddToWorking(image: WorkspaceImage): void;
  onDeleteLibrary(image: WorkspaceImage): void;
  onPin(image: WorkspaceImage): void;
  onMoveToLibrary(image: WorkspaceImage): void;
  onRequestSource(image: WorkspaceImage): void;
  onDownload(image: WorkspaceImage): Promise<boolean>;
  onSend(image: WorkspaceImage): void;
  onOpenMessagingChat(): void;
  onMaximize(image: WorkspaceImage): void;
  onOperation(image: WorkspaceImage, operation: WorkspaceCardOperation): void;
}) {
  const [viewMode, setViewMode] = React.useState<WorkspaceGalleryViewMode>("grid");
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WORKING_VIEW_MODE_KEY);
      if (isWorkingViewMode(stored)) setViewMode(stored);
    } catch {
      // Keep the default grid view when local storage is unavailable.
    }
  }, []);
  const changeViewMode = React.useCallback((mode: WorkspaceGalleryViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(WORKING_VIEW_MODE_KEY, mode);
    } catch {
      // The in-memory selection remains active for this Workspace session.
    }
  }, []);
  const workingLayoutClass = viewMode === "list"
    ? "grid grid-cols-1 gap-2 p-4"
    : viewMode === "compact"
      ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,128px),160px))] items-start gap-3 p-3"
      : "grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-8 gap-y-4 p-4 sm:pr-8";
  const viewOptions: Array<{ mode: WorkspaceGalleryViewMode; label: string; icon: React.ReactNode }> = [
    { mode: "list", label: text("workingListView"), icon: <FiList /> },
    { mode: "grid", label: text("workingGridView"), icon: <FiGrid /> },
    { mode: "compact", label: text("workingCompactView"), icon: <TbGridDots /> },
  ];

  return <div
    className={`grid min-h-[360px] flex-1 overflow-hidden rounded-lg border-2 border-dashed bg-white/80 transition ${dragging ? "border-[#2f65cf] bg-blue-50" : "border-[#c9d0da]"} ${libraryCollapsed ? "sm:grid-cols-[44px_minmax(0,1fr)]" : "sm:grid-cols-[240px_minmax(0,1fr)]"}`}
    onDragEnter={onDragEnter}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    {libraryCollapsed
      ? <aside className="hidden min-h-0 flex-col items-center border-r border-slate-200 bg-slate-50/80 pt-2 sm:flex">
          <button type="button" onClick={onToggleLibrary} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title={text("originLibrary")}><FiChevronRight /></button>
          <button type="button" onClick={role === "owner" ? onUpload : undefined} className="relative mt-2 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title={text("originLibrary")}>
            <FiImage />
            {libraryImages.length ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[#2f65cf] px-1 text-center text-[8px] text-white">{Math.min(libraryImages.length, 99)}</span> : null}
          </button>
        </aside>
      : <aside className="hidden min-h-0 min-w-0 flex-col border-r border-slate-200 bg-slate-50/80 sm:flex">
          <div className="flex items-start justify-between border-b border-slate-200 p-3">
            <div className="min-w-0"><h2 className="text-xs font-semibold text-slate-800">{text("originLibrary")}</h2><p className="mt-0.5 text-[10px] leading-4 text-slate-500">{text("chooseOriginal")}</p></div>
            <button type="button" onClick={onToggleLibrary} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title={text("originLibrary")}><FiChevronLeft /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {libraryImages.length
              ? libraryImages.map((image) => <WorkspaceLibraryItem
                  key={image.imageId}
                  image={image}
                  role={role}
                  selected={selectedId === image.imageId}
                  processing={movingToWorkingImageIds.has(image.imageId)}
                  onSelect={() => onSelect(image.imageId)}
                  onAdd={() => onAddToWorking(image)}
                  onDelete={() => onDeleteLibrary(image)}
                  onDimensions={(width, height) => onImageDimensions(image, width, height)}
                />)
              : role === "owner"
                ? <button type="button" onClick={onUpload} className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-400 hover:bg-white/70 hover:text-[#2f65cf]"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50"><FiImage /></span><strong className="text-xs text-slate-700">{text("chooseOrDropOriginals")}</strong><span className="text-[10px]">{text("pngFormats")}</span></button>
                : <div className="flex h-full min-h-40 items-center justify-center p-4 text-center text-xs text-slate-400">{text("originImagesOwner")}</div>}
          </div>
        </aside>}
    <section className="flex min-h-0 min-w-0 flex-col" aria-label={text("workingProcessing")}>
      <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="min-w-0"><h2 className="truncate text-xs font-semibold text-slate-800">{text("workingProcessing")}</h2><p className="mt-0.5 truncate text-[10px] text-slate-500">{text("processCollaborate")}</p></div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <div className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={text("workingViewMode")}>
            {viewOptions.map(({ mode, label, icon }) => <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={viewMode === mode}
              aria-label={label}
              title={label}
              onClick={() => changeViewMode(mode)}
              className={`flex h-7 w-7 items-center justify-center rounded text-[15px] transition ${viewMode === mode ? "bg-white text-[#2f65cf] shadow-sm" : "text-slate-400 hover:text-slate-700"}`}
            >{icon}</button>)}
          </div>
          {messagingVisible ? <button type="button" onClick={onOpenMessagingChat} disabled={!messagingConnected} className="relative flex h-8 w-8 items-center justify-center rounded-md text-[#07c160] transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-slate-300" title={messagingConnected ? messagingLabels.messagingOpenChat : messagingLabels.messagingConnectBeforeSending} aria-label={messagingConnected ? messagingLabels.messagingOpenChat : messagingLabels.messagingConnectBeforeSending}><FaWeixin className="h-[18px] w-[18px]" />{messagingUnreadCount ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{Math.min(99, messagingUnreadCount)}</span> : null}</button> : null}
          <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{workingImages.length}</span>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {workingImages.length
          ? <div className={workingLayoutClass}>{workingImagesSorted.map((image) => <WorkspaceGalleryCard
              key={image.imageId}
              image={image}
              role={role}
              selected={selectedId === image.imageId}
              onlinePeers={onlinePeers}
              requestingSource={requestingSourceIds.has(image.imageId)}
              processing={processingImageIds.has(image.imageId)}
              viewMode={viewMode}
              previewUrl={collaborationCardPreviewFor(image)}
              showMessagingSend={messagingVisible}
              messagingConnected={messagingConnected}
              messagingBusy={messagingBusy}
              messagingSendLabel={messagingLabels.messagingSendImage}
              messagingUnavailableLabel={messagingLabels.messagingConnectBeforeSending}
              onSelect={() => onSelect(image.imageId)}
              onPin={() => onPin(image)}
              onMoveToLibrary={() => onMoveToLibrary(image)}
              onRequestSource={() => onRequestSource(image)}
              onDownload={() => onDownload(image)}
              onSend={() => onSend(image)}
              onMaximize={() => onMaximize(image)}
              onOperation={(operation) => onOperation(image, operation)}
            />)}</div>
          : <div className="flex h-full min-h-[300px] w-full flex-col items-center justify-center px-6 text-center text-slate-400"><FiArrowRight className="mb-3 h-7 w-7" /><strong className="text-sm text-slate-600">{text("workingEmpty")}</strong><span className="mt-1 text-xs">{text("addFromOrigin")}</span></div>}
      </div>
    </section>
  </div>;
}
