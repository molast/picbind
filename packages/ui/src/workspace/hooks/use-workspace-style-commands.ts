import React from "react";
import type { RealtimeSession } from "@picbind/shared";
import { saveWorkspace } from "../repository";
import { isValidStyle } from "../types";
import type { WorkspaceIdentity, WorkspaceStyle } from "../types";

export function useWorkspaceStyleCommands({ workspace, styleDraft, setWorkspace, setStyleDraft, setSettingsOpen, setNotice, realtimeRef, }: {
  workspace: WorkspaceIdentity | null;
  styleDraft: WorkspaceStyle;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceIdentity | null>>;
  setStyleDraft: React.Dispatch<React.SetStateAction<WorkspaceStyle>>;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: (message: string) => void;
  realtimeRef: React.MutableRefObject<RealtimeSession | null>;
}) {
  const saveStyle = React.useCallback(async () => {
    if (!workspace || workspace.role !== "owner" || !isValidStyle(styleDraft)) return;
    const style = { ...styleDraft, revision: workspace.style.revision + 1 };
    const next = { ...workspace, name: style.header.text.content, style, updatedAt: Date.now() };
    await saveWorkspace(next);
    setWorkspace(next); setStyleDraft(style); setSettingsOpen(false);
    realtimeRef.current?.send("styleUpdated", { style }, { delivery: "reliable" });
  }, [realtimeRef, setSettingsOpen, setStyleDraft, setWorkspace, styleDraft, workspace]);
  return { saveStyle };
}
