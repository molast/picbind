import React from "react";
import { FiCopy, FiLoader, FiRefreshCw } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { CollaborationSaveChoice } from "../hooks/use-workspace-save-collaboration";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceSavePopover({ open, saving, onClose, onSave }: {
  open: boolean;
  saving: boolean;
  onClose(): void;
  onSave(choice: CollaborationSaveChoice): void;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape" && !saving) onClose();
        return;
      }
      if (!saving && rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [onClose, open, saving]);

  if (!open) return null;
  return <div ref={rootRef} className="absolute bottom-full right-0 z-[125] mb-2 w-[min(290px,calc(100vw-32px))] rounded-md border border-slate-200 bg-white p-2 shadow-xl" role="menu" aria-label={text("saveImageQuestion")}>
    <button type="button" role="menuitem" disabled={saving} onClick={() => onSave("replace")} className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">{saving ? <FiLoader className="animate-spin" /> : <FiRefreshCw />}</span>
      <span className="min-w-0"><strong className="block text-xs text-slate-800">{text("replaceOriginal")}</strong><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{text("replaceOriginalDescription")}</span></span>
    </button>
    <button type="button" role="menuitem" disabled={saving} onClick={() => onSave("copy")} className="mt-1 flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">{saving ? <FiLoader className="animate-spin" /> : <FiCopy />}</span>
      <span className="min-w-0"><strong className="block text-xs text-slate-800">{text("saveAsNewImage")}</strong><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{text("saveAsNewImageDescription")}</span></span>
    </button>
  </div>;
}
