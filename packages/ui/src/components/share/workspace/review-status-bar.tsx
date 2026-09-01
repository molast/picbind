import type { WorkspaceEditorImage } from "../workspace-editor-types";
import { formatBytes } from "../workspace-formatters";

type ReviewStatusBarProps = {
  image: WorkspaceEditorImage;
  dimensions: { width: number; height: number } | null;
};

export default function ReviewStatusBar({
  image,
  dimensions,
}: ReviewStatusBarProps) {
  const format = image.type.split("/").pop()?.toUpperCase() || "IMAGE";
  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-4 text-xs text-slate-500">
      <span className="font-semibold text-slate-700">{format}</span>
      <span className="h-3 w-px bg-slate-200" />
      <span>{dimensions ? `${dimensions.width} × ${dimensions.height}` : "..."}</span>
      <span className="h-3 w-px bg-slate-200" />
      <span>{formatBytes(image.size)}</span>
    </footer>
  );
}
