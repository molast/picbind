import React from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

export function WorkspaceSidebar({ children, collapsed = false, onToggle, label = "Workspace sidebar", expandLabel = "Expand panel", collapseLabel = "Collapse panel" }: {
  children: React.ReactNode;
  collapsed?: boolean;
  onToggle?(): void;
  label?: string;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  if (collapsed) return <aside className="flex min-h-10 items-center justify-center border-t border-[#dfe3e8] bg-white text-[#172033] lg:min-h-0 lg:overflow-hidden lg:border-l lg:border-t-0" aria-label={label}>
    <button type="button" onClick={onToggle} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]" title={expandLabel} aria-label={expandLabel} aria-expanded={false}>
      <FiChevronLeft aria-hidden="true" />
    </button>
  </aside>;
  return <aside className="flex min-h-0 flex-col border-t border-[#dfe3e8] bg-white text-[#172033] lg:overflow-hidden lg:border-l lg:border-t-0" aria-label={label}>
    <div className="flex h-10 shrink-0 items-center justify-end border-b border-[#e4e7eb] px-2">
      <button type="button" onClick={onToggle} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]" title={collapseLabel} aria-label={collapseLabel} aria-expanded={true}>
        <FiChevronRight aria-hidden="true" />
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
  </aside>;
}
