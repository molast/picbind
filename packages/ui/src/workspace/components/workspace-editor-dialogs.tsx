import React from "react";
import type { RoomImage } from "../../components/share/share-room-types";
import ImageCropDialog from "../../components/share/workspace/image-crop-dialog";
import ImageResizeDialog from "../../components/share/workspace/image-resize-dialog";
import ImageColorAdjustmentDialog from "../../components/share/workspace/image-color-adjustment-dialog";
import ImageCompressionDialog from "../../components/share/workspace/image-compression-dialog";
import ImageConversionDialog from "../../components/share/workspace/image-conversion-dialog";
import type { ShareRoomLabels } from "../../components/share/share-room-labels";
import type { NormalizedCrop, RoomColorAdjustments } from "../../utils/room-image-editing";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";

export function WorkspaceEditorDialogs({ editing, image, labels, initialCrop, initialSize, initialAdjustments, parameterAction, loadingOverlay, onClose, onSave, onApplyCrop, onApplyResize, onApplyColor, onSaveCompression, onSaveConversion }: { editing: "crop" | "resize" | "adjust" | "compress" | "convert" | null; image: RoomImage | null; labels: ShareRoomLabels; initialCrop?: NormalizedCrop; initialSize?: { width: number; height: number }; initialAdjustments: RoomColorAdjustments; parameterAction?: "apply" | "proposal"; loadingOverlay: React.ReactNode; onClose(): void; onSave(source: RoomImage, result: ProcessedImageResult): void | Promise<void>; onApplyCrop(parameters: Record<string, unknown>): void | Promise<void>; onApplyResize(parameters: Record<string, unknown>): void | Promise<void>; onApplyColor(parameters: Record<string, unknown>): void | Promise<void>; onSaveCompression(source: RoomImage, result: ProcessedImageResult): void | Promise<void>; onSaveConversion(source: RoomImage, result: ProcessedImageResult): void | Promise<void> }) {
  return <>
    <ImageCropDialog image={editing === "crop" ? image : null} labels={labels} initialCrop={initialCrop} parameterAction={parameterAction} onClose={onClose} onSave={onSave} onApplyParameters={onApplyCrop} />
    <ImageResizeDialog image={editing === "resize" ? image : null} labels={labels} initialSize={initialSize} parameterAction={parameterAction} onClose={onClose} onSave={onSave} onApplyParameters={onApplyResize} />
    <ImageColorAdjustmentDialog image={editing === "adjust" ? image : null} labels={labels} initialAdjustments={initialAdjustments} parameterAction={parameterAction} onClose={onClose} onSave={onSave} onApplyParameters={onApplyColor} />
    <ImageCompressionDialog image={editing === "compress" ? image : null} labels={labels} onClose={onClose} onSave={onSaveCompression} />
    <ImageConversionDialog image={editing === "convert" ? image : null} labels={labels} onClose={onClose} onSave={onSaveConversion} />
    {loadingOverlay}
  </>;
}
