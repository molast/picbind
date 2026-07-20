"use client";

import React from "react";
import {
  FiCheck,
  FiFileText,
  FiFlag,
  FiMessageSquare,
  FiSmile,
  FiTag,
  FiX,
} from "react-icons/fi";
import type { ReviewAnchor, ReviewAnchorKind } from "@/utils/review-collaboration";
import type { ShareRoomLabels } from "../share-room-labels";
import ReviewStickyNote from "./review-sticky-note";

type ReviewAnchorLayerProps = {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  actorId: string;
  commentMode: boolean;
  readOnly: boolean;
  anchors: ReviewAnchor[];
  labels: ShareRoomLabels;
  onUpsert(anchor: ReviewAnchor): void;
};

type DraftAnchor = {
  x: number;
  y: number;
  step: "kind" | "reaction" | "sticky" | "label";
};

const REACTIONS = ["👍", "👎", "❤️", "🔥", "🎉", "😂", "😮", "🤔"];
const LABELS = ["Approved", "Needs changes", "Question", "Copy"];

function newAnchor(
  kind: ReviewAnchorKind,
  draft: DraftAnchor,
  actorId: string,
): ReviewAnchor {
  const now = Date.now();
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    kind,
    x: draft.x,
    y: draft.y,
    todo: false,
    resolved: false,
    endorsements: [],
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
}

function anchorStyle(anchor: { x: number; y: number }, imageWidth: number, imageHeight: number) {
  return {
    left: `${(anchor.x / Math.max(1, imageWidth)) * 100}%`,
    top: `${(anchor.y / Math.max(1, imageHeight)) * 100}%`,
  };
}

function formatAnchorTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default function ReviewAnchorLayer({
  width,
  height,
  imageWidth,
  imageHeight,
  actorId,
  commentMode,
  readOnly,
  anchors,
  labels,
  onUpsert,
}: ReviewAnchorLayerProps) {
  const [draft, setDraft] = React.useState<DraftAnchor | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [customLabel, setCustomLabel] = React.useState("");

  React.useEffect(() => {
    if (!commentMode) setDraft(null);
  }, [commentMode]);

  const closePanels = () => {
    setDraft(null);
    setEditingId(null);
    setSelectedId(null);
    setCustomLabel("");
  };

  const updateAnchor = (anchor: ReviewAnchor, patch: Partial<ReviewAnchor>) => {
    if (readOnly) return;
    onUpsert({ ...anchor, ...patch, updatedAt: Date.now() });
  };

  const createReaction = (reaction: string) => {
    if (!draft) return;
    onUpsert({
      ...newAnchor("reaction", draft, actorId),
      reaction,
    });
    closePanels();
  };

  const createLabel = (label: string) => {
    if (!draft || !label.trim()) return;
    onUpsert({
      ...newAnchor("label", draft, actorId),
      label: label.trim().slice(0, 40),
      endorsements: [actorId],
    });
    closePanels();
  };

  const menuPosition = draft
    ? {
        left: Math.max(8, Math.min(width - 272, (draft.x / Math.max(1, imageWidth)) * width + 10)),
        top: Math.max(8, Math.min(height - 190, (draft.y / Math.max(1, imageHeight)) * height + 10)),
      }
    : null;

  return (
    <div
      className={`absolute inset-0 z-30 ${commentMode ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"}`}
      onPointerDown={(event) => {
        if (!commentMode || event.button !== 0 || event.target !== event.currentTarget) return;
        if (draft || editingId || selectedId) {
          closePanels();
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setDraft({
          x: Math.max(0, Math.min(imageWidth, ((event.clientX - rect.left) / rect.width) * imageWidth)),
          y: Math.max(0, Math.min(imageHeight, ((event.clientY - rect.top) / rect.height) * imageHeight)),
          step: "kind",
        });
      }}
    >
      {anchors.map((anchor) => {
        const style = anchorStyle(anchor, imageWidth, imageHeight);
        if (anchor.kind === "reaction") {
          return (
            <div key={anchor.id} className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={style}>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (readOnly) return;
                  setSelectedId((current) => current === anchor.id ? null : anchor.id);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-full border bg-white text-xl shadow-md ${anchor.resolved ? "border-emerald-400 opacity-65" : "border-white"}`}
                title={anchor.resolved ? labels.anchorResolved : labels.anchorOpen}
              >
                {anchor.reaction}
              </button>
              {selectedId === anchor.id ? (
                <AnchorStatusMenu anchor={anchor} labels={labels} onUpdate={(patch) => updateAnchor(anchor, patch)} />
              ) : null}
            </div>
          );
        }

        if (anchor.kind === "label") {
          const endorsed = anchor.endorsements.includes(actorId);
          return (
            <div key={anchor.id} className="pointer-events-auto absolute -translate-y-1/2" style={style}>
              <div className="group relative flex items-center">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (readOnly) return;
                    const endorsements = endorsed
                      ? anchor.endorsements.filter((id) => id !== actorId)
                      : [...anchor.endorsements, actorId];
                    updateAnchor(anchor, { endorsements });
                  }}
                  className={`h-7 rounded-full border px-3 pr-7 text-xs font-semibold shadow-md ${anchor.resolved ? "border-emerald-300 bg-emerald-50 text-emerald-700" : endorsed ? "border-blue-400 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                  title={labels.anchorEndorse}
                >
                  {anchor.label}
                </button>
                <span className="pointer-events-none absolute right-1 top-[-7px] flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-white">
                  {anchor.endorsements.length}
                </span>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    updateAnchor(anchor, { resolved: !anchor.resolved });
                  }}
                  className="ml-1 hidden h-7 w-7 items-center justify-center rounded-full bg-white text-slate-500 shadow group-hover:flex hover:text-emerald-600"
                  aria-label={anchor.resolved ? labels.anchorReopen : labels.anchorMarkResolved}
                  title={anchor.resolved ? labels.anchorReopen : labels.anchorMarkResolved}
                >
                  <FiCheck className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={anchor.id} className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2" style={style}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (readOnly) return;
                setEditingId(anchor.id);
                setSelectedId(null);
              }}
              className={`group relative flex h-9 w-9 items-center justify-center rounded-full border-2 bg-[#fff4a8] text-amber-900 shadow-md ${anchor.resolved ? "border-emerald-500" : anchor.todo ? "border-amber-600" : "border-white"}`}
              aria-label={labels.anchorStickyNote}
            >
              {anchor.todo ? <FiFlag className="h-4 w-4" aria-hidden="true" /> : <FiFileText className="h-4 w-4" aria-hidden="true" />}
              <span className="pointer-events-none absolute bottom-11 left-1/2 hidden w-56 -translate-x-1/2 rounded bg-slate-950 px-2.5 py-2 text-left text-xs font-normal text-white shadow-xl group-hover:block">
                <span className="block whitespace-pre-wrap break-words">{anchor.comment}</span>
                <span className="mt-1 block text-[10px] text-slate-300">{formatAnchorTime(anchor.createdAt)} · {anchor.resolved ? labels.anchorResolved : anchor.todo ? labels.anchorTodo : labels.anchorOpen}</span>
              </span>
            </button>
            {editingId === anchor.id ? (
              <div className="absolute left-5 top-5">
                <ReviewStickyNote
                  initialValue={anchor.comment || ""}
                  initialTodo={anchor.todo}
                  resolved={anchor.resolved}
                  labels={labels}
                  onCancel={() => setEditingId(null)}
                  onSave={(comment, todo) => {
                    updateAnchor(anchor, { comment, todo });
                    setEditingId(null);
                  }}
                  onResolvedChange={(resolved) => updateAnchor(anchor, { resolved })}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {draft && menuPosition ? (
        <div className="absolute" style={menuPosition} onPointerDown={(event) => event.stopPropagation()}>
          {draft.step === "kind" ? (
            <div className="w-60 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
              <div className="mb-1 flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold text-slate-700">{labels.anchorChooseType}</span>
                <button type="button" onClick={closePanels} className="text-slate-400 hover:text-slate-700" aria-label={labels.cancel}><FiX className="h-4 w-4" /></button>
              </div>
              <AnchorKindButton icon={FiSmile} label={labels.anchorReaction} onClick={() => setDraft({ ...draft, step: "reaction" })} />
              <AnchorKindButton icon={FiMessageSquare} label={labels.anchorStickyNote} onClick={() => setDraft({ ...draft, step: "sticky" })} />
              <AnchorKindButton icon={FiTag} label={labels.anchorLabel} onClick={() => setDraft({ ...draft, step: "label" })} />
            </div>
          ) : draft.step === "reaction" ? (
            <div className="flex gap-1 rounded-full border border-slate-200 bg-white p-1.5 shadow-xl">
              {REACTIONS.map((reaction) => (
                <button key={reaction} type="button" onClick={() => createReaction(reaction)} className="flex h-8 w-8 items-center justify-center rounded-full text-lg hover:bg-slate-100">{reaction}</button>
              ))}
            </div>
          ) : draft.step === "sticky" ? (
            <ReviewStickyNote
              initialValue=""
              initialTodo={false}
              resolved={false}
              labels={labels}
              onCancel={closePanels}
              onSave={(comment, todo) => {
                onUpsert({ ...newAnchor("sticky", draft, actorId), comment, todo });
                closePanels();
              }}
            />
          ) : (
            <div className="w-60 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {LABELS.map((label) => (
                  <button key={label} type="button" onClick={() => createLabel(label)} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-blue-400 hover:bg-blue-50">{label}</button>
                ))}
              </div>
              <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); createLabel(customLabel); }}>
                <input value={customLabel} onChange={(event) => setCustomLabel(event.target.value.slice(0, 40))} placeholder={labels.anchorCustomLabel} className="h-8 min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs outline-none focus:border-blue-500" />
                <button type="submit" disabled={!customLabel.trim()} className="h-8 rounded bg-blue-600 px-2 text-xs font-semibold text-white disabled:opacity-35">{labels.confirm}</button>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AnchorKindButton({ icon: Icon, label, onClick }: { icon: typeof FiSmile; label: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm text-slate-700 hover:bg-slate-100">
      <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
      {label}
    </button>
  );
}

function AnchorStatusMenu({ anchor, labels, onUpdate }: { anchor: ReviewAnchor; labels: ShareRoomLabels; onUpdate(patch: Partial<ReviewAnchor>): void }) {
  return (
    <div className="absolute left-10 top-0 flex w-40 flex-col rounded-md border border-slate-200 bg-white p-1.5 text-xs shadow-xl" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => onUpdate({ resolved: !anchor.resolved })} className="flex h-8 items-center gap-2 rounded px-2 text-left font-semibold text-slate-700 hover:bg-slate-100">
        {anchor.resolved ? <FiFlag className="h-4 w-4" /> : <FiCheck className="h-4 w-4 text-emerald-600" />}
        {anchor.resolved ? labels.anchorReopen : labels.anchorMarkResolved}
      </button>
    </div>
  );
}
