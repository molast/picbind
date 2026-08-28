import React from "react";
import { FiUserX } from "react-icons/fi";
import { getLang, getWorkspaceLabels } from "../../locales";
import type { Collaborator } from "../types";
import { workspacePersonName } from "../utils/workspace-person-display";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

export function WorkspaceRemoveCollaboratorDialog({
  collaborator,
  onClose,
  onConfirm,
}: {
  collaborator: Collaborator | null;
  onClose(): void;
  onConfirm(): void;
}) {
  if (!collaborator) return null;
  const displayName = workspacePersonName(collaborator.displayName);
  return <div
    className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4"
    onMouseDown={(event) => event.target === event.currentTarget && onClose()}
  >
    <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
          <FiUserX />
        </div>
        <h2 className="min-w-0 text-base font-semibold text-slate-900">
          {text("removeCollaboratorQuestion")}
        </h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {text("removeCollaboratorDescription").replace("{name}", displayName)}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 rounded-md border px-4 text-sm">
          {text("cancel")}
        </button>
        <button type="button" onClick={onConfirm} className="h-9 rounded-md bg-red-600 px-4 text-sm font-semibold text-white">
          {text("confirmRemoveCollaborator")}
        </button>
      </div>
    </div>
  </div>;
}
