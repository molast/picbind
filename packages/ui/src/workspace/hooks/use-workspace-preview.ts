import React from "react";
import type { WorkspacePreviewMemory } from "../workspace-preview-memory";

export type WorkspaceEditingMode = "crop" | "resize" | "adjust" | "compress" | "convert" | null;

export type WorkspaceProcessingSource = {
  imageId: string;
  blob: Blob;
  posterBlob: Blob;
  decodedSource?: HTMLCanvasElement;
  width: number;
  height: number;
  editorBaseReady: boolean;
};

export function useWorkspacePreview() {
  const [editing, setEditing] = React.useState<WorkspaceEditingMode>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewFullscreen, setReviewFullscreen] = React.useState(false);
  const [processingSource, setProcessingSource] = React.useState<WorkspaceProcessingSource | null>(null);
  const [editorPreparing, setEditorPreparing] = React.useState(false);
  const [maximizedImageId, setMaximizedImageId] = React.useState<string | null>(null);
  const previewMemoryRef = React.useRef<WorkspacePreviewMemory | null>(null);
  return { editing, setEditing, reviewOpen, setReviewOpen, reviewFullscreen, setReviewFullscreen, processingSource, setProcessingSource, editorPreparing, setEditorPreparing, maximizedImageId, setMaximizedImageId, previewMemoryRef };
}
