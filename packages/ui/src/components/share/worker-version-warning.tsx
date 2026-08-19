"use client";

import React from "react";
import { FiAlertTriangle, FiX } from "react-icons/fi";
import { getLang, getShareRoomLabels } from "../../locales";
import {
  subscribeWorkerVersionMismatch,
  type WorkerVersionMismatch,
} from "../../worker-version";

let activeWarningOwner: symbol | null = null;

export default function WorkerVersionWarning() {
  const owner = React.useRef(Symbol("worker-version-warning"));
  const [mismatch, setMismatch] = React.useState<WorkerVersionMismatch | null>(null);

  React.useEffect(() => {
    const ownerId = owner.current;
    const unsubscribe = subscribeWorkerVersionMismatch((next) => {
      if (!activeWarningOwner || activeWarningOwner === ownerId) {
        activeWarningOwner = ownerId;
        setMismatch(next);
      }
    });
    return () => {
      unsubscribe();
      if (activeWarningOwner === ownerId) activeWarningOwner = null;
    };
  }, []);

  if (!mismatch) return null;

  const labels = getShareRoomLabels(getLang());
  const detail = mismatch.actual
    ? labels.workerVersionMismatchDetail(mismatch.actual, mismatch.expected)
    : labels.workerVersionMissingDetail(mismatch.expected);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="worker-version-warning-title"
    >
      <div className="w-full max-w-[420px] rounded-lg border border-amber-200 bg-white p-5 text-slate-800 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
            <FiAlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="worker-version-warning-title" className="text-base font-semibold">
              {labels.workerVersionMismatchTitle}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
          </div>
          <button
            type="button"
            onClick={() => setMismatch(null)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={labels.closeDialog}
            title={labels.closeDialog}
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMismatch(null)}
          className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
        >
          {labels.confirm}
        </button>
      </div>
    </div>
  );
}
