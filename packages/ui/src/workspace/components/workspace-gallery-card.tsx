import React from "react";
import { FiBookmark, FiDownload, FiLoader, FiMaximize2, FiMoreHorizontal, FiTrash2 } from "react-icons/fi";
import { TbPinned, TbPinnedFilled } from "react-icons/tb";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { getLang, getWorkspaceLabels } from "../../locales";
import { BlobImageMedia, WorkspaceImageMedia } from "./workspace-image-media";
import { WorkspaceImageActionMenu, type WorkspaceCardOperation } from "./workspace-image-action-menu";

export type { WorkspaceCardOperation } from "./workspace-image-action-menu";
const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;
const bytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

export function WorkspaceGalleryCard({ image, role, selected, onlinePeers, requestingSource, renderedBlob, onSelect, onPin, onMoveToLibrary, onRequestSource, onDownload, onMaximize, onOperation }: { image: WorkspaceImage; role: WorkspaceIdentity["role"]; selected: boolean; onlinePeers: number; requestingSource: boolean; renderedBlob?: Blob; onSelect(): void; onPin(): void; onMoveToLibrary(): void; onRequestSource(): void; onDownload(): void; onMaximize(): void; onOperation(operation: WorkspaceCardOperation): void }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const hasSource = Boolean(image.sourceCached);
  return <article className={`relative min-w-0 rounded-md border bg-white transition ${selected ? "border-[#2f65cf] shadow-[0_0_0_2px_#2f65cf]" : "border-slate-200 hover:border-slate-300"}`}>
    <div className="relative aspect-[5/3] overflow-hidden rounded-t-[5px] bg-slate-100" onClick={onSelect}>
      {renderedBlob ? <BlobImageMedia blob={renderedBlob} alt={image.name} fit="cover" /> : <WorkspaceImageMedia image={image} role={role} fit="cover" controls preferOriginal={role === "owner" && !image.shared} />}
      <button type="button" onClick={(event) => { event.stopPropagation(); onPin(); }} className="absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title={image.pinnedAt ? "Unpin image" : "Pin image"} aria-pressed={Boolean(image.pinnedAt)}>{image.pinnedAt ? <TbPinnedFilled className="h-3.5 w-3.5" /> : <TbPinned className="h-3.5 w-3.5" />}</button>
      {image.shared ? <button type="button" onClick={(event) => { event.stopPropagation(); onMaximize(); }} className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title="Maximize image" aria-label="Maximize image"><FiMaximize2 className="h-3.5 w-3.5" /></button> : null}
      {role === "owner" && !image.shared ? <button type="button" onClick={(event) => { event.stopPropagation(); onMoveToLibrary(); }} className="absolute right-11 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-600" title={text("deleteImage")}><FiTrash2 className="h-3.5 w-3.5" /></button> : null}
      {hasSource && !image.shared ? <button ref={menuButtonRef} type="button" onClick={(event) => { event.stopPropagation(); setMenuOpen((value) => !value); }} className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title={text("imageActions")} aria-expanded={menuOpen}><FiMoreHorizontal className="h-4 w-4" /></button> : null}
      {menuOpen ? <WorkspaceImageActionMenu anchor={menuButtonRef} onClose={() => setMenuOpen(false)} onOperation={(operation) => { setMenuOpen(false); onOperation(operation); }} /> : null}
    </div>
    <button type="button" onClick={onSelect} className="block w-full px-3 pt-3 text-left"><div className="flex min-w-0 items-center justify-between gap-2"><strong className="truncate text-sm font-semibold text-slate-800">{image.name}</strong>{image.shared ? <span className="inline-flex h-5 shrink-0 items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700">{text("collaborating")}</span> : null}</div></button>
    <div className="flex min-h-12 items-center justify-between gap-2 px-3 pb-3 pt-1 text-xs text-slate-500"><span className="min-w-0"><span className="block">{bytes(image.size)}</span><span className="block text-[10px] text-slate-400">{image.width} × {image.height}</span></span><span className="flex shrink-0 items-center gap-1.5">{role !== "owner" && !hasSource ? <button type="button" onClick={onRequestSource} disabled={!onlinePeers || requestingSource} className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-60" title={requestingSource ? text("requestingSource") : text("requestSource")} aria-label={requestingSource ? text("requestingSource") : text("requestSource")}>{requestingSource ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiBookmark className="h-3.5 w-3.5" />}</button> : null}{hasSource ? <button type="button" onClick={onDownload} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" title={text("download")}><FiDownload className="h-3.5 w-3.5" /></button> : <button type="button" disabled className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-300" title={text("sourceUnavailable")}><FiDownload className="h-3.5 w-3.5" /></button>}</span></div>
  </article>;
}
