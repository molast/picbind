"use client";

import React from "react";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiHardDrive,
  FiLoader,
  FiSend,
  FiX,
} from "react-icons/fi";
import { formatBytes } from "../share-room-formatters";
import type {
  ReviewImageExport,
  ReviewImageExportOutcome,
  ReviewImageExportStage,
} from "../../../utils/review-image-export";

type ReviewImageExportDialogProps = {
  result: ReviewImageExport | null;
  onClose(): void;
  onSave(
    share: boolean,
    report: (stage: ReviewImageExportStage) => void,
  ): Promise<ReviewImageExportOutcome>;
  onResolveRejected(imageId: string, save: boolean): Promise<void>;
};

const STAGE_LABELS: Record<ReviewImageExportStage, string> = {
  preparing: "正在准备分享图片",
  waiting: "分享请求已发送，等待对方选择",
  transferring: "对方已接受，正在发送图片",
  complete: "图片分享完成",
};

export default function ReviewImageExportDialog({
  result,
  onClose,
  onSave,
  onResolveRejected,
}: ReviewImageExportDialogProps) {
  const [action, setAction] = React.useState<"store" | "share" | null>(null);
  const [stage, setStage] = React.useState<ReviewImageExportStage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [rejectedImageId, setRejectedImageId] = React.useState<string | null>(null);
  const [rejectionAction, setRejectionAction] = React.useState<"save" | "discard" | null>(null);
  const previewUrl = React.useMemo(
    () => (result ? URL.createObjectURL(result.blob) : null),
    [result],
  );

  React.useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  React.useEffect(() => {
    setAction(null);
    setStage(null);
    setError(null);
    setRejectedImageId(null);
    setRejectionAction(null);
  }, [result]);
  const busy = Boolean(action || rejectionAction);
  React.useEffect(() => {
    if (!result) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !rejectedImageId) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose, rejectedImageId, result]);

  const run = async (share: boolean) => {
    if (busy) return;
    setAction(share ? "share" : "store");
    setStage("preparing");
    setError(null);
    try {
      const outcome = await onSave(share, setStage);
      if (outcome.status === "rejected") {
        setRejectedImageId(outcome.imageId);
        setStage(null);
      }
    } catch (reason) {
      setStage(null);
      setError(reason instanceof Error ? reason.message : "图片操作失败");
    } finally {
      setAction(null);
    }
  };

  const resolveRejection = async (save: boolean) => {
    if (!rejectedImageId || busy) return;
    setRejectionAction(save ? "save" : "discard");
    setError(null);
    try {
      await onResolveRejected(rejectedImageId, save);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片操作失败");
      setRejectionAction(null);
    }
  };

  if (!result || !previewUrl) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
      <section className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="生成图片预览">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">生成图片预览</h2>
            <p className="mt-0.5 text-xs text-slate-500">{result.format.toUpperCase()} · {formatBytes(result.blob.size)} · {result.width} × {result.height}</p>
          </div>
          <button type="button" disabled={busy || Boolean(rejectedImageId)} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="关闭">
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="max-h-[54vh] bg-slate-100 p-4">
          <img src={previewUrl} alt="生成图片预览" className="mx-auto max-h-[46vh] max-w-full object-contain" />
        </div>
        {stage || error || rejectedImageId ? (
          <div className={`flex items-start gap-2.5 border-t px-5 py-3 text-xs ${error ? "border-red-100 bg-red-50 text-red-700" : rejectedImageId ? "border-amber-100 bg-amber-50 text-amber-800" : stage === "complete" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-[#2f65cf]"}`}>
            {error ? <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : rejectedImageId ? <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : stage === "complete" ? <FiCheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <FiLoader className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
            <span>{error || (rejectedImageId ? "对方拒绝接收这张图片，是否保存到本地图片列表？" : stage ? STAGE_LABELS[stage] : "")}</span>
          </div>
        ) : null}
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          {rejectedImageId ? (
            <>
              <button type="button" disabled={busy} onClick={() => void resolveRejection(false)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                {rejectionAction === "discard" ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                不保存
              </button>
              <button type="button" disabled={busy} onClick={() => void resolveRejection(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white hover:bg-[#2457bd] disabled:opacity-40">
                {rejectionAction === "save" ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FiHardDrive className="h-3.5 w-3.5" aria-hidden="true" />}
                保存
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={onClose} className="h-9 rounded-md border border-slate-200 px-4 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-35">取消</button>
              <button type="button" disabled={busy} onClick={() => void run(false)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#2f65cf] px-4 text-xs font-semibold text-[#2f65cf] disabled:cursor-not-allowed disabled:opacity-40">
                {action === "store" ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FiHardDrive className="h-3.5 w-3.5" aria-hidden="true" />}
                {action === "store" ? "保存中" : "保存"}
              </button>
              <button type="button" disabled={busy} onClick={() => void run(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                {action === "share" ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FiSend className="h-3.5 w-3.5" aria-hidden="true" />}
                {action === "share" ? "分享中" : "分享"}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
