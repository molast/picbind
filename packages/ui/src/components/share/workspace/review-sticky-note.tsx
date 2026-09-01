"use client";

import React from "react";
import { FiCheck, FiX } from "react-icons/fi";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";

type ReviewStickyNoteProps = {
  initialValue: string;
  initialTodo: boolean;
  resolved: boolean;
  labels: WorkspaceEditorLabels;
  onSave(value: string, todo: boolean): void;
  onCancel(): void;
  onResolvedChange?(resolved: boolean): void;
};

export default function ReviewStickyNote({
  initialValue,
  initialTodo,
  resolved,
  labels,
  onSave,
  onCancel,
  onResolvedChange,
}: ReviewStickyNoteProps) {
  const [value, setValue] = React.useState(initialValue);
  const [todo, setTodo] = React.useState(initialTodo);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="w-64 overflow-hidden rounded-sm border border-amber-300 bg-[#fff4a8] shadow-xl"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-9 items-center justify-between border-b border-amber-300/80 px-2.5">
        <label className="flex items-center gap-2 text-xs font-semibold text-amber-950">
          <input
            type="checkbox"
            checked={todo}
            onChange={(event) => setTodo(event.target.checked)}
            className="h-3.5 w-3.5 accent-amber-700"
          />
          {labels.anchorTodo}
        </label>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center text-amber-900/60 hover:text-amber-950"
          aria-label={labels.cancel}
          title={labels.cancel}
        >
          <FiX className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value.slice(0, 1000))}
        placeholder={labels.anchorCommentPlaceholder}
        rows={5}
        className="block w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-amber-950 outline-none [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_23px,rgba(146,101,25,.2)_24px)]"
      />
      <div className="flex items-center justify-between border-t border-amber-300/80 px-2.5 py-2">
        {onResolvedChange ? (
          <button
            type="button"
            onClick={() => onResolvedChange(!resolved)}
            className={`h-7 rounded px-2 text-xs font-semibold transition ${
              resolved
                ? "bg-emerald-600 text-white"
                : "border border-amber-400 text-amber-950 hover:bg-amber-100"
            }`}
          >
            {resolved ? labels.anchorResolved : labels.anchorMarkResolved}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!value.trim()}
          onClick={() => onSave(value.trim(), todo)}
          className="flex h-7 items-center gap-1 rounded bg-amber-900 px-2.5 text-xs font-semibold text-white hover:bg-amber-950 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <FiCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {labels.anchorSave}
        </button>
      </div>
    </div>
  );
}
