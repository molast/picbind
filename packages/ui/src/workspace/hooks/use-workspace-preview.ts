import React from "react";

export type WorkspaceEditingMode = "crop" | "resize" | "adjust" | "compress" | "convert" | null;

export function useWorkspacePreview() {
  const [editing, setEditing] = React.useState<WorkspaceEditingMode>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewFullscreen, setReviewFullscreen] = React.useState(false);
  const [processingSource, setProcessingSource] = React.useState<{ imageId: string; blob: Blob; width: number; height: number } | null>(null);
  const [editorPreparing, setEditorPreparing] = React.useState(false);
  const [maximizedImageId, setMaximizedImageId] = React.useState<string | null>(null);
  return { editing, setEditing, reviewOpen, setReviewOpen, reviewFullscreen, setReviewFullscreen, processingSource, setProcessingSource, editorPreparing, setEditorPreparing, maximizedImageId, setMaximizedImageId };
}
