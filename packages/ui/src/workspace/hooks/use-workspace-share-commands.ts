import React from "react";
import type { RealtimeService, RealtimeSession } from "@picbind/shared";
import { getRealtimeClientId } from "../../realtime";
import { createWorkspaceShare, rotateWorkspaceShare, shareUrl } from "../api";
import { promoteLocalWorkspace, saveWorkspace } from "../repository";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspaceShareCommands({ workspace, displayName, publicSiteUrl, setWorkspace, setImages, realtimeRef, realtimeService, subscribe, transition, setCopied, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  displayName?: string | null;
  publicSiteUrl?: string;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceIdentity | null>>;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  realtimeRef: React.MutableRefObject<RealtimeSession | null>;
  realtimeService: RealtimeService;
  subscribe: (client: RealtimeSession) => void;
  transition: () => void;
  setCopied: React.Dispatch<React.SetStateAction<boolean>>;
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
    setImages((current) => current.map((image) => ({ ...image, workspaceId: next.workspaceId })));
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

  const copyShare = React.useCallback(async () => {
    if (!workspace?.shareToken) return;
    await navigator.clipboard.writeText(shareUrl(workspace.shareToken, publicSiteUrl));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [publicSiteUrl, setCopied, workspace]);

  return { createShare, rotateShare, copyShare };
}
