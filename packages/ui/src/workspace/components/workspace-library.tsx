import React from "react";
import { FiArrowRight, FiTrash2 } from "react-icons/fi";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceImageMedia } from "./workspace-image-media";

const bytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

export function WorkspaceLibraryItem({ image, role, selected, onSelect, onAdd, onDelete }: { image: WorkspaceImage; role: WorkspaceIdentity["role"]; selected: boolean; onSelect(): void; onAdd(): void; onDelete(): void }) {
  return <article className={`mb-2 grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-white p-1.5 ${selected ? "border-[#2f65cf] shadow-[0_0_0_1px_#2f65cf]" : "border-slate-200"}`}><button type="button" onClick={onSelect} className="contents text-left"><span className="block h-11 w-[52px] overflow-hidden rounded bg-slate-100"><WorkspaceImageMedia image={image} role={role} /></span><span className="min-w-0 text-left"><strong className="block truncate text-[11px] font-semibold text-slate-700">{image.name}</strong><span className="mt-0.5 block text-[10px] text-slate-400">{bytes(image.size)}</span></span></button><span className="flex flex-col gap-1"><button type="button" onClick={onAdd} className="flex h-7 w-7 items-center justify-center rounded text-[#2f65cf] hover:bg-blue-50" title="Add to Working"><FiArrowRight className="h-3.5 w-3.5" /></button><button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete image"><FiTrash2 className="h-3.5 w-3.5" /></button></span></article>;
}
