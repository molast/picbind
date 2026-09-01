"use client";

import React from "react";
import { FiCheckCircle, FiHardDrive, FiLoader, FiMessageCircle, FiSend, FiUser, FiX, FiXCircle } from "react-icons/fi";
import type { WorkspaceEditorImage } from "../workspace-editor-types";
import { formatBytes } from "../workspace-formatters";
import type { WorkspaceCompressionResult } from "../../../utils/workspace-image-compression";
import type { WorkspaceImageEditResult } from "../../../utils/workspace-image-editing";
import type { WorkspaceEditorLabels } from "../workspace-editor-labels";
import type { WorkspaceShareRecipient } from "./workspace-share-recipient";

export type ProcessedImageResult = WorkspaceCompressionResult | WorkspaceImageEditResult;
export type ProcessedImageAction = "store" | "share";
export type ProcessedImageActionStage = "preparing" | "waiting" | "transferring" | "complete";
export type ProcessedImageActionOutcome = {
  status: "stored" | "shared" | "rejected";
  imageId: string;
};

type ImageResultDialogProps = {
  source: WorkspaceEditorImage | null;
  labels: WorkspaceEditorLabels;
  result: ProcessedImageResult | null;
  shareRecipients: WorkspaceShareRecipient[];
  onClose(): void;
  onAction(
    source: WorkspaceEditorImage,
    result: ProcessedImageResult,
    action: ProcessedImageAction,
    report: (stage: ProcessedImageActionStage) => void,
    recipient?: WorkspaceShareRecipient,
  ): Promise<ProcessedImageActionOutcome>;
  onResolveRejected(imageId: string, save: boolean): Promise<void>;
};

