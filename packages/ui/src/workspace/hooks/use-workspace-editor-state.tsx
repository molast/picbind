import React from "react";
import { FiLoader } from "react-icons/fi";
import { getShareRoomLabels, getWorkspaceLabels, type Lang } from "../../locales";
import type { RoomImage } from "../../components/share/share-room-types";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../../utils/room-color-adjustments";
import type { NormalizedCrop, RoomColorAdjustments } from "../../utils/room-image-editing";
import type { ReviewAnnotation } from "../../utils/review-collaboration";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";
import type { WorkspaceProcessingSource } from "./use-workspace-preview";

export function useWorkspaceEditorState({ workspace, selected, processingSource, editorPreparing, lang }: { workspace: WorkspaceIdentity | null; selected: WorkspaceImage | null; processingSource: WorkspaceProcessingSource | null; editorPreparing: boolean; lang: Lang }) {
  const editorSource = selected && processingSource?.imageId === selected.imageId ? processingSource.blob : null;
  const editorPoster = selected && processingSource?.imageId === selected.imageId ? processingSource.posterBlob : null;
  const previewUrl = React.useMemo(() => editorSource ? URL.createObjectURL(editorSource) : null, [editorSource]);
  const posterUrl = React.useMemo(() => editorPoster ? URL.createObjectURL(editorPoster) : null, [editorPoster]);
  React.useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  React.useEffect(() => () => { if (posterUrl) URL.revokeObjectURL(posterUrl); }, [posterUrl]);
  const editorImage = React.useMemo<RoomImage | null>(() => workspace && selected && processingSource && editorSource && previewUrl ? { id: selected.imageId, roomId: workspace.workspaceId, name: selected.name, type: selected.mimeType, size: selected.size, blob: editorSource, direction: workspace.role === "owner" ? "sent" : "received", rootImageId: selected.imageId, parentImageId: null, ownerId: workspace.role === "owner" ? "owner" : "remote", width: processingSource.width, height: processingSource.height, source: workspace.role === "owner" ? "local" : "received", operation: "original", version: 1, createdAt: selected.createdAt, updatedAt: selected.updatedAt, url: previewUrl } : null, [editorSource, previewUrl, processingSource, selected, workspace]);
  const initialColorAdjustments = React.useMemo<RoomColorAdjustments>(() => { const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "color"); if (!operation) return DEFAULT_COLOR_ADJUSTMENTS; const parameters = operation.params as Partial<RoomColorAdjustments>; const balance = parameters.balance; return { ...DEFAULT_COLOR_ADJUSTMENTS, ...parameters, balance: { shadows: { ...DEFAULT_COLOR_ADJUSTMENTS.balance.shadows, ...balance?.shadows }, midtones: { ...DEFAULT_COLOR_ADJUSTMENTS.balance.midtones, ...balance?.midtones }, highlights: { ...DEFAULT_COLOR_ADJUSTMENTS.balance.highlights, ...balance?.highlights } } }; }, [selected?.parameterDocument]);
  const initialCrop = React.useMemo<NormalizedCrop | undefined>(() => { const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "crop"); if (!operation) return undefined; const crop = { x: Number(operation.params.x), y: Number(operation.params.y), width: Number(operation.params.width), height: Number(operation.params.height) }; return Object.values(crop).every(Number.isFinite) && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= 1 && crop.y + crop.height <= 1 ? crop : undefined; }, [selected?.parameterDocument]);
  const initialResize = React.useMemo<{ width: number; height: number } | undefined>(() => { const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "resize"); if (!operation) return undefined; const size = { width: Number(operation.params.width), height: Number(operation.params.height) }; return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0 ? size : undefined; }, [selected?.parameterDocument]);
  const initialReviewAnnotations = React.useMemo<ReviewAnnotation[]>(() => { const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "draw"); return Array.isArray(operation?.params.annotations) ? operation.params.annotations as ReviewAnnotation[] : []; }, [selected?.parameterDocument]);
  const labels = React.useMemo(() => getShareRoomLabels(lang), [lang]);
  const editorLoadingOverlay = editorPreparing ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/75 backdrop-blur-[1px]" role="status" aria-live="polite"><div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm"><FiLoader className="h-4 w-4 animate-spin text-[#2f65cf]" /><span>{getWorkspaceLabels(lang).preparingPreview}</span></div></div> : null;
  return { editorImage, editorPosterUrl: posterUrl, editorBaseReady: processingSource?.editorBaseReady ?? false, initialColorAdjustments, initialCrop, initialResize, initialReviewAnnotations, labels, editorLoadingOverlay };
}
