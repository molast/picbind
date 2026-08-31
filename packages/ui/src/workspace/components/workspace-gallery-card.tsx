import React from "react";
import { FiBookmark, FiCheck, FiDownload, FiLoader, FiMaximize2, FiMoreHorizontal, FiSend, FiTrash2 } from "react-icons/fi";
import { TbPinned, TbPinnedFilled } from "react-icons/tb";
import { getLang, getWorkspaceLabels } from "../../locales";
import { workspaceRenderedDimensions } from "../utils/workspace-image-display";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceImageActionMenu, type WorkspaceCardOperation } from "./workspace-image-action-menu";
import { ImageAddressMedia, WorkspaceImageMedia } from "./workspace-image-media";

export type { WorkspaceCardOperation } from "./workspace-image-action-menu";
export type WorkspaceGalleryViewMode = "list" | "grid" | "compact";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;
const bytes = (size: number) => size < 1024
  ? `${size} B`
  : size < 1024 ** 2
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1024 ** 2).toFixed(1)} MB`;

type WorkspaceGalleryCardProps = {
  image: WorkspaceImage;
  role: WorkspaceIdentity["role"];
  selected: boolean;
  onlinePeers: number;
  requestingSource: boolean;
  processing: boolean;
  viewMode: WorkspaceGalleryViewMode;
  previewUrl?: string;
  showMessagingSend: boolean;
  messagingConnected: boolean;
  messagingBusy: boolean;
  messagingSendLabel: string;
  messagingUnavailableLabel: string;
  onSelect(): void;
  onPin(): void;
  onMoveToLibrary(): void;
  onRequestSource(): void;
  onDownload(): Promise<boolean>;
  onSend(): void;
  onMaximize(): void;
  onOperation(operation: WorkspaceCardOperation): void;
};

export function WorkspaceGalleryCard({
  image, role, selected, onlinePeers, requestingSource, processing, viewMode, previewUrl,
  showMessagingSend, messagingConnected, messagingBusy,
  messagingSendLabel, messagingUnavailableLabel,
  onSelect, onPin, onMoveToLibrary, onRequestSource, onDownload, onSend, onMaximize, onOperation,
}: WorkspaceGalleryCardProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [downloadState, setDownloadState] = React.useState<"idle" | "downloading" | "downloaded">("idle");
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const downloadResetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSource = Boolean(image.sourceCached);
  const hasParameters = Boolean(image.parameterDocument?.operations.length);
  const renderedDimensions = workspaceRenderedDimensions(image);
  const listView = viewMode === "list";
  const compactView = viewMode === "compact";
  const overlayButtonClass = compactView ? "h-6 w-6" : "h-7 w-7";
  const footerButtonClass = compactView ? "h-6 w-6" : "h-7 w-7";

  React.useEffect(() => () => {
    if (downloadResetRef.current) clearTimeout(downloadResetRef.current);
  }, []);

  const handleDownload = React.useCallback(async () => {
    if (downloadState === "downloading") return;
    if (downloadResetRef.current) clearTimeout(downloadResetRef.current);
    setDownloadState("downloading");
    try {
      const started = await onDownload();
      if (!started) {
        setDownloadState("idle");
        return;
      }
      setDownloadState("downloaded");
      downloadResetRef.current = setTimeout(() => setDownloadState("idle"), 1600);
    } catch {
      setDownloadState("idle");
    }
  }, [downloadState, onDownload]);

  return <article className={`relative min-w-0 rounded-md border bg-white transition ${listView ? "sm:grid sm:grid-cols-[200px_minmax(0,1fr)] sm:grid-rows-[auto_auto]" : ""} ${selected ? "border-[#2f65cf] shadow-[0_0_0_2px_#2f65cf]" : "border-slate-200 hover:border-slate-300"}`}>
    <div className={`relative overflow-hidden bg-slate-100 ${listView ? "aspect-[5/3] rounded-t-[5px] sm:row-span-2 sm:h-[112px] sm:aspect-auto sm:rounded-l-[5px] sm:rounded-tr-none" : "aspect-[5/3] rounded-t-[5px]"}`} onClick={onSelect}>
      {previewUrl
        ? <ImageAddressMedia url={previewUrl} alt={image.name} fit="cover" />
        : <WorkspaceImageMedia image={image} role={role} fit="cover" controls />}
      {processing ? <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-slate-950/30" role="status" aria-label={text("workingProcessing")} aria-live="polite"><span className="flex items-center rounded-md bg-white/95 px-3 py-2 text-slate-600 shadow"><FiLoader className="h-4 w-4 animate-spin text-[#2f65cf]" /></span></div> : null}
      <button type="button" onClick={(event) => { event.stopPropagation(); onPin(); }} className={`absolute z-20 flex ${overlayButtonClass} items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf] ${compactView ? "left-1.5 top-1.5" : "left-2 top-2"}`} title={image.pinnedAt ? "Unpin image" : "Pin image"} aria-pressed={Boolean(image.pinnedAt)}>
        {image.pinnedAt ? <TbPinnedFilled className="h-3.5 w-3.5" /> : <TbPinned className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onMaximize(); }} className={`absolute z-20 flex ${overlayButtonClass} items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf] ${compactView ? "right-1.5 top-1.5" : "right-2 top-2"}`} title="Maximize image" aria-label="Maximize image"><FiMaximize2 className="h-3.5 w-3.5" /></button>
      {role === "owner" && !image.shared ? <button type="button" onClick={(event) => { event.stopPropagation(); onMoveToLibrary(); }} className={`absolute z-20 flex ${overlayButtonClass} items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-600 ${compactView ? "bottom-1.5 right-1.5" : "right-20 top-2"}`} title={text("deleteImage")}><FiTrash2 className="h-3.5 w-3.5" /></button> : null}
      {hasSource && !image.shared ? <button ref={menuButtonRef} type="button" onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value); }} className={`absolute z-20 flex ${overlayButtonClass} items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf] ${compactView ? "bottom-1.5 left-1.5" : "right-11 top-2"}`} title={text("imageActions")} aria-expanded={menuOpen}><FiMoreHorizontal className="h-4 w-4" /></button> : null}
      {menuOpen ? <WorkspaceImageActionMenu anchor={menuButtonRef} onClose={() => setMenuOpen(false)} onOperation={(operation) => { setMenuOpen(false); onOperation(operation); }} /> : null}
    </div>
    <button type="button" onClick={onSelect} className={`block w-full text-left ${compactView ? "px-2 pt-1.5" : listView ? "px-3 pt-3 sm:self-end sm:px-4" : "px-3 pt-3"}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <strong className={`truncate font-semibold text-slate-800 ${compactView ? "text-[11px]" : "text-sm"}`}>{image.name}</strong>
        {image.shared ? <span className={`inline-flex h-5 shrink-0 items-center truncate rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700 ${compactView ? "max-w-14" : ""}`}>{text("collaborating")}</span> : null}
      </div>
    </button>
    <div className={`flex text-slate-500 ${compactView ? "min-h-8 items-center justify-between gap-1 px-2 pb-1.5 pt-0.5 text-[9px] leading-3" : listView ? "min-h-12 items-center justify-between gap-2 px-3 pb-3 pt-1 text-xs sm:self-start sm:px-4" : "min-h-12 items-center justify-between gap-2 px-3 pb-3 pt-1 text-xs"}`}>
      <span className="min-w-0 overflow-hidden">
        <span className="block truncate">{!compactView && hasParameters ? `${text("sourceFileSize")} · ` : ""}{bytes(image.size)}</span>
        <span className={`block truncate text-slate-400 ${compactView ? "text-[9px]" : "text-[10px]"}`}>{renderedDimensions.width} × {renderedDimensions.height}</span>
      </span>
      <span className={`flex shrink-0 items-center ${compactView ? "gap-1" : "gap-1.5"}`}>
        {role !== "owner" && !hasSource ? <button type="button" onClick={onRequestSource} disabled={!onlinePeers || requestingSource} className={`flex ${footerButtonClass} items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-60`} title={requestingSource ? text("requestingSource") : text("requestSource")} aria-label={requestingSource ? text("requestingSource") : text("requestSource")}>
          {requestingSource ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiBookmark className="h-3.5 w-3.5" />}
        </button> : null}
        {showMessagingSend && !image.shared ? <button
          type="button"
          onClick={onSend}
          disabled={!hasSource || !messagingConnected || messagingBusy}
          className={`flex ${footerButtonClass} items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-[#2f65cf]/30 hover:bg-blue-50 hover:text-[#2f65cf] disabled:cursor-not-allowed disabled:opacity-35`}
          title={messagingConnected ? messagingSendLabel : messagingUnavailableLabel}
          aria-label={messagingConnected ? messagingSendLabel : messagingUnavailableLabel}
        ><FiSend className="h-3.5 w-3.5" /></button> : null}
        {hasSource ? <button type="button" onClick={() => void handleDownload()} disabled={downloadState === "downloading"} className={`flex ${footerButtonClass} items-center justify-center rounded-md border transition ${downloadState === "downloaded" ? "border-emerald-200 bg-emerald-50 text-emerald-600" : downloadState === "downloading" ? "border-blue-200 bg-blue-50 text-[#2f65cf]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`} title={downloadState === "downloaded" ? text("downloadComplete") : downloadState === "downloading" ? text("downloading") : text("download")} aria-label={downloadState === "downloaded" ? text("downloadComplete") : downloadState === "downloading" ? text("downloading") : text("download")} aria-live="polite">{downloadState === "downloaded" ? <FiCheck className="h-3.5 w-3.5" /> : downloadState === "downloading" ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiDownload className="h-3.5 w-3.5" />}</button> : <button type="button" disabled className={`flex ${footerButtonClass} items-center justify-center rounded-md border border-slate-200 text-slate-300`} title={text("sourceUnavailable")}><FiDownload className="h-3.5 w-3.5" /></button>}
      </span>
    </div>
  </article>;
}
