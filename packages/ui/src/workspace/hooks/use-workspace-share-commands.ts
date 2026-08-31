import React from "react";
import type { RealtimeService, RealtimeSession } from "@picbind/shared";
import { getRealtimeClientId } from "../../realtime";
import { createWorkspaceShare, rotateWorkspaceShare } from "../api";
import { listWorkspaceImages, promoteLocalWorkspace, saveWorkspace } from "../repository";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspaceShareCommands({ workspace, displayName, setWorkspace, setImages, realtimeRef, realtimeService, subscribe, transition, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  displayName?: string | null;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceIdentity | null>>;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  realtimeRef: React.MutableRefObject<RealtimeSession | null>;
  realtimeService: RealtimeService;
  subscribe: (client: RealtimeSession) => void;
  transition: () => void;
  setNotice: (message: string) => void;
}) {
  const createShare = React.useCallback(async () => {
    if (!workspace) return;
    const created = await createWorkspaceShare(workspace.name);
    const previousId = workspace.workspaceId;
    const next = { ...workspace, workspaceId: created.workspace.id, shareToken: created.workspace.shareId,
      ownerCapability: created.ownerCapability, updatedAt: Date.now() };
    await promoteLocalWorkspace(previousId, next);
    setWorkspace(next);
    setImages(await listWorkspaceImages(next.workspaceId));
    const realtime = await realtimeService.connect({
      workspaceId: next.workspaceId,
      role: next.role,
      shareToken: next.shareToken,
      ownerCapability: next.ownerCapability,
      displayName,
      clientId: getRealtimeClientId(),
    });
    void realtimeRef.current?.close("workspace-replaced");
    realtimeRef.current = realtime;
    subscribe(realtime);
    transition();
  }, [displayName, realtimeRef, realtimeService, setImages, setWorkspace, subscribe, transition, workspace]);

  const rotateShare = React.useCallback(async () => {
    if (!workspace) return;
    const result = await rotateWorkspaceShare(workspace);
    const next = { ...workspace, shareToken: result.workspace.shareId, updatedAt: Date.now() };
    await saveWorkspace(next);
    setWorkspace(next);
    setNotice("A new link was created. The previous link is no longer valid.");
  }, [setNotice, setWorkspace, workspace]);

  return { createShare, rotateShare };
}
