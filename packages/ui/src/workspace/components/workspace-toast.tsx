"use client";

import { createPortal } from "react-dom";
import { FiCheckCircle } from "react-icons/fi";

export function WorkspaceToast({ message }: { message: string | null }) {
  if (!message || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[2147483647] flex items-center justify-center p-4">
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="flex max-w-[min(420px,calc(100vw-32px))] items-center gap-2.5 rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-[0_16px_48px_rgba(15,23,42,0.24)]"
      >
        <FiCheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
        <span className="min-w-0 break-words">{message}</span>
      </div>
    </div>,
    document.body,
  );
}
