"use client";

import React from "react";
import { FiTrash2, FiX } from "react-icons/fi";
import type { WorkspaceActivity } from "./types";

export default function WorkspaceOperationLogDialog({
  open,
  logs,
  onClose,
  onClear,
}: {
  open: boolean;
  logs: WorkspaceActivity[];
  onClose(): void;
  onClear(): void | Promise<void>;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);
  React.useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs, open]);
  if (!open) return null;

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}>
    <section className="flex h-[min(72vh,620px)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#0b1020] shadow-2xl" role="dialog" aria-modal="true" aria-label="Workspace operation log">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-700 bg-[#151b2d] px-3">
        <div className="flex items-center gap-3"><span className="flex gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-red-400"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-400"/></span><span className="font-mono text-xs font-semibold text-slate-300">picbind-workspace / operation log</span></div>
        <div className="flex items-center gap-1"><button type="button" disabled={!logs.length} onClick={()=>void onClear()} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-red-300 disabled:opacity-30" title="Clear operation log"><FiTrash2/></button><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white" title="Close"><FiX/></button></div>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-5 [scrollbar-color:#475569_transparent]">
        {logs.length?logs.map((log)=><div key={log.eventId} className="grid grid-cols-[150px_180px_minmax(0,1fr)] gap-2 border-b border-slate-800/70 py-1.5 last:border-b-0"><span className="text-slate-500">[{new Date(log.createdAt).toLocaleString()}]</span><span className="truncate uppercase text-cyan-300">{log.kind}</span><span className="min-w-0 whitespace-pre-wrap break-words text-slate-300">{log.imageId?<span className="text-slate-100">{log.imageId} </span>:null}{log.detail!==undefined?JSON.stringify(log.detail):""}</span></div>):<div className="flex h-full items-center justify-center text-slate-600">$ No operation logs</div>}
      </div>
    </section>
  </div>;
}