export default function ImageResultDialog({ source, result, labels, shareRecipients, onClose, onAction, onResolveRejected }: ImageResultDialogProps) {
  const [stage, setStage] = React.useState<ProcessedImageActionStage | null>(null);
  const [action, setAction] = React.useState<ProcessedImageAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rejectedImageId, setRejectedImageId] = React.useState<string | null>(null);
  const [rejectionAction, setRejectionAction] = React.useState<"save" | "discard" | null>(null);
  const [selectedRecipientId, setSelectedRecipientId] = React.useState<string | null>(null);
  const previewUrl = React.useMemo(() => result ? URL.createObjectURL(result.blob) : null, [result]);

  React.useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  React.useEffect(() => {
    setStage(null);
    setAction(null);
    setError(null);
    setRejectedImageId(null);
    setRejectionAction(null);
    setSelectedRecipientId(null);
  }, [result]);
  React.useEffect(() => {
    if (!source || !result) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !action && !rejectionAction && !rejectedImageId) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [action, onClose, rejectedImageId, rejectionAction, result, source]);

  if (!source || !result || !previewUrl) return null;
  const stageLabels: Record<ProcessedImageActionStage, string> = {
    preparing: labels.imagePreparing,
    waiting: labels.imageWaitingForDecision,
    transferring: labels.imageTransferring,
    complete: labels.imageProcessed,
  };
  const running = Boolean(action || rejectionAction);
  const selectedRecipient = shareRecipients.length === 1
    ? shareRecipients[0]
    : shareRecipients.find((recipient) => recipient.id === selectedRecipientId);
  const start = async (nextAction: ProcessedImageAction) => {
    if (running) return;
    setAction(nextAction);
    setStage("preparing");
    setError(null);
    try {
      const outcome = await onAction(
        source,
        result,
        nextAction,
        setStage,
        nextAction === "share" ? selectedRecipient : undefined,
      );
      if (outcome.status === "rejected") {
        setRejectedImageId(outcome.imageId);
        setStage(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.imageProcessingFailed);
    } finally {
      setAction(null);
    }
  };
  const resolveRejection = async (save: boolean) => {
    if (!rejectedImageId || running) return;
    setRejectionAction(save ? "save" : "discard");
    setError(null);
    try {
      await onResolveRejected(rejectedImageId, save);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.imageActionFailed);
      setRejectionAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.imageResult}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-base font-semibold text-slate-900">{labels.imageResultComplete}</h2><p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{result.name}</p></div>
          <button type="button" disabled={running || Boolean(rejectedImageId)} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={labels.closeDialog}><FiX className="h-4 w-4" aria-hidden="true" /></button>
        </header>
        <div className="space-y-4 p-5">
          <div className="aspect-video overflow-hidden rounded-md bg-slate-100"><img src={previewUrl} alt={labels.imageResultPreview} className="h-full w-full object-contain" /></div>
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500"><span>{result.width} × {result.height}</span><span>{formatBytes(result.blob.size)}</span></div>
          {!stage && !error && !rejectedImageId ? (
            <div className="space-y-2">
              <div>
                <div className="text-xs font-semibold text-slate-800">{labels.selectShareRecipient}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">{labels.selectShareRecipientHint}</div>
              </div>
              {shareRecipients.length === 1 ? (
                <div className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs text-blue-700">
                  {shareRecipients[0].kind === "workspace"
                    ? <FiUser className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    : <FiMessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span className="truncate font-medium">
                    {shareRecipients[0].kind === "workspace"
                      ? shareRecipients[0].member.role === "owner"
                        ? labels.owner
                        : labels.guest
                      : `${labels.messagingBot} · ${shareRecipients[0].provider.displayName}`}
                  </span>
                </div>
              ) : (
              <div className="grid max-h-32 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {shareRecipients.map((recipient, index) => {
                  const selected = selectedRecipient?.id === recipient.id;
                  return (
                    <button
                      key={recipient.id}
                      type="button"
                      disabled={running}
                      onClick={() => setSelectedRecipientId(recipient.id)}
                      className={`flex h-10 min-w-0 items-center gap-2 rounded-md border px-2.5 text-left text-xs transition-colors ${selected ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                    >
                      {recipient.kind === "workspace"
                        ? <FiUser className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        : <FiMessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                      <span className="truncate">
                        {recipient.kind === "workspace"
                          ? recipient.member.role === "owner"
                            ? labels.owner
                            : `${labels.guest} ${index + 1}`
                          : `${labels.messagingBot} · ${recipient.provider.displayName}`}
                      </span>
                    </button>
                  );
                })}
                {!shareRecipients.length ? (
                  <div className="col-span-full rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                    {labels.waiting}
                  </div>
                ) : null}
              </div>
              )}
            </div>
          ) : null}
          {stage || error || rejectedImageId ? (
            <div className={`flex items-start gap-3 rounded-md px-3 py-3 text-xs ${error ? "bg-red-50 text-red-700" : rejectedImageId ? "bg-amber-50 text-amber-800" : stage === "complete" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-[#2f65cf]"}`}>
              {error || rejectedImageId ? <FiXCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : stage === "complete" ? <FiCheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <FiLoader className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
              <span>{error || (rejectedImageId ? labels.peerRejectedSavePrompt : action === "store" && stage === "complete" ? labels.storedInLibrary : stage ? stageLabels[stage] : "")}</span>
            </div>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          {rejectedImageId ? (
            <>
              <button type="button" disabled={running} onClick={() => void resolveRejection(false)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                {rejectionAction === "discard" ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {labels.doNotSave}
              </button>
              <button type="button" disabled={running} onClick={() => void resolveRejection(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-40">
                {rejectionAction === "save" ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FiHardDrive className="h-4 w-4" aria-hidden="true" />}
                {labels.save}
              </button>
            </>
          ) : stage === "complete" || error ? (
            <button type="button" onClick={onClose} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd]">{error ? labels.closeDialog : labels.done}</button>
          ) : (
            <>
              <button type="button" disabled={running} onClick={() => void start("store")} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                {running && action === "store" ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FiHardDrive className="h-4 w-4" aria-hidden="true" />}
                {running && action === "store" ? labels.storing : labels.storeLocally}
              </button>
              <button type="button" disabled={running || !selectedRecipient} onClick={() => void start("share")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40">
                {running && action === "share" ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FiSend className="h-4 w-4" aria-hidden="true" />}
                {running && action === "share" ? (stage === "waiting" ? labels.waitingForAcceptance : stage === "transferring" ? labels.sending : labels.preparing) : labels.shareWithPeer}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
