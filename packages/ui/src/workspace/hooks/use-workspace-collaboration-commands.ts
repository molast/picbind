import React from "react";
import type { Collaborator, WorkspaceIdentity, WorkspaceImage } from "../types";
import { WorkspaceRealtimeClient } from "../realtime";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function useWorkspaceCollaborationCommands({ workspace, selected, onlinePeers, runtime, message, realtimeRef, pendingSourceRequests, finishSourceRequest, setMessages, setMessage, setReactionCounts, setNotice, setRequestingSourceIds, persistWorkspaceLog, showReaction, }: {
  workspace: WorkspaceIdentity | null;
  selected: WorkspaceImage | null;
  onlinePeers: number;
  runtime: string;
  message: string;
  realtimeRef: React.MutableRefObject<WorkspaceRealtimeClient | null>;
  pendingSourceRequests: React.MutableRefObject<Map<string, { imageId: string; timer: number; eventId?: string }>>;
  finishSourceRequest: (value: { requestId?: string; eventId?: string; imageId?: string }) => void;
  setMessages: React.Dispatch<React.SetStateAction<Array<{ id: string; text: string; actor: string }>>>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setReactionCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setNotice: (message: string) => void;
  setRequestingSourceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  persistWorkspaceLog: (workspaceId: string, kind: string, imageId?: string) => Promise<void>;
  showReaction: (emoji: string) => void;
}) {
  const react = React.useCallback((emoji: string) => {
    if (!onlinePeers) return;
    showReaction(emoji);
    setReactionCounts((current) => ({ ...current, [emoji]: (current[emoji] || 0) + 1 }));
    realtimeRef.current?.send("reaction", { emoji }, { delivery: "ephemeral", dataClass: "presence" });
  }, [onlinePeers, realtimeRef, setReactionCounts, showReaction]);

  const sendMessage = React.useCallback(() => {
    const text = message.trim();
    if (!text || !onlinePeers) return;
    setMessages((current) => [...current, { id: id("message"), text, actor: "You" }]);
    realtimeRef.current?.send("message", { text }, { delivery: "ephemeral" });
    if (workspace) void persistWorkspaceLog(workspace.workspaceId, "message", selected?.imageId);
    setMessage("");
  }, [message, onlinePeers, persistWorkspaceLog, realtimeRef, selected?.imageId, setMessage, setMessages, workspace]);

  const removeCollaborator = React.useCallback((person: Collaborator) => {
    if (workspace?.role !== "owner" || person.role !== "collaborator") return;
    realtimeRef.current?.removeCollaborator(person.clientId);
  }, [realtimeRef, workspace?.role]);

  const requestSource = React.useCallback((value: WorkspaceImage | React.SyntheticEvent | null = selected) => {
    const image = value && "imageId" in value ? value : selected;
    if (!image || !image.shared || !realtimeRef.current || runtime !== "available"
      || [...pendingSourceRequests.current.values()].some((request) => request.imageId === image.imageId)) return;
    const requestId = id("source");
    const eventId = realtimeRef.current.send("sourceRequest", { requestId, imageId: image.imageId }, { route: "owner", delivery: "reliable", dataClass: "collaborationEvent" });
    if (!eventId) return;
    const timer = window.setTimeout(() => { finishSourceRequest({ requestId }); setNotice("Source request timed out"); }, 30_000);
    pendingSourceRequests.current.set(requestId, { imageId: image.imageId, eventId, timer });
    setRequestingSourceIds((current) => new Set(current).add(image.imageId));
  }, [finishSourceRequest, pendingSourceRequests, realtimeRef, runtime, selected, setNotice, setRequestingSourceIds]);

  return { react, sendMessage, removeCollaborator, requestSource };
}
