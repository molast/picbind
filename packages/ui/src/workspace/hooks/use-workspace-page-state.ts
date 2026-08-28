import React from "react";
import { defaultWorkspaceStyle } from "../types";

export function useWorkspacePageState() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Array<{ id: string; text: string; actor: string }>>([]);
  const [reactionCounts, setReactionCounts] = React.useState<Record<string, number>>({});
  const [message, setMessage] = React.useState("");
  const [pendingWorkingImageId, setPendingWorkingImageId] = React.useState<string | null>(null);
  const [compressingToWorkingImageId, setCompressingToWorkingImageId] = React.useState<string | null>(null);
  const [compressionSuggestionWeakNetwork, setCompressionSuggestionWeakNetwork] = React.useState(false);
  const [collaborationOpen, setCollaborationOpen] = React.useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [styleDraft, setStyleDraft] = React.useState(defaultWorkspaceStyle());
  const [notice, setNotice] = React.useState<string | null>(null);
  const [requestingSourceIds, setRequestingSourceIds] = React.useState<Set<string>>(() => new Set());
  const [newVersions, setNewVersions] = React.useState<Record<string, string>>({});
  return { selectedId, setSelectedId, messages, setMessages, reactionCounts, setReactionCounts, message, setMessage, pendingWorkingImageId, setPendingWorkingImageId, compressingToWorkingImageId, setCompressingToWorkingImageId, compressionSuggestionWeakNetwork, setCompressionSuggestionWeakNetwork, collaborationOpen, setCollaborationOpen, libraryCollapsed, setLibraryCollapsed, dragging, setDragging, styleDraft, setStyleDraft, notice, setNotice, requestingSourceIds, setRequestingSourceIds, newVersions, setNewVersions };
}
