"use client";

import React from "react";
import { FiLoader, FiTrash2, FiX } from "react-icons/fi";
import type { ShareRoomLabels } from "../share-room-labels";
import type { ActivityItem } from "../share-room-types";

type OperationLogDialogProps = {
  open: boolean;
  logs: ActivityItem[];
  labels: ShareRoomLabels;
  onClose(): void;
  onClear(): void | Promise<void>;
};

const KIND_STYLE: Record<ActivityItem["kind"], string> = {
  connection: "text-cyan-300",
  message: "text-blue-300",
  sending: "text-sky-300",
  receiving: "text-violet-300",
  complete: "text-emerald-300",
  cancelled: "text-amber-300",
  error: "text-red-300",
};

function terminalTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

export default function OperationLogDialog({
  open,
  logs,
  labels,
  onClose,
  onClear,
}: OperationLogDialogProps) {
  const [clearing, setClearing] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !clearing) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [clearing, onClose, open]);
  React.useEffect(() => {
    if (!open || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs, open]);

  if (!open) return null;
  const clear = async () => {
    if (clearing || !logs.length) return;
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4">
      <section className="flex h-[min(72vh,620px)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-[#0b1020] shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.operationLog}>
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-700 bg-[#151b2d] px-3">
          <div className="flex items-center gap-3">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono text-xs font-semibold text-slate-300">picbind-room / {labels.operationLog}</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" disabled={clearing || !logs.length} onClick={() => void clear()} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-red-300 disabled:opacity-30" aria-label={labels.clearOperationLog} title={labels.clearOperationLog}>
              {clearing ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <button type="button" disabled={clearing} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-30" aria-label={labels.closeDialog} title={labels.closeDialog}>
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-5 [scrollbar-color:#475569_transparent]">
          {logs.length ? logs.map((log) => (
            <div key={log.id} className="grid grid-cols-[118px_82px_minmax(0,1fr)] gap-2 border-b border-slate-800/70 py-1.5 last:border-b-0">
              <span className="text-slate-500">[{terminalTime(log.createdAt)}]</span>
              <span className={`uppercase ${KIND_STYLE[log.kind]}`}>{log.kind}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
                <span className="font-semibold text-slate-100">{log.title}</span>
                {log.detail ? `  ${log.detail}` : ""}
                {typeof log.progress === "number" && log.progress < 1 ? `  ${Math.round(log.progress * 100)}%` : ""}
              </span>
            </div>
          )) : (
            <div className="flex h-full items-center justify-center text-slate-600">$ {labels.noOperationLog}</div>
          )}
        </div>
      </section>
    </div>
  );
}
