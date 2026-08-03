"use client";

import { FiArrowRight, FiChevronLeft, FiChevronRight, FiImage, FiTrash2 } from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import type { RoomImage } from "../share-room-types";
import { formatBytes, middleEllipsisFileName } from "../share-room-formatters";

type LocalImageListProps = {
  images: RoomImage[];
  labels: ShareRoomLabels;
  outboxDisabled: boolean;
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
  onChoose(): void;
  onAdd(image: RoomImage): void | Promise<void>;
  onDelete(image: RoomImage): void | Promise<void>;
};

export default function LocalImageList({ images, labels, outboxDisabled, collapsed, onCollapsedChange, onChoose, onAdd, onDelete }: LocalImageListProps) {
  if (collapsed) {
    return (
      <aside className="flex min-h-12 items-center justify-center border-b border-slate-200 bg-slate-50/80 lg:min-h-[260px] lg:flex-col lg:border-b-0 lg:border-r">
        <button type="button" onClick={() => onCollapsedChange(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-[#2f65cf]" aria-label={labels.expandLocalList} title={labels.expandLocalList}><FiChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" onClick={onChoose} className="relative mt-0 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf] lg:mt-2" aria-label={labels.upload} title={labels.upload}>
          <FiImage className="h-4 w-4" aria-hidden="true" />
          {images.length ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2f65cf] px-1 text-[8px] font-semibold text-white">{images.length > 99 ? "99+" : images.length}</span> : null}
        </button>
      </aside>
    );
  }
  return (
    <aside className="flex min-h-[260px] min-w-0 flex-col border-b border-slate-200 bg-slate-50/80 lg:border-b-0 lg:border-r">
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-3">
        <div className="min-w-0"><h2 className="text-xs font-semibold text-slate-800">{labels.localQueue}</h2><p className="mt-0.5 text-[10px] leading-4 text-slate-500">{labels.localQueueHint}</p></div>
        <button type="button" onClick={() => onCollapsedChange(true)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" aria-label={labels.collapseLocalList} title={labels.collapseLocalList}><FiChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {images.length ? images.map((image) => (
          <article key={image.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5">
            <div className="h-11 w-[52px] overflow-hidden rounded bg-slate-100">
              <img src={image.url} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-slate-700" title={image.name}>{middleEllipsisFileName(image.name)}</div>
              <div className="mt-0.5 text-[10px] text-slate-400">{formatBytes(image.size)}</div>
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" disabled={outboxDisabled} onClick={() => void onAdd(image)} className="flex h-7 w-7 items-center justify-center rounded text-[#2f65cf] hover:bg-blue-50 disabled:opacity-35" aria-label={labels.addToOutbox} title={labels.addToOutbox}><FiArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
              <button type="button" onClick={() => void onDelete(image)} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={labels.deleteImage} title={labels.deleteImage}><FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div>
          </article>
        )) : (
          <button type="button" onClick={onChoose} className="flex h-full min-h-40 w-full cursor-pointer flex-col items-center justify-center px-4 text-center text-slate-400 transition hover:bg-white/70 hover:text-[#2f65cf]">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]"><FiImage className="h-5 w-5" aria-hidden="true" /></span>
            <span className="mt-3 text-xs font-semibold text-slate-700">{labels.guestEmpty}</span>
            <span className="mt-1 text-[10px] leading-4 text-slate-400">{labels.dropHint}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
