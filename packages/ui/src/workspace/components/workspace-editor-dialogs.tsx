import React from "react";
import type { WorkspaceEditorImage } from "../../components/share/workspace-editor-types";
import ImageCropDialog from "../../components/share/workspace/image-crop-dialog";
import ImageResizeDialog from "../../components/share/workspace/image-resize-dialog";
import ImageColorAdjustmentDialog from "../../components/share/workspace/image-color-adjustment-dialog";
import ImageCompressionDialog from "../../components/share/workspace/image-compression-dialog";
import ImageConversionDialog from "../../components/share/workspace/image-conversion-dialog";
import type { WorkspaceEditorLabels } from "../../components/share/workspace-editor-labels";
import type { NormalizedCrop, WorkspaceColorAdjustments } from "../../utils/workspace-image-editing";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";

export function WorkspaceEditorDialogs({ editing, image, posterUrl, editorBaseReady, labels, initialCrop, initialSize, initialAdjustments, parameterAction, loadingOverlay, onClose, onSave, onApplyCrop, onApplyResize, onApplyColor, onSaveCompression, onSaveConversion }: { editing: "crop" | "resize" | "adjust" | "compress" | "convert" | null; image: WorkspaceEditorImage | null; posterUrl: string | null; editorBaseReady: boolean; labels: WorkspaceEditorLabels; initialCrop?: NormalizedCrop; initialSize?: { width: number; height: number }; initialAdjustments: WorkspaceColorAdjustments; parameterAction?: "apply" | "proposal"; loadingOverlay: React.ReactNode; onClose(): void; onSave(source: WorkspaceEditorImage, result: ProcessedImageResult): void | Promise<void>; onApplyCrop(parameters: Record<string, unknown>): void | Promise<void>; onApplyResize(parameters: Record<string, unknown>): void | Promise<void>; onApplyColor(parameters: Record<string, unknown>): void | Promise<void>; onSaveCompression(source: WorkspaceEditorImage, result: ProcessedImageResult): void | Promise<void>; onSaveConversion(source: WorkspaceEditorImage, result: ProcessedImageResult): void | Promise<void> }) {
  return <>
    <ImageCropDialog image={editing === "crop" ? image : null} posterUrl={posterUrl} editorBaseReady={editorBaseReady} labels={labels} initialCrop={initialCrop} parameterAction={parameterAction} onClose={onClose} onSave={onSave} onApplyParameters={onApplyCrop} />
    <ImageResizeDialog image={editing === "resize" ? image : null} posterUrl={posterUrl} editorBaseReady={editorBaseReady} labels={labels} initialSize={initialSize} parameterAction={parameterAction} onClose={onClose} onSave={onSave} onApplyParameters={onApplyResize} />
    <ImageColorAdjustmentDialog image={editing === "adjust" ? image : null} posterUrl={posterUrl} editorBaseReady={editorBaseReady} labels={labels} initialAdjustments={initialAdjustments} parameterAction={parameterAction} onClose={onClose} onSave={onSave} onApplyParameters={onApplyColor} />
    <ImageCompressionDialog image={editing === "compress" ? image : null} labels={labels} onClose={onClose} onSave={onSaveCompression} />
    <ImageConversionDialog image={editing === "convert" ? image : null} labels={labels} onClose={onClose} onSave={onSaveConversion} />
    {loadingOverlay}
  </>;
}
