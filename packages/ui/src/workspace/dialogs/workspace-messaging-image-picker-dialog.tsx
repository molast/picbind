"use client";

import React from "react";
import { FiShield, FiZap } from "react-icons/fi";
import type { ShareRoomLabels } from "../../locales";
import type { WorkspaceIdentity, WorkspaceImage, WorkspaceMessagingCompressionMode } from "../types";
import { WorkspaceImagePickerDialog } from "./workspace-image-picker-dialog";

export function WorkspaceMessagingImagePickerDialog({
  open,
  workingImages,
  libraryImages,
  role,
  labels,
  sending,
  error,
  onMoveToWorking,
  onSend,
  onClose,
  onClearError,
}: {
  open: boolean;
  workingImages: WorkspaceImage[];
  libraryImages: WorkspaceImage[];
  role: WorkspaceIdentity["role"];
  labels: ShareRoomLabels;
  sending: boolean;
  error?: string | null;
  onMoveToWorking(image: WorkspaceImage): Promise<boolean>;
  onSend(
    image: WorkspaceImage,
    sendOriginal: boolean,
    compressionMode: WorkspaceMessagingCompressionMode,
  ): Promise<boolean>;
  onClose(): void;
  onClearError(): void;
}) {
  const [source, setSource] = React.useState<"working" | "library">("working");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sendOriginal, setSendOriginal] = React.useState(false);
  const [compressionMode, setCompressionMode] = React.useState<WorkspaceMessagingCompressionMode>("fast");
  const [moving, setMoving] = React.useState(false);
  const [moveError, setMoveError] = React.useState<string | null>(null);
  const availableWorkingImages = React.useMemo(() => workingImages.filter((image) => !image.shared), [workingImages]);
  const clearError = React.useCallback(() => {
    setMoveError(null);
    onClearError();
  }, [onClearError]);

  React.useEffect(() => {
    if (!open) return;
    setSource("working");
    setSelectedId(null);
    setSendOriginal(false);
    setCompressionMode("fast");
    setMoving(false);
    clearError();
  }, [clearError, open]);

  const images = source === "working" ? availableWorkingImages : libraryImages;
  const chooseSource = (next: "working" | "library") => {
    clearError();
    setSelectedId(null);
    setSource(next);
  };
  const confirm = async (image: WorkspaceImage) => {
    clearError();
    if (source === "library") {
      setMoving(true);
      try {
        const moved = await onMoveToWorking(image);
        if (!moved) {
          setMoveError(labels.messagingMoveToWorkingFailed);
          return;
        }
        setSource("working");
        setSelectedId(image.imageId);
      } catch (reason) {
        setMoveError(reason instanceof Error ? reason.message : labels.messagingMoveToWorkingFailed);
      } finally {
        setMoving(false);
      }
      return;
    }
    if (await onSend(image, sendOriginal, compressionMode)) onClose();
  };

  return <WorkspaceImagePickerDialog
    open={open}
    title={source === "working" ? labels.messagingChooseWorkspaceImage : labels.messagingChooseLibraryImage}
    description={source === "working" ? labels.messagingChooseWorkspaceImageHint : labels.messagingChooseLibraryImageHint}
    images={images}
    role={role}
    selectedId={selectedId}
    pending={sending || moving}
    pendingLabel={moving ? labels.messagingMovingToWorking : labels.messagingPreparingImage}
    actionLabel={source === "working" ? labels.messagingSendSelected : labels.messagingMoveToWorking}
    cancelLabel={labels.cancel}
    closeLabel={labels.closeDialog}
    unavailableLabel={labels.messagingImageUnavailable}
    emptyTitle={source === "working" ? labels.messagingNoWorkingImages : labels.messagingNoLibraryImages}
    emptyDescription={source === "working" ? labels.messagingNoWorkingImagesHint : labels.messagingNoLibraryImagesHint}
    emptyActionLabel={source === "working" ? labels.messagingChooseFromLibrary : undefined}
    backLabel={labels.messagingChooseWorkspaceImage}
    footerLeading={source === "working" ? <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(210px,1fr)_minmax(190px,0.9fr)] sm:items-end">
      <div className="min-w-0">
        <span className="mb-1.5 block text-[10px] font-semibold text-slate-500">{labels.messagingCompressionAlgorithm}</span>
        <div className={`grid h-9 grid-cols-2 rounded-md bg-slate-100 p-1 ${sendOriginal ? "opacity-45" : ""}`} role="radiogroup" aria-label={labels.messagingCompressionAlgorithm}>
          {([
            ["fast", labels.messagingFastCompression, <FiZap key="fast-icon" className="h-3.5 w-3.5" />],
            ["standard", labels.messagingStandardCompression, <FiShield key="standard-icon" className="h-3.5 w-3.5" />],
          ] as const).map(([value, label, icon]) => <button
            key={value}
            type="button"
            role="radio"
            aria-checked={compressionMode === value}
            disabled={sendOriginal || sending || moving}
            onClick={() => setCompressionMode(value)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed ${compressionMode === value ? "bg-white text-[#2f65cf] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >{icon}<span className="truncate">{label}</span></button>)}
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-left">
        <input type="checkbox" checked={sendOriginal} onChange={(event) => setSendOriginal(event.target.checked)} disabled={sending || moving} className="mt-0.5 h-4 w-4 accent-[#2f65cf]" />
        <span className="min-w-0"><strong className="block text-xs font-semibold text-slate-700">{labels.messagingSendOriginal}</strong><span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{labels.messagingSendOriginalHint}</span></span>
      </label>
    </div> : null}
    error={moveError || error}
    onSelectedIdChange={(imageId) => { clearError(); setSelectedId(imageId); }}
    onConfirm={confirm}
    onClose={onClose}
    onEmptyAction={source === "working" ? () => chooseSource("library") : undefined}
    onBack={source === "library" ? () => chooseSource("working") : undefined}
  />;
}
