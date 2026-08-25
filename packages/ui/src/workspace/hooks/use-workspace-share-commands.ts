import React from "react";
import { createWorkspaceShare, rotateWorkspaceShare, shareUrl } from "../api";
import { promoteLocalWorkspace, saveWorkspace } from "../repository";
import { WorkspaceRealtimeClient } from "../realtime";
import type { WorkspaceIdentity, WorkspaceImage } from "../types";

export function useWorkspaceShareCommands({ workspace, publicSiteUrl, setWorkspace, setImages, realtimeRef, subscribe, transition, setCopied, setNotice, }: {
  workspace: WorkspaceIdentity | null;
  publicSiteUrl?: string;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceIdentity | null>>;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  realtimeRef: React.MutableRefObject<WorkspaceRealtimeClient | null>;
  subscribe: (client: WorkspaceRealtimeClient) => void;
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
    const realtime = new WorkspaceRealtimeClient(next);
    realtimeRef.current?.disconnect();
    realtimeRef.current = realtime;
    subscribe(realtime);
    transition();
    await realtime.connect();
  }, [realtimeRef, setImages, setWorkspace, subscribe, transition, workspace]);

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
