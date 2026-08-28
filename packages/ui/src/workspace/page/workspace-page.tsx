"use client";

import React from "react";
import { FiMinimize2, FiTerminal, FiUploadCloud } from "react-icons/fi";
import type { RealtimeSession, RealtimeSessionState } from "@picbind/shared";
import { joinWorkspace } from "../api";
import {
  clearOperationLogs, clearWorkspaceImageHistory, deleteCollaborationActivitiesAfter, deleteCollaborationActivitiesByIds, deleteCommitsAfter, deleteWorkspaceImage, listActivities, listCommits, listOperationLogs,
  listProposals, listWorkspaceImages, purgeExpiredCache, restoreLocalWorkspace, restoreProvisionedWorkspace,
  saveActivity, saveCollaborationActivity, saveCommit, saveProposal,
  readWorkspaceImagePreview, readWorkspaceImageSource,
  saveWorkspace, saveWorkspaceImage,
} from "../repository";
import { getRealtimeClientId, useRealtimeService } from "../../realtime";
import { isInboundEventAllowed, validateProposal } from "../policy";
import { workspaceRuntimeReducer } from "../state-machine";
import {
  defaultWorkspaceStyle, isValidStyle, type Collaborator, type WorkspaceActivity,
  type WorkspaceCommit, type WorkspaceEvent, type WorkspaceIdentity, type WorkspaceImage,
  type WorkspaceOperation, type WorkspaceProposal, type WorkspaceStyle,
} from "../types";
import { getLang, getWorkspaceLabels, setLang as persistLang, type Lang } from "../../locales";
import { useImageProcessing } from "../../image-processing";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import ReviewWorkspace from "../../components/share/workspace/review-workspace";
import type { ReviewCollaborationMessage } from "../../utils/review-collaboration";
import {
  needsCollaborationPreviewGeneration,
  reconcileCollaboratorSnapshot,
  sharedWorkingImages,
} from "../image-flow";
import {
  emptyImageParameterDocument,
  isValidImageParameterDocument,
  setImageOperation,
  type ImageParameterDocument,
} from "../image-protocol";
import { disposeCollaborationImageContainer, type CollaborationImageContainer } from "../collaboration-image-container";
import { WorkspaceGallery } from "../components/workspace-gallery";
import { WorkspaceProcessingCanvas } from "../components/workspace-processing-canvas";
import { WorkspaceHeader } from "../components/workspace-header";
import { WorkspaceEditorDialogs } from "../components/workspace-editor-dialogs";
import { blobFromBytes, collaborationPreviewFor, placeholderFrom } from "../utils/workspace-image-display";
import { protocolOperationType } from "../utils/workspace-operation-mapping";
import { cachedCommit, digestBlob } from "../utils/workspace-page-utils";
import { useWorkspaceSelection } from "../hooks/use-workspace-selection";
import { useWorkspaceDialogs } from "../hooks/use-workspace-dialogs";
import { useWorkspacePreview } from "../hooks/use-workspace-preview";
import { useWorkspacePageState } from "../hooks/use-workspace-page-state";
import { WorkspaceLoading, WorkspaceStatusBands, WorkspaceUnavailable } from "./workspace-page-sections";
import { useWorkspaceEditorState } from "../hooks/use-workspace-editor-state";
import { useWorkspaceImageCommands } from "../hooks/use-workspace-image-commands";
import { useWorkspaceProcessedResults } from "../hooks/use-workspace-processed-results";
import { useWorkspacePublishing } from "../hooks/use-workspace-publishing";
import { useWorkspaceCollaborationPreview } from "../hooks/use-workspace-collaboration-preview";
import { useWorkspaceOperationEditor } from "../hooks/use-workspace-operation-editor";
import { useWorkspaceSourceTransfer } from "../hooks/use-workspace-source-transfer";
import { useWorkspaceShareCommands } from "../hooks/use-workspace-share-commands";
import { useWorkspaceOperationCommands } from "../hooks/use-workspace-operation-commands";
import { useWorkspaceRollbackCommands } from "../hooks/use-workspace-rollback-commands";
import { useWorkspaceFileCommands } from "../hooks/use-workspace-file-commands";
import { useWorkspaceCollaborationCommands } from "../hooks/use-workspace-collaboration-commands";
import { useWorkspaceSaveCollaboration } from "../hooks/use-workspace-save-collaboration";
import { useWorkspaceStyleCommands } from "../hooks/use-workspace-style-commands";
import { useWorkspaceProcessedResultCommand } from "../hooks/use-workspace-processed-result-command";
import { useWorkspaceReactions } from "../hooks/use-workspace-reactions";
import { useWorkspaceToast } from "../hooks/use-workspace-toast";
import { WorkspaceSidebar } from "../components/workspace-sidebar";
import { WorkspaceCollaborationPanel } from "../components/workspace-collaboration-panel";
import { WorkspaceImageSidebar } from "../components/workspace-image-sidebar";
import { WorkspaceToast } from "../components/workspace-toast";
import { WorkspaceDialogs } from "../dialogs/workspace-dialogs";
import { WorkspaceSourceRejectedDialog } from "../dialogs/workspace-source-request-dialog";
import { WorkspaceStopCollaborationConfirmDialog } from "../dialogs/workspace-stop-collaboration-confirm-dialog";
import WorkspaceShareIdEntryDialog from "../dialogs/workspace-share-id-entry-dialog";
import {
  updateCollaboratorPacketLoss,
  updateCollaboratorTransport,
} from "../collaborator-network";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const workspaceText = (key: string) => getWorkspaceLabels(getLang())[key] || key;


export default function WorkspacePage({ shareToken, initialWorkspace, userDisplayName, publicSiteUrl, desktop = false }: {
  shareToken?: string;
  initialWorkspace?: WorkspaceIdentity;
  userDisplayName?: string | null;
  publicSiteUrl?: string;
  desktop?: boolean;
}) {
  const imageProcessing = useImageProcessing();
  const realtimeService = useRealtimeService();
  const [lang, setLanguage] = React.useState<Lang>("en");
  const [shareIdEntryOpen, setShareIdEntryOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const realtimeRef = React.useRef<RealtimeSession | null>(null);
  const realtimeEventRef = React.useRef<(value: WorkspaceEvent | Record<string, unknown>) => void>(() => undefined);
  const [workspace, setWorkspace] = React.useState<WorkspaceIdentity | null>(null);
  const [images, setImages] = React.useState<WorkspaceImage[]>([]);
  const [, refreshCollaborationRender] = React.useReducer((version: number) => version + 1, 0);
  const imagesRef = React.useRef<WorkspaceImage[]>([]);
  const [runtime, transitionRuntime] = React.useReducer(workspaceRuntimeReducer, shareToken ? "connecting" : "local");
  const [collaborators, setCollaborators] = React.useState<Collaborator[]>([]);
  const [removedFromWorkspace, setRemovedFromWorkspace] = React.useState(false);
  const [activities, setActivities] = React.useState<WorkspaceActivity[]>([]);
  const [operationLogs, setOperationLogs] = React.useState<WorkspaceActivity[]>([]);
  const [proposals, setProposals] = React.useState<WorkspaceProposal[]>([]);
  const [commitEntries, setCommits] = React.useState<WorkspaceCommit[]>([]);
  const commits = React.useMemo(() => Array.from(new Map(commitEntries.map((commit) => [commit.commitId, commit])).values()), [commitEntries]);
  const { selectedId, setSelectedId, messages, setMessages, reactionCounts, setReactionCounts, message, setMessage, pendingWorkingImageId, setPendingWorkingImageId, compressingToWorkingImageId, setCompressingToWorkingImageId, compressionSuggestionWeakNetwork, setCompressionSuggestionWeakNetwork, collaborationOpen, setCollaborationOpen, libraryCollapsed, setLibraryCollapsed, dragging, setDragging, styleDraft, setStyleDraft, copied, setCopied, notice, setNotice, requestingSourceIds, setRequestingSourceIds, setNewVersions } = useWorkspacePageState();
  const { editing, setEditing, reviewOpen, setReviewOpen, reviewFullscreen, setReviewFullscreen, processingSource, setProcessingSource, editorPreparing, setEditorPreparing, maximizedImageId, setMaximizedImageId } = useWorkspacePreview();
  const { settingsOpen, setSettingsOpen, leaveConfirmOpen, setLeaveConfirmOpen, removingCollaborator, setRemovingCollaborator, operationLogOpen, setOperationLogOpen, proposalPreview, setProposalPreview, sourceRequestDialog, setSourceRequestDialog, sourceRejectReason, setSourceRejectReason, sourceRejectedNotice, setSourceRejectedNotice, rejectingProposal, setRejectingProposal, proposalRejectReason, setProposalRejectReason, activityPreview, setActivityPreview, deletingImage, setDeletingImage, deleteChoice, setDeleteChoice, rollbackTarget, setRollbackTarget, rollbackPreview, setRollbackPreview, saveCollaborationOpen, setSaveCollaborationOpen, collaborationSaving, setCollaborationSaving, stopCollaborationImage, setStopCollaborationImage, stoppingCollaboration, setStoppingCollaboration, pendingProcessedResult, setPendingProcessedResult, processedResultSaving, setProcessedResultSaving } = useWorkspaceDialogs();
  const confirmLeaveWorkspace = React.useCallback(() => {
    setLeaveConfirmOpen(false);
    const realtime = realtimeRef.current;
    realtimeRef.current = null;
    void realtime?.close("page-left").catch(() => undefined);
    transitionRuntime({ type: "transition", next: "unavailable" });
  }, [setLeaveConfirmOpen]);
  const reviewListeners = React.useRef(new Set<(event:{sequence:number;message:ReviewCollaborationMessage})=>void>());
  const pendingProposalEvents = React.useRef(new Map<string, string>());
  const handledProposalFailures = React.useRef(new Set<string>());
  const pendingSourceRequests = React.useRef(new Map<string, { imageId: string; timer: number; eventId?: string }>());
  const collaborationContainers = React.useRef(new Map<string, CollaborationImageContainer>());
  const { showReaction, reactionNodes, reactionTimers } = useWorkspaceReactions();
  const { toastMessage, showToast } = useWorkspaceToast();
  const { deduplicatedImages, selected, selectedIsLibrary, onlineCollaborators, onlinePeers, libraryImages, workingImages, workingImagesSorted, compressingToWorkingImage, completeOperationLog, selectedCollaborationActivities, currentCollaborationActivityId, activityPreviewIsCurrent, selectedOriginalCommit } = useWorkspaceSelection({ images, workspace, selectedId, pendingWorkingImageId, compressingToWorkingImageId, collaborators, runtime, activities, operationLogs, commits, activityPreviewEventId: activityPreview?.activity.eventId });
  const maximizedWorkspaceImage = images.find((image) => image.imageId === maximizedImageId && image.workspaceLocation === "working") || null;
  const maximizedPreviewBlob = maximizedWorkspaceImage
    ? collaborationPreviewFor(maximizedWorkspaceImage, workspace, collaborationContainers.current)
    : undefined;
  imagesRef.current = deduplicatedImages;

  React.useEffect(() => {
    setLanguage(getLang());
  }, []);

  React.useEffect(() => {
    if (deduplicatedImages.length !== images.length) setImages(deduplicatedImages);
  }, [deduplicatedImages, images.length]);

  React.useEffect(() => {
    if (!activityPreview || activityPreview.activity.imageId === selectedId) return;
    const previousImage = imagesRef.current.find((image) => image.imageId === activityPreview.activity.imageId);
    setActivityPreview(null);
    if (previousImage) {
      void syncCollaborationPreview(
        previousImage,
        previousImage.parameterDocument || emptyImageParameterDocument(),
      ).catch(()=>undefined);
    }
  }, [activityPreview, selectedId]);

  const persistWorkspaceLog = React.useCallback(async (workspaceId: string, kind: string, imageId?: string, detail?: unknown, actorId = "local") => {
    const value: WorkspaceActivity = { eventId: id("log"), sequence: Date.now(), actorId, kind, imageId, detail, createdAt: Date.now(), scope: "workspaceLog" };
    setOperationLogs((current) => [...current.slice(-499), value]); await saveActivity(workspaceId, value);
  }, []);

  const persistCollaborationActivity = React.useCallback(async (workspaceId: string, kind: string, imageId: string, detail: unknown, actorId = "local") => {
    const value: WorkspaceActivity = { eventId: id("activity"), sequence: Date.now(), actorId, kind, imageId, detail, createdAt: Date.now(), scope: "collaborationActivity" };
    setActivities((current) => [...current.slice(-99), value]); await saveCollaborationActivity(workspaceId, value);
  }, []);

  function finishSourceRequest({requestId,eventId,imageId}:{requestId?:string;eventId?:string;imageId?:string}) {
    const entry = requestId ? pendingSourceRequests.current.get(requestId) : [...pendingSourceRequests.current.values()]
      .find((request) => request.eventId === eventId || request.imageId === imageId);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    for (const [key, request] of pendingSourceRequests.current) {
      if (request === entry) pendingSourceRequests.current.delete(key);
    }
    setRequestingSourceIds((current) => {
      if (!current.has(entry.imageId)) return current;
      const next = new Set(current);
      next.delete(entry.imageId);
      return next;
    });
  }

  const updateImage = React.useCallback(async (imageId: string, patch: Partial<WorkspaceImage>) => {
    const current = imagesRef.current;
    const image = current.find((candidate) => candidate.imageId === imageId);
    if (!image) return;
    const updated = {
      ...image,
      ...patch,
      sourceCached: image.sourceCached || Boolean(patch.source),
      previewCached: image.previewCached || Boolean(patch.preview),
      updatedAt: Date.now(),
    };
    const writeBlobs = Object.prototype.hasOwnProperty.call(patch, "source")
      || Object.prototype.hasOwnProperty.call(patch, "preview");
    await saveWorkspaceImage(updated, { writeBlobs });
    const cached = { ...updated, source: undefined, preview: undefined };
    const next = current.map((candidate) => candidate.imageId === imageId ? cached : candidate);
    imagesRef.current = next;
    setImages(next);
  }, []);

  const subscribeReviewMessages = React.useCallback((listener: (event: {
    sequence: number;
    message: ReviewCollaborationMessage;
  }) => void) => {
    reviewListeners.current.add(listener);
    return () => reviewListeners.current.delete(listener);
  }, []);

  const sendReviewMessage = React.useCallback((message: ReviewCollaborationMessage) => {
    realtimeRef.current?.send("reviewMessage", { message }, { delivery: "reliable" });
    return true;
  }, []);

  const handleReviewStatusChange = React.useCallback((
    imageId: string,
    status: "in-review" | "approved" | undefined,
  ) => {
    const image = imagesRef.current.find((candidate) => candidate.imageId === imageId);
    if (!image) return;
    const state = status === "in-review"
      ? "reviewing" as const
      : status === "approved"
        ? "committed" as const
        : image.state;
    if (state === image.state) return;
    void updateImage(imageId, { state });
  }, [updateImage]);

  const handleReviewEditingChange = React.useCallback(() => undefined, []);

  const { loadSource, syncCollaborationPreview, renderCollaborationPreviewSnapshot, syncCollaborationContainer } = useWorkspaceCollaborationPreview({
    imagesRef, collaborationContainers, refresh: refreshCollaborationRender, processingSource,
  });

  const { openImageOperation, releaseProcessingSource } = useWorkspaceOperationEditor({
    imagesRef, collaborationContainers, loadSource, setSelectedId, setProcessingSource, setEditing,
    setReviewOpen, setEditorPreparing, setNotice,
  });

  const { addFiles, downloadImage } = useWorkspaceFileCommands({
    workspace, inputRef, setImages, setCommits, setSelectedId, persistWorkspaceLog, loadSource, setNotice,
  });

  function maximizeWorkspaceImage(image: WorkspaceImage) {
    setSelectedId(image.imageId);
    setMaximizedImageId(image.imageId);
  }

  const sendWorkspaceSnapshot = React.useCallback(async (targetUserId?: string) => {
    if (!workspace || workspace.role !== "owner") return;
    const sharedImages = sharedWorkingImages(imagesRef.current);
    const sharedCommits = (await Promise.all(sharedImages.map((image) => listCommits(image.imageId)))).flat().map(cachedCommit);
    const route = targetUserId ? "user" as const : "workspace" as const;
    realtimeRef.current?.send("stateSnapshot", {
      images: sharedImages.map(({ source: _source, preview: _preview, sourceCached: _sourceCached, previewCached: _previewCached, ...image }) => image),
      commits: sharedCommits,
      style: workspace.style,
    }, { route, targetUserId, delivery: "reliable" });
    sharedImages.forEach((image) => {
      if (needsCollaborationPreviewGeneration(image)) {
        void readWorkspaceImageSource(image).then((source) => {
          if (source) return publishPreview(image, source, targetUserId);
        }).catch((error) => {
          if (imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) {
            setNotice(error instanceof Error ? error.message : "Source preview is unavailable");
          }
        });
        return;
      }
      if (image.placeholder) realtimeRef.current?.send("placeholderUpsert", {
        imageId: image.imageId,
        imageName: image.name,
        mimeType: image.mimeType,
        size: image.size,
        width: image.width,
        height: image.height,
        placeholder: image.placeholder,
        revision: image.previewRevision,
        currentCommitId: image.currentCommitId,
      }, { route, targetUserId, delivery: "reliable", dataClass: "preview" });
      if (image.previewCached) void readWorkspaceImagePreview(image).then(async (preview) => {
        if (!preview) return;
        realtimeRef.current?.sendBinary("previewUpsert", {
          image: {
            imageId: image.imageId,
            imageName: image.name,
            mimeType: preview.type || "image/webp",
            sourceMimeType: image.mimeType,
            size: image.size,
            width: image.width,
            height: image.height,
            placeholder: image.placeholder,
            version: image.previewRevision,
            currentCommitId: image.currentCommitId,
          },
        }, await preview.arrayBuffer(), { route, targetUserId, delivery: "bulk", dataClass: "preview" });
      });
    });
  }, [workspace]);

  const handleRealtimeEvent = React.useCallback((value: WorkspaceEvent | Record<string, unknown>) => {
    const type = String(value.type || "");
    if (type === "stateChanged" && typeof value.state === "string" && typeof value.senderId !== "string") {
      transitionRuntime({
        type: "realtimeStateChanged",
        state: value.state as RealtimeSessionState,
      });
      return;
    }
    if (type === "error" && typeof value.senderId !== "string") {
      const realtimeError = value.error;
      if (realtimeError && typeof realtimeError === "object"
        && typeof (realtimeError as { message?: unknown }).message === "string") {
        setNotice((realtimeError as { message: string }).message);
      }
      return;
    }
    if (type === "peerTransportChanged" && typeof value.senderId !== "string"
      && typeof value.userId === "string" && (value.transport === "socket" || value.transport === "rtc")) {
      setCollaborators((current) => updateCollaboratorTransport(current, value.userId as string, value.transport as "socket" | "rtc"));
      return;
    }
    if (type === "peerNetworkStats" && typeof value.senderId !== "string"
      && typeof value.userId === "string" && typeof value.packetLossRate === "number") {
      setCollaborators((current) => updateCollaboratorPacketLoss(current, value.userId as string, value.packetLossRate as number));
      return;
    }
    if (workspace && !isInboundEventAllowed(workspace.role, type, value.senderRole)) return;
    if(workspace&&["placeholderUpsert","previewRemove","sourceRequest","styleUpdated","message"].includes(type))void persistWorkspaceLog(workspace.workspaceId,type,typeof value.imageId==="string"?value.imageId:undefined,{senderName:value.senderName,reason:value.reason},typeof value.senderId==="string"?value.senderId:"remote");
    if (type === "syncRequired") { transitionRuntime({type:"transition",next:"syncing"}); realtimeRef.current?.send("stateRequest", {}, { route: "owner", delivery: "reliable" }); }
    else if (type === "deliveryFailed" && value.eventType === "sourceRequest" && typeof value.eventId === "string") {
      finishSourceRequest({eventId:value.eventId});
      setNotice("Source request could not be delivered");
    }
    else if (type === "deliveryFailed" && value.eventType === "proposalSubmit" && typeof value.eventId === "string") {
      if (handledProposalFailures.current.has(value.eventId)) return;
      handledProposalFailures.current.add(value.eventId);
      const proposalId = pendingProposalEvents.current.get(value.eventId);
      if (!proposalId) return;
      pendingProposalEvents.current.delete(value.eventId);
      setProposals((current) => {
        const index = current.findIndex((proposal) => proposal.proposalId === proposalId);
        if (index < 0 || current[index].state === "failed") return current;
        const failed = { ...current[index], state: "failed" as const };
        const next = current.slice();
        next[index] = failed;
        void saveProposal(failed);
        return next;
      });
    }
    else if (type === "memberRemoved" && workspace?.role === "collaborator") {
      const realtime = realtimeRef.current;
      realtimeRef.current = null;
      void realtime?.close("member-removed").catch(() => undefined);
      transitionRuntime({type:"transition",next:"unavailable"});
      setRemovedFromWorkspace(true);
    }
    else if (type === "connected") { transitionRuntime({type:"transition",next:"connected"}); const members = Array.isArray(value.members) ? value.members as Array<Record<string, unknown>> : []; setCollaborators((current) => members.map((member) => { const clientId=String(member.userId); const previous=current.find((person)=>person.clientId===clientId); return { clientId, displayName:String(member.userName||member.role||"Guest"), role:member.role==="owner"?"owner":"collaborator", online:true, transport:previous?.transport||"socket", packetLossRate:previous?.packetLossRate }; })); if(workspace?.role==="owner")transitionRuntime({type:"transition",next:"available"});else transitionRuntime({type:"transition",next:value.ownerOnline === false ? "ownerOffline" : "syncing"}); }
    else if (type === "memberJoined") {
      setCollaborators((current) => { const previous=current.find((item)=>item.clientId===value.userId); return [...current.filter((item) => item.clientId !== value.userId), { clientId:String(value.userId), displayName:String(value.userName||"Guest"), role:value.role==="owner"?"owner":"collaborator", online:true, transport:previous?.transport||"socket", packetLossRate:previous?.packetLossRate }]; });
      if (workspace?.role === "owner" && value.role === "collaborator" && typeof value.userId === "string") {
        sendWorkspaceSnapshot(value.userId);
      }
    }
    else if (type === "memberLeft") setCollaborators((current) => current.filter((item) => item.clientId !== value.userId));
    else if (type === "presence" && typeof value.senderId === "string") setCollaborators((current)=>current.map((item)=>item.clientId===value.senderId?{...item,online:true,currentAction:typeof value.action==="string"?value.action:undefined,currentImageId:typeof value.imageId==="string"?value.imageId:undefined}:item));
    else if (type === "ownerPresence") transitionRuntime({type:"transition",next:value.online ? "syncing" : "ownerOffline"});
    else if (type === "stateRequest" && workspace?.role === "owner" && typeof value.senderId === "string") {
      sendWorkspaceSnapshot(value.senderId);
    }
    else if (type === "stateSnapshot") {
      transitionRuntime({type:"transition",next:"available"});
      if (value.style && isValidStyle(value.style as WorkspaceStyle)) {
        setStyleDraft(value.style as WorkspaceStyle);
        setWorkspace((current) => current ? { ...current, style: value.style as WorkspaceStyle } : current);
      }
      if (Array.isArray(value.images)) {
        const incomingImages = (value.images as WorkspaceImage[])
          .filter((image) => image.shared ?? image.state !== "private")
          .map((image) => ({ ...image, workspaceLocation: "working" as const }));
        const reconciled = reconcileCollaboratorSnapshot(imagesRef.current, incomingImages);
        imagesRef.current = reconciled.images;
        setImages(reconciled.images);
        if (maximizedImageId && reconciled.removedImageIds.includes(maximizedImageId)) setMaximizedImageId(null);
        reconciled.removedImageIds.forEach((imageId) => void deleteWorkspaceImage(imageId));
        reconciled.images.forEach((image) => void saveWorkspaceImage(image));
        reconciled.images
          .filter((image) => image.shared && (image.sourceCached || image.previewCached))
          .forEach((image) => void syncCollaborationPreview(
            image,
            image.parameterDocument || emptyImageParameterDocument(),
          ).catch((error) => setNotice(error instanceof Error ? error.message : "Image preview is unavailable")));
      }
      if (Array.isArray(value.commits)) {
        const incomingCommits = (value.commits as WorkspaceCommit[]).filter((commit) => typeof commit?.commitId === "string" && typeof commit?.imageId === "string");
        const sharedImageIds = new Set((value.images as WorkspaceImage[] | undefined)?.map((image) => image.imageId) || []);
        setCommits((current) => [...current.filter((commit) => !sharedImageIds.has(commit.imageId)), ...incomingCommits.map(cachedCommit)]);
        incomingCommits.forEach((commit) => void saveCommit(commit));
      }
    }
    else if (type === "placeholderUpsert") {
      const imageId=String(value.imageId),revision=Number(value.revision||1);
      const existing=imagesRef.current.find((image)=>image.imageId===imageId);
      if(existing&&revision<existing.previewRevision)return;
      const incoming:WorkspaceImage={imageId,workspaceId:workspace?.workspaceId||"",name:String(value.imageName||existing?.name||"Shared image"),mimeType:String(value.mimeType||existing?.mimeType||"image/*"),size:Number(value.size||existing?.size||0),width:Number(value.width||existing?.width||0),height:Number(value.height||existing?.height||0),workspaceLocation:"working",state:existing?.state||"shared",shared:true,currentCommitId:typeof value.currentCommitId==="string"?value.currentCommitId:existing?.currentCommitId||null,previewRevision:revision,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now(),sourceCached:existing?.sourceCached,previewCached:existing?.previewCached,placeholder:placeholderFrom(value.placeholder)||existing?.placeholder};
      imagesRef.current=[...imagesRef.current.filter((image)=>image.imageId!==imageId),incoming];
      setImages(imagesRef.current);
      void saveWorkspaceImage(incoming);
    }
    else if (type === "previewUpsert") {
      const data=value.image as Record<string,unknown>|undefined;
      if(data){
        const imageId=String(data.imageId),revision=Number(data.version||1),preview=blobFromBytes(data.bytes??value.bytes,String(data.mimeType||"image/webp"));
        if(preview){
          const existing=imagesRef.current.find((candidate)=>candidate.imageId===imageId);
          const image:WorkspaceImage=existing||{
            imageId,workspaceId:workspace?.workspaceId||"",name:String(data.imageName||"Shared image"),
            mimeType:String(data.sourceMimeType||"image/*"),size:Number(data.size||0),
            width:Number(data.width||0),height:Number(data.height||0),workspaceLocation:"working",
            state:"shared",shared:true,currentCommitId:typeof data.currentCommitId==="string"?data.currentCommitId:null,
            previewRevision:0,createdAt:Date.now(),updatedAt:Date.now(),
            placeholder:placeholderFrom(data.placeholder),sourceCached:false,previewCached:false,
          };
          if(revision>image.previewRevision||!image.previewCached)void (async()=>{
            const persisted={...image,preview,previewCached:true,shared:true,previewRevision:revision,width:Number(data.width||image.width),height:Number(data.height||image.height),placeholder:placeholderFrom(data.placeholder)||image.placeholder,updatedAt:Date.now()};
            const cached={...persisted,preview:undefined};
            imagesRef.current=[
              ...imagesRef.current.filter((candidate)=>candidate.imageId!==imageId),
              cached,
            ];
            setImages(imagesRef.current);
            await saveWorkspaceImage(persisted);
            const previous=collaborationContainers.current.get(imageId);
            if(previous)disposeCollaborationImageContainer(previous);
            collaborationContainers.current.delete(imageId);
            await syncCollaborationPreview(cached,cached.parameterDocument||emptyImageParameterDocument());
          })().catch((error)=>setNotice(error instanceof Error?error.message:"The received preview could not be decoded"));
        }
      }
    }
    else if (type === "previewRemove") {
      const imageId = String(value.imageId);
      void deleteWorkspaceImage(imageId);
      const nextImages = imagesRef.current.filter((image) => image.imageId !== imageId);
      imagesRef.current = nextImages;
      setImages(nextImages);
      setActivities((current) => current.filter((activity) => activity.imageId !== imageId));
      setCommits((current) => current.filter((commit) => commit.imageId !== imageId));
      setProposals((current) => current.filter((proposal) => proposal.imageId !== imageId));
      const container = collaborationContainers.current.get(imageId);
      if (container) disposeCollaborationImageContainer(container);
      collaborationContainers.current.delete(imageId);
      finishSourceRequest({imageId});
      setMaximizedImageId(null);
      setProcessingSource(null);
      setEditing(null);
      setReviewOpen(false);
      setActivityPreview(null);
      setRollbackTarget(null);
      setRollbackPreview(null);
      setNewVersions((current) => {
        if (!(imageId in current)) return current;
        const next = { ...current };
        delete next[imageId];
        return next;
      });
    }
    else if (type === "sourceRequest" && workspace?.role === "owner") setSourceRequestDialog(value);
    else if (type === "sourceStart" || type === "sourceChunk" || type === "sourceComplete") void receiveSource(value).catch((error) => {
      finishSourceRequest({requestId:typeof value.requestId==="string"?value.requestId:undefined});
      setNotice(error instanceof Error ? error.message : "The received image could not be decoded");
    });
    else if (type === "sourceRejected") { const requestId=typeof value.requestId==="string"?value.requestId:undefined; const pending=requestId?pendingSourceRequests.current.get(requestId):undefined; const imageId=typeof value.imageId==="string"?value.imageId:pending?.imageId; const reason=typeof value.reason==="string"&&value.reason.trim()?value.reason:"Rejected by Owner"; finishSourceRequest({requestId,imageId}); setSourceRejectedNotice({reason,imageId}); if(workspace)void persistWorkspaceLog(workspace.workspaceId,"sourceRejected",imageId,{reason},typeof value.senderId==="string"?value.senderId:"owner"); }
    else if (type === "proposalSubmit" && workspace?.role === "owner" && value.proposal && typeof value.senderId === "string") { const incoming=value.proposal as WorkspaceProposal,senderId=value.senderId,image=images.find((item)=>item.imageId===incoming.imageId); if (!validateProposal(incoming,workspace.workspaceId,image) || !incoming.commit || incoming.commit.imageId !== incoming.imageId || incoming.commit.operations.length !== incoming.operations.length) return; const proposal={...incoming,state:image!.currentCommitId&&image!.currentCommitId!==incoming.baseCommitId?"conflict" as const:"pending" as const,authorId:senderId,operations:incoming.operations.map((operation)=>({...operation,authorId:senderId})),commit:incoming.commit}; setProposals((current)=>current.some((p)=>p.proposalId===proposal.proposalId)?current:[...current,proposal]); void saveCommit(proposal.commit);setCommits((current)=>current.some((commit)=>commit.commitId===proposal.commit!.commitId)?current:[...current,cachedCommit(proposal.commit!)]); void saveProposal(proposal); void updateImage(proposal.imageId,{state:"reviewing"}); void persistCollaborationActivity(workspace.workspaceId,"proposalSubmitted",proposal.imageId,{proposalId:proposal.proposalId,commitId:proposal.commit.commitId,operations:proposal.operations.map(({operationId,type,parameters})=>({operationId,type,parameters})),status:proposal.state},senderId); }
    else if (type === "proposalDecision") {
      const proposalId = String(value.proposalId);
      const proposal = proposals.find((candidate) => candidate.proposalId === proposalId);
      if (!proposal) return;
      const next = { ...proposal, state: String(value.state) as WorkspaceProposal["state"], rejectReason: typeof value.reason === "string" ? value.reason : undefined };
      const operation = proposal.operations[0];
      setProposals((current) => current.map((candidate) => candidate.proposalId === proposalId ? next : candidate));
      void saveProposal(next);
      if (workspace) void persistCollaborationActivity(workspace.workspaceId, `proposal${next.state[0].toUpperCase()}${next.state.slice(1)}`, proposal.imageId, {
        proposalId,
        commitId: typeof value.commitId === "string" ? value.commitId : undefined,
        operationType: typeof value.operationType === "string" ? value.operationType : operation?.type,
        operations: Array.isArray(value.operations) ? value.operations : proposal.operations.map(({ operationId, type, parameters, authorId }) => ({ operationId, operationType: type, parameters, actorId: authorId })),
        parameterDocument: isValidImageParameterDocument(value.parameterDocument) ? value.parameterDocument : undefined,
        reason: next.rejectReason,
      }, "owner");
      if (next.state === "rejected" || next.state === "later") {
        const image = imagesRef.current.find((candidate) => candidate.imageId === proposal.imageId);
        if (image?.sourceCached) void syncCollaborationPreview(image, image.parameterDocument || emptyImageParameterDocument()).catch((error) => setNotice(error instanceof Error ? error.message : "Image preview is unavailable"));
      }
    }
    else if (type === "commitCreated" && value.commit) {
      const commit=value.commit as WorkspaceCommit;
      if(workspace?.role==="collaborator"&&!imagesRef.current.some((image)=>image.imageId===commit.imageId))return;
      const parameterDocument=isValidImageParameterDocument(value.parameterDocument)?value.parameterDocument:undefined;
      const cached=cachedCommit(commit);
      setCommits((current)=>[...current.filter((item)=>item.commitId!==commit.commitId),cached]);
      if(workspace?.role==="collaborator") {
        setNewVersions((current)=>({...current,[commit.imageId]:commit.commitId}));
        const image=imagesRef.current.find((candidate)=>candidate.imageId===commit.imageId);
        if(image){
          const patched={...image,currentCommitId:commit.commitId,...(parameterDocument ? { parameterDocument } : {}),state:"shared" as const};
          imagesRef.current=imagesRef.current.map((candidate)=>candidate.imageId===commit.imageId?patched:candidate);
          setImages(imagesRef.current);
          void updateImage(commit.imageId,{currentCommitId:commit.commitId,parameterDocument,state:"shared"});
          if((patched.sourceCached||patched.previewCached)&&parameterDocument)void syncCollaborationPreview(patched,parameterDocument).catch((error)=>setNotice(error instanceof Error?error.message:"Image preview is unavailable"));
        }
        const operation=commit.operations.at(-1);
        if(operation)void persistCollaborationActivity(workspace.workspaceId,"operationCommitted",commit.imageId,{operationId:operation.operationId,operationType:operation.type,parameters:operation.parameters,commitId:commit.commitId,actorId:operation.authorId,parameterDocument},"owner");
      }
      void saveCommit(commit);
    }
    else if (type === "historyRolledBack" && value.imageId && value.commitId) {
      const imageId=String(value.imageId),commitId=String(value.commitId);
      const parameterDocument=isValidImageParameterDocument(value.parameterDocument)?value.parameterDocument:emptyImageParameterDocument();
      const targetCreatedAt=Number(value.targetCreatedAt||0);
      const activityCreatedAt=typeof value.activityCreatedAt==="number"?value.activityCreatedAt:null;
      const removedProposalIds=new Set(Array.isArray(value.removedProposalIds)?value.removedProposalIds.filter((proposalId):proposalId is string=>typeof proposalId==="string"):[]);
      const proposalStates=new Map(proposals.map((proposal)=>[proposal.proposalId,proposal.state]));
      const proposalCreatedAt=new Map(proposals.map((proposal)=>[proposal.proposalId,proposal.createdAt]));
      if(targetCreatedAt){setCommits((current)=>current.filter((commit)=>commit.imageId!==imageId||commit.createdAt<=targetCreatedAt));void deleteCommitsAfter(imageId,targetCreatedAt);}
      if(workspace&&activityCreatedAt!==null){
        const retainedCommitIds=new Set(commits.filter((commit)=>commit.imageId===imageId&&commit.createdAt<=targetCreatedAt).map((commit)=>commit.commitId));
        const removedActivityIds:string[]=[];
        setActivities((current)=>{
          const imageActivities=current.filter((activity)=>activity.imageId===imageId);
          const targetCommit=commits.find((commit)=>commit.commitId===commitId&&commit.imageId===imageId);
          const targetOperationIds=new Set(targetCommit?.operations.map((operation)=>operation.operationId) || []);
          // A proposal submission and its approval share the same Commit ID.
          // Rollback must stop at the latest matching Activity (the approval),
          // otherwise collaborators keep the stale submitted entry.
          const reverseTargetIndex=imageActivities.slice().reverse().findIndex((activity: WorkspaceActivity)=>{
            const detail=activity.detail&&typeof activity.detail==="object"?activity.detail as Record<string,unknown>:null;
            if(detail?.commitId===commitId)return true;
            if(!targetOperationIds.size)return false;
            if(typeof detail?.operationId==="string"&&targetOperationIds.has(detail.operationId))return true;
            const operations=Array.isArray(detail?.operations)?detail.operations:[];
            return operations.some((operation)=>operation&&typeof operation==="object"&&typeof (operation as Record<string,unknown>).operationId==="string"&&targetOperationIds.has((operation as Record<string,unknown>).operationId as string));
          });
          const targetIndex=reverseTargetIndex<0?-1:imageActivities.length-1-reverseTargetIndex;
          if(targetIndex>=0){
            const retainedEvents=new Set(imageActivities.slice(0,targetIndex+1).map((activity)=>activity.eventId));
            return current.filter((activity)=>{
              if(activity.imageId!==imageId)return true;
              const keep=retainedEvents.has(activity.eventId);
              if(!keep)removedActivityIds.push(activity.eventId);
              return keep;
            });
          }
          return current.filter((activity)=>{
          if(activity.imageId!==imageId)return true;
          const detail=activity.detail&&typeof activity.detail==="object"?activity.detail as Record<string,unknown>:null;
          const activityCommitId=typeof detail?.commitId==="string"?detail.commitId:null;
          if(activityCommitId){const keep=retainedCommitIds.has(activityCommitId);if(!keep)removedActivityIds.push(activity.eventId);return keep;}
          const proposalId=typeof detail?.proposalId==="string"?detail.proposalId:null;
          if(!proposalId)return true;
          if(removedProposalIds.has(proposalId)){removedActivityIds.push(activity.eventId);return false;}
          if(activity.kind === "proposalSubmitted"){
            const state=proposalStates.get(proposalId);
            const createdAt=proposalCreatedAt.get(proposalId) || 0;
            const keep=state !== "submitted" && state !== "pending" && state !== "conflict" && (!targetCreatedAt || createdAt <= targetCreatedAt);if(!keep)removedActivityIds.push(activity.eventId);return keep;
          }
          return true;
          });
        });
        void deleteCollaborationActivitiesByIds(workspace.workspaceId, removedActivityIds);
        setActivities((current)=>{
          const hasCurrent=current.some((activity)=>{
            if(activity.imageId!==imageId)return false;
            const detail=activity.detail&&typeof activity.detail==="object"?activity.detail as Record<string,unknown>:null;
            return detail?.commitId===commitId;
          });
          if(hasCurrent)return current;
          const candidateIndex=current.reduce((latestIndex,activity,index)=>activity.imageId===imageId&&(activity.kind==="proposalApproved"||activity.kind==="operationCommitted")?index:latestIndex,-1);
          if(candidateIndex<0)return current;
          return current.map((activity,index)=>{
            if(index!==candidateIndex)return activity;
            const detail=activity.detail&&typeof activity.detail==="object"?activity.detail as Record<string,unknown>:{};
            return {...activity,detail:{...detail,commitId}};
          });
        });
      }
      const image=imagesRef.current.find((candidate)=>candidate.imageId===imageId);
      if(image){
        const patched={...image,currentCommitId:commitId,parameterDocument,state:"shared" as const};
        imagesRef.current=imagesRef.current.map((candidate)=>candidate.imageId===imageId?patched:candidate);
        setImages(imagesRef.current);
        void updateImage(imageId,{currentCommitId:commitId,parameterDocument,state:"shared"});
        if(patched.sourceCached||patched.previewCached)void syncCollaborationPreview(patched,parameterDocument).catch((error)=>setNotice(error instanceof Error?error.message:"Image preview is unavailable"));
      }
    }
    else if (type === "styleUpdated" && value.style && isValidStyle(value.style as WorkspaceStyle)) { const style=value.style as WorkspaceStyle; setWorkspace((current)=>{if(!current||style.revision<=current.style.revision)return current;const next={...current,name:style.header.text.content,style};setStyleDraft(style);void saveWorkspace(next);return next;}); }
    else if (type === "reaction") {
      const emoji = String(value.emoji || "👍");
      showReaction(emoji);
      setReactionCounts((current) => ({ ...current, [emoji]: (current[emoji] || 0) + 1 }));
    }
    else if (type === "message") setMessages((current)=>[...current,{id:String(value.eventId||id("message")),text:String(value.text||""),actor:String(value.senderName||"Guest")}]);
    else if (type === "reviewMessage" && value.message) reviewListeners.current.forEach((listener)=>listener({sequence:Number(value.sequence||0),message:value.message as ReviewCollaborationMessage}));
  }, [images, maximizedImageId, persistCollaborationActivity, persistWorkspaceLog, sendWorkspaceSnapshot, updateImage, workspace]);
  realtimeEventRef.current = handleRealtimeEvent;

  const { sourceTransfers, receiveSource, acceptSourceRequest, rejectSourceRequest } = useWorkspaceSourceTransfer({
    images, imagesRef, collaborationContainers, sourceRequestDialog, sourceRejectReason, setImages, setNewVersions,
    setSourceRequestDialog, setSourceRejectReason, setNotice, finishSourceRequest, syncCollaborationPreview,
    sendRealtime: (type, payload, options) => realtimeRef.current?.send(type, payload, options as any),
    sendRealtimeBinary: (type, payload, bytes, options) => realtimeRef.current?.sendBinary(type, payload, bytes, options as any), digestBlob,
  });

  React.useEffect(() => { let active=true; void (async()=>{ let current:WorkspaceIdentity; if(shareToken){const joined=await joinWorkspace(shareToken);current={workspaceId:joined.workspace.id,name:joined.workspace.name,role:"collaborator",shareToken,ownerCapability:null,createdAt:Date.parse(joined.workspace.createdAt),updatedAt:Date.parse(joined.workspace.updatedAt),style:defaultWorkspaceStyle()};await saveWorkspace(current);}else current=initialWorkspace?await restoreProvisionedWorkspace(initialWorkspace):await restoreLocalWorkspace();await purgeExpiredCache(); if(!active)return; setWorkspace(current);setStyleDraft(current.style);const [storedImages,storedActivities,storedLogs,storedProposals]=await Promise.all([listWorkspaceImages(current.workspaceId),listActivities(current.workspaceId),listOperationLogs(current.workspaceId),listProposals(current.workspaceId)]);if(!active)return;setImages(storedImages);setActivities(storedActivities);setOperationLogs(storedLogs);setProposals(storedProposals);if(current.role==="collaborator"||current.shareToken){const realtime=await realtimeService.connect({workspaceId:current.workspaceId,role:current.role,shareToken:current.shareToken,ownerCapability:current.ownerCapability,displayName:userDisplayName,clientId:getRealtimeClientId()});if(!active){await realtime.close("stale-workspace");return;}realtimeRef.current=realtime;realtime.subscribe((value)=>realtimeEventRef.current(value));transitionRuntime({type:"transition",next:"connecting"});}})().catch((error)=>{setNotice(error instanceof Error?error.message:"Workspace unavailable");transitionRuntime({type:"transition",next:"unavailable"});});return()=>{active=false;sourceTransfers.current.clear();pendingProposalEvents.current.clear();handledProposalFailures.current.clear();pendingSourceRequests.current.forEach((request)=>window.clearTimeout(request.timer));pendingSourceRequests.current.clear();collaborationContainers.current.forEach((container)=>disposeCollaborationImageContainer(container));collaborationContainers.current.clear();reactionTimers.current.forEach((timer)=>window.clearTimeout(timer));reactionTimers.current.clear();reactionNodes.current.forEach((node)=>node.remove());reactionNodes.current.clear();void realtimeRef.current?.close("page-left");realtimeRef.current=null;};},[initialWorkspace?.workspaceId,realtimeService,shareToken,userDisplayName]);

  React.useEffect(() => { if (!selectedId && images[0]) setSelectedId(images[0].imageId); if (selectedId && !images.some((image) => image.imageId === selectedId)) setSelectedId(images[0]?.imageId || null); }, [images, selectedId]);
  React.useEffect(()=>{if(!maximizedImageId)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setMaximizedImageId(null);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[maximizedImageId]);
  React.useEffect(()=>{images.filter((image)=>(image.shared||Boolean(image.parameterDocument?.operations.length))&&image.workspaceLocation==="working"&&(image.sourceCached||image.previewCached)&&!collaborationContainers.current.has(image.imageId)).forEach((image)=>{void syncCollaborationPreview(image,image.parameterDocument||emptyImageParameterDocument()).catch((error)=>setNotice(error instanceof Error?error.message:"The image could not be decoded"));});},[images]);
  React.useEffect(()=>{if(realtimeRef.current&&runtime==="available")realtimeRef.current.send("presence",{action:selectedId?"viewing":"idle",imageId:selectedId},{delivery:"ephemeral",dataClass:"presence"});},[runtime,selectedId]);
  React.useEffect(() => {
    if (workspace?.role !== "collaborator" || runtime !== "syncing") return;
    const requestSnapshot = () => realtimeRef.current?.send(
      "stateRequest",
      {},
      { route: "owner", delivery: "reliable" },
    );
    const initialTimer = window.setTimeout(requestSnapshot, 0);
    const timer = window.setInterval(requestSnapshot, 2_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [runtime, workspace?.role]);
  React.useEffect(() => { if(selectedId)void listCommits(selectedId).then((values)=>setCommits((current)=>[...current.filter((item)=>item.imageId!==selectedId),...values])); }, [selectedId]);

  React.useEffect(() => { setCommits((current) => { const unique = Array.from(new Map(current.map((commit) => [commit.commitId, commit])).values()); return unique.length === current.length ? current : unique; }); }, [commits, setCommits]);
  const { moveImageToWorking, requestMoveImageToWorking, requestDeleteImage, confirmDeleteImage } = useWorkspaceImageCommands({
    workspace, imagesRef, collaborationContainers, selectedId, maximizedImageId, processingSource,
    activityPreview, rollbackTarget, deleteChoice, deletingImage, setSelectedId, setImages, setCommits,
    setPendingWorkingImageId, setCompressionSuggestionWeakNetwork,
    setActivities, setProposals, setNewVersions, setMaximizedImageId, setProcessingSource, setEditing,
    setReviewOpen, setActivityPreview, setRollbackTarget, setRollbackPreview, setDeletingImage, setDeleteChoice,
    setNotice, updateImage, persistWorkspaceLog, releaseProcessingSource,
    sendRealtime: (type, payload) => realtimeRef.current?.send(type, payload, { delivery: "reliable", dataClass: "preview" }),
    collaborationDeleteBlockedMessage: workspaceText("collaborationDeleteBlocked"),
  });
  const { saveProcessedCopy, queueProcessedResult, confirmProcessedResult } = useWorkspaceProcessedResults({
    workspace, setImages, setCommits, setSelectedId, setEditing, setCompressingToWorkingImageId,
    setPendingProcessedResult, setProcessedResultSaving, pendingProcessedResult, processedResultSaving,
    persistWorkspaceLog, releaseProcessingSource, setNotice,
  });
  const clearCollaborationHistory = React.useCallback(async (imageId: string) => {
    await clearWorkspaceImageHistory(imageId);
    setCommits((current) => current.filter((commit) => commit.imageId !== imageId));
    setActivities((current) => current.filter((activity) => activity.imageId !== imageId));
    setProposals((current) => current.filter((proposal) => proposal.imageId !== imageId));
    setNewVersions((current) => {
      if (!(imageId in current)) return current;
      const next = { ...current };
      delete next[imageId];
      return next;
    });
  }, [setActivities, setCommits, setNewVersions, setProposals]);
  const { publishPreview, publishImage: togglePublishedImage } = useWorkspacePublishing({
    workspace, imagesRef, collaborationContainers, updateImage, syncCollaborationPreview,
    clearCollaborationHistory,
    persistWorkspaceLog, setNotice: (message) => setNotice(message),
    sendRealtime: (type, payload, options) => realtimeRef.current?.send(type, payload, options as any),
    sendRealtimeBinary: (type, payload, bytes, options) => realtimeRef.current?.sendBinary(type, payload, bytes, options as any),
  });
  const { saveCollaborativeImage, saveCollaborativeCopy } = useWorkspaceSaveCollaboration({
    workspace, selected, collaborationContainers, setCollaborationSaving, setSaveCollaborationOpen,
    setNotice, updateImage, syncCollaborationContainer, saveProcessedCopy, persistCollaborationActivity,
  });
  const publishImage = React.useCallback(async (image: WorkspaceImage) => {
    if (image.shared) {
      setStopCollaborationImage(image);
      return;
    }
    await togglePublishedImage(image);
  }, [setStopCollaborationImage, togglePublishedImage]);
  const confirmStopCollaboration = React.useCallback(async () => {
    if (!stopCollaborationImage || stoppingCollaboration) return;
    setStoppingCollaboration(true);
    try {
      await togglePublishedImage(stopCollaborationImage);
      setStopCollaborationImage(null);
    } finally {
      setStoppingCollaboration(false);
    }
  }, [setStopCollaborationImage, setStoppingCollaboration, stopCollaborationImage, stoppingCollaboration, togglePublishedImage]);
  const saveAndStopCollaboration = React.useCallback(async () => {
    const image = stopCollaborationImage;
    if (!image || stoppingCollaboration) return;
    setStoppingCollaboration(true);
    try {
      const saved = await saveCollaborativeCopy(image);
      if (!saved) return;
      await togglePublishedImage(image);
      setStopCollaborationImage(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save collaborative image");
    } finally {
      setStoppingCollaboration(false);
    }
  }, [saveCollaborativeCopy, setNotice, setStopCollaborationImage, setStoppingCollaboration, stopCollaborationImage, stoppingCollaboration, togglePublishedImage]);
  const { createShare, rotateShare, copyShare } = useWorkspaceShareCommands({
    workspace, displayName: userDisplayName, publicSiteUrl, setWorkspace, setImages, realtimeRef, realtimeService,
    subscribe: (client) => client.subscribe((value) => realtimeEventRef.current(value)),
    transition: () => transitionRuntime({ type: "transition", next: "connecting" }), setCopied, setNotice,
  });
  const { react, sendMessage, removeCollaborator, requestSource } = useWorkspaceCollaborationCommands({
    workspace, selected, onlinePeers, runtime, message, realtimeRef, pendingSourceRequests,
    finishSourceRequest, setMessages, setMessage, setReactionCounts, setNotice, setRequestingSourceIds,
    persistWorkspaceLog, showReaction,
  });
  const { createOperation, submitProposal, proposalInput } = useWorkspaceOperationCommands({
    workspace, selected, images, imagesRef, collaborationContainers, setCommits, setProposals, setNotice,
    updateImage, saveProcessedCopy, syncCollaborationPreview, persistCollaborationActivity,
    sendRealtime: (type, payload, options) => realtimeRef.current?.send(type, payload, options as any), pendingProposalEvents,
  });
  const { openRollbackTarget, cancelRollbackTarget, rollbackCommit, rollbackActivityParameterState } = useWorkspaceRollbackCommands({
    workspace, selected, commits, selectedCollaborationActivities, activityPreview, rollbackTarget,
    setCommits, setActivities, setRollbackTarget, setRollbackPreview, setActivityPreview, setNotice,
    updateImage, syncCollaborationPreview, renderCollaborationPreviewSnapshot,
    sendRealtime: (type, payload) => realtimeRef.current?.send(type, payload, { delivery: "reliable", dataClass: "collaborationEvent" }),
    currentActivityId: currentCollaborationActivityId,
  });

  async function previewProposal(proposal: WorkspaceProposal) {
    try {
      const image = imagesRef.current.find((candidate) => candidate.imageId === proposal.imageId);
      if (!image) throw new Error("Proposal image is unavailable");
      const input = await proposalInput(proposal);
      const original = input.source;
      if (!original) throw new Error("Proposal base version is unavailable");
      const baseDocument = workspace?.role === "collaborator" || proposal.authorId === "local" || image.currentCommitId === proposal.baseCommitId
        ? collaborationContainers.current.get(proposal.imageId)?.parameterDocument || image.parameterDocument || emptyImageParameterDocument()
        : emptyImageParameterDocument();
      const parameterDocument = proposal.operations.reduce((document, operation) => setImageOperation(document, {
        id: operation.operationId,
        userId: operation.authorId,
        time: operation.createdAt,
        type: protocolOperationType(operation.type, operation.parameters),
        params: { ...operation.parameters, workspaceOperationType: operation.type },
      }), baseDocument);
      const result = await imageProcessing.renderPreview({
        source: { kind: "blob", blob: original, name: image.name, mimeType: original.type || image.mimeType },
        document: parameterDocument,
        maxWidth: 960,
        maxHeight: 720,
        mimeType: "image/webp",
        quality: 0.86,
      }, { requestId: `workspace-proposal-preview:${proposal.proposalId}` });
      setProposalPreview({ proposalId: proposal.proposalId, imageId: proposal.imageId, original, result: result.artifact.blob });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Proposal preview is unavailable");
    }
  }

  async function previewCollaborationActivity(activity: WorkspaceActivity) {
    if (!selected || activity.imageId !== selected.imageId) return;
    if (activity.eventId === currentCollaborationActivityId) return;
    const detail = activity.detail && typeof activity.detail === "object"
      ? activity.detail as Record<string, unknown>
      : null;
    const commitId = typeof detail?.commitId === "string" ? detail.commitId : null;
    const snapshot = isValidImageParameterDocument(detail?.parameterDocument)
      ? detail.parameterDocument
      : null;
    const proposalId = typeof detail?.proposalId === "string" ? detail.proposalId : null;
    if (!snapshot && proposalId) {
      const proposal = proposals.find((value)=>value.proposalId===proposalId);
      if (proposal && activity.kind === "proposalApproved") {
        const operationIds = new Set(proposal.operations.map((operation) => operation.operationId));
        const commitActivity = activities.find((candidate) => {
          if (candidate.kind !== "operationCommitted" || candidate.imageId !== selected.imageId) return false;
          const candidateDetail = candidate.detail && typeof candidate.detail === "object"
            ? candidate.detail as Record<string, unknown>
            : null;
          return typeof candidateDetail?.operationId === "string" && operationIds.has(candidateDetail.operationId)
            && isValidImageParameterDocument(candidateDetail.parameterDocument);
        });
        const historicalDocument = commitActivity?.detail && typeof commitActivity.detail === "object"
          ? (commitActivity.detail as Record<string, unknown>).parameterDocument
          : null;
        if (isValidImageParameterDocument(historicalDocument)) {
          const rendered = await renderCollaborationPreviewSnapshot(selected, historicalDocument);
          if (!rendered?.blob.size) throw new Error("Activity preview is unavailable");
          setActivityPreview({activity,parameterDocument:historicalDocument,preview:rendered.blob,commitId:commitId||undefined});
          return;
        }
      }
      if (proposal) {
        const image = imagesRef.current.find((candidate) => candidate.imageId === proposal.imageId);
        if (!image) throw new Error("Proposal image is unavailable");
        const input = await proposalInput(proposal);
        if (!input.source) throw new Error("Proposal source is unavailable");
        const containerDocument = collaborationContainers.current.get(proposal.imageId)?.parameterDocument;
        const parameterDocument = proposal.operations.reduce((document, operation) => setImageOperation(document, {
          id: operation.operationId,
          userId: operation.authorId,
          time: operation.createdAt,
          type: protocolOperationType(operation.type, operation.parameters),
          params: { ...operation.parameters, workspaceOperationType: operation.type },
        }), containerDocument || image.parameterDocument || emptyImageParameterDocument());
        const rendered = await imageProcessing.renderPreview({
          source: { kind: "blob", blob: input.source, name: image.name, mimeType: input.source.type || image.mimeType },
          document: parameterDocument,
          maxWidth: 960,
          maxHeight: 720,
          mimeType: "image/webp",
          quality: 0.86,
        }, { requestId: `workspace-activity-proposal-preview:${proposal.proposalId}` });
        setProposalPreview({ proposalId: proposal.proposalId, imageId: proposal.imageId, original: input.source, result: rendered.artifact.blob });
        setActivityPreview({ activity, parameterDocument, preview: rendered.artifact.blob });
        return;
      }
      if (workspace?.role === "collaborator" && activity.actorId === "local") {
        const operationType = typeof detail?.operationType === "string"
          ? detail.operationType as WorkspaceOperation["type"]
          : "other";
        const operation: WorkspaceOperation = {
          operationId: typeof detail?.operationId === "string" ? detail.operationId : id("activity-operation"),
          imageId: selected.imageId,
          authorId: "local",
          baseCommitId: typeof detail?.commitId === "string" ? detail.commitId : selected.currentCommitId || `initial_${selected.imageId}`,
          type: operationType,
          parameters: detail?.parameters && typeof detail.parameters === "object" ? detail.parameters as Record<string, unknown> : {},
          createdAt: activity.createdAt,
        };
        await previewProposal({
          proposalId,
          workspaceId: workspace.workspaceId,
          imageId: selected.imageId,
          authorId: "local",
          baseCommitId: operation.baseCommitId,
          operations: [operation],
          state: "submitted",
          createdAt: activity.createdAt,
        });
        return;
      }
    }
    try {
      let parameterDocument = snapshot;
      if (!parameterDocument && commitId) {
        const imageCommits = commits.filter((item)=>item.imageId===selected.imageId)
          .sort((left,right)=>left.createdAt-right.createdAt);
        const targetIndex = imageCommits.findIndex((commit)=>commit.commitId===commitId);
        if (targetIndex >= 0) {
          parameterDocument = imageCommits.slice(0,targetIndex+1)
            .flatMap((commit)=>commit.operations)
            .reduce((document, operation)=>setImageOperation(document, {
              id: operation.operationId,
              userId: operation.authorId,
              time: operation.createdAt,
              type: protocolOperationType(operation.type, operation.parameters),
              params: {...operation.parameters, workspaceOperationType: operation.type},
            }), emptyImageParameterDocument());
        }
      }
      if (!parameterDocument) throw new Error("This older activity has no parameter snapshot");
      const rendered = await renderCollaborationPreviewSnapshot(selected, parameterDocument);
      if (!rendered?.blob.size) throw new Error("Activity preview is unavailable");
      setActivityPreview({activity,parameterDocument,preview:rendered.blob,commitId:commitId||undefined});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Activity preview is unavailable");
    }
  }

  function cancelActivityPreview() {
    setActivityPreview(null);
    setProposalPreview(null);
  }

  const previewProposalId = proposalPreview?.proposalId || (activityPreview?.activity.detail && typeof activityPreview.activity.detail === "object" && typeof (activityPreview.activity.detail as Record<string, unknown>).proposalId === "string" ? (activityPreview.activity.detail as Record<string, unknown>).proposalId as string : undefined);

  async function decideProposal(proposal:WorkspaceProposal,state:"approved"|"rejected"|"later",rejectReason?:string){
    const reason=state==="rejected"?(rejectReason?.trim()||"Rejected by Owner"):undefined;
    let approvedCommitId: string | undefined;
    let approvedParameterDocument: ImageParameterDocument | undefined;
    if(state==="approved"){
      const image=images.find((item)=>item.imageId===proposal.imageId);if(!image)return;
      if(image.currentCommitId!==proposal.baseCommitId){setNotice(workspaceText("proposalStale"));return;}
      const parameterDocument=proposal.operations.reduce((document,operation)=>setImageOperation(document,{id:operation.operationId,userId:operation.authorId,time:operation.createdAt,type:protocolOperationType(operation.type,operation.parameters),params:{...operation.parameters,workspaceOperationType:operation.type}}),image.parameterDocument||emptyImageParameterDocument());
      approvedParameterDocument = parameterDocument;
      if (!proposal.commit || proposal.commit.imageId !== proposal.imageId) { setNotice("Proposal is missing its original Commit"); return; }
      const commit: WorkspaceCommit = proposal.commit;
      approvedCommitId = commit.commitId;
      await saveCommit(commit);setCommits((current)=>[...current,cachedCommit(commit)]);
      await updateImage(proposal.imageId,{parameterDocument,currentCommitId:commit.commitId,state:"shared"});
      await syncCollaborationPreview({...image,parameterDocument,currentCommitId:commit.commitId,state:"shared"},parameterDocument);
      realtimeRef.current?.send("commitCreated",{commit,parameterDocument},{delivery:"reliable",dataClass:"collaborationEvent"});
      await persistCollaborationActivity(workspace!.workspaceId,"proposalApproved",proposal.imageId,{proposalId:proposal.proposalId,commitId:commit.commitId,operations:proposal.operations.map(({operationId,type,parameters,authorId})=>({operationId,operationType:type,parameters,actorId:authorId})),parameterDocument,status:"approved"},"owner");
    }
    const next={...proposal,state,rejectReason:reason};await saveProposal(next);setProposals((current)=>current.map((item)=>item.proposalId===proposal.proposalId?next:item));realtimeRef.current?.send("proposalDecision",{proposalId:proposal.proposalId,state,reason,commitId:approvedCommitId,operationType:proposal.operations[0]?.type,operations:proposal.operations.map(({operationId,type,parameters,authorId})=>({operationId,operationType:type,parameters,actorId:authorId})),parameterDocument:approvedParameterDocument},{route:"user",targetUserId:proposal.authorId,delivery:"reliable"});
    if(state==="rejected")await updateImage(proposal.imageId,{state:"shared"});
    if(state==="rejected")await persistCollaborationActivity(workspace!.workspaceId,"proposalRejected",proposal.imageId,{proposalId:proposal.proposalId,reason,status:"rejected"},"owner");
    if(state==="later")await persistCollaborationActivity(workspace!.workspaceId,"proposalDeferred",proposal.imageId,{proposalId:proposal.proposalId,status:"pending"},"owner");
  }
  const { saveStyle } = useWorkspaceStyleCommands({ workspace, styleDraft, setWorkspace, setStyleDraft, setSettingsOpen, setNotice, realtimeRef });
  const editorContainerDocument = selected?.workspaceLocation === "working" ? collaborationContainers.current.get(selected.imageId)?.parameterDocument : undefined;
  const editorSelected = React.useMemo(() => selected && selected.workspaceLocation === "working"
    ? { ...selected, parameterDocument: editorContainerDocument || selected.parameterDocument }
    : selected, [editorContainerDocument, selected]);
  const { editorImage, initialColorAdjustments, initialCrop, initialResize, initialReviewAnnotations, labels, editorLoadingOverlay } = useWorkspaceEditorState({ workspace, selected: editorSelected, processingSource, editorPreparing, lang });
  const { saveProcessedResult } = useWorkspaceProcessedResultCommand({ workspace, selected, setEditing, createOperation, queueProcessedResult, releaseProcessingSource });
  if(!workspace&&runtime==="unavailable")return <WorkspaceUnavailable notice={notice}/>;
  if(!workspace)return <WorkspaceLoading/>;
  if(reviewOpen&&editorImage)return <main className="flex h-screen min-h-0 min-w-0 overflow-hidden"><ReviewWorkspace roomId={workspace.workspaceId} image={editorImage} labels={labels} actorId={workspace.role} role={workspace.role==="owner"?"owner":"guest"} fullscreen={reviewFullscreen} collaborationEnabled={Boolean(selected?.shared)} showCommentAnchors={false} parameterAction={selected?.workspaceLocation==="working"?(workspace.role==="owner"?"apply":"proposal"):undefined} initialAnnotations={initialReviewAnnotations} onApplyParameters={async(parameters)=>{await createOperation("other",{review:true,...parameters});setReviewOpen(false);releaseProcessingSource();}} shareRecipients={[]} subscribeMessages={subscribeReviewMessages} onSendMessage={sendReviewMessage} onReviewStatusChange={handleReviewStatusChange} onReviewEditingChange={handleReviewEditingChange} onFullscreenChange={setReviewFullscreen} onGenerateImage={async(_source,result)=>{queueProcessedResult(selected!,{...result,operation:"adjust",parameters:{review:true}} as ProcessedImageResult);setReviewOpen(false);return{status:"saved",imageId:selected!.imageId};}} onResolveRejectedImage={async()=>undefined} onBack={()=>{setReviewOpen(false);releaseProcessingSource();}}/>{editorLoadingOverlay}</main>;
  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#f3f5f8] text-[#172033]">
    <WorkspaceHeader workspace={workspace} runtime={runtime} onlinePeers={onlinePeers} collaborationOpen={collaborationOpen} copied={copied} desktop={desktop} lang={lang} onLanguageChange={(nextLang)=>{persistLang(nextLang);setLanguage(nextLang);}} onEnterWorkspace={()=>setShareIdEntryOpen(true)} onLeave={()=>setLeaveConfirmOpen(true)} onToggleCollaboration={()=>setCollaborationOpen((value)=>!value)} onShare={()=>{if(workspace.shareToken)void copyShare().then(()=>showToast(workspaceText("shareLinkCopied"))).catch(()=>undefined);else if(workspace.role==="owner")void createShare();}} onSettings={()=>setSettingsOpen(true)} />
    <WorkspaceStatusBands workspace={workspace} runtime={runtime} notice={notice} imageCount={images.length} onDismissNotice={()=>setNotice(null)}/>
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_clamp(320px,24vw,420px)] lg:overflow-hidden">
      <section className={`flex min-w-0 flex-col lg:min-h-0 ${maximizedWorkspaceImage?"overflow-hidden":"p-4 sm:p-6 lg:overflow-auto"}`}>
        {maximizedWorkspaceImage?<div className="flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden bg-white"><header className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 text-slate-800"><div className="min-w-0"><span className="block text-[10px] font-semibold uppercase text-slate-400">{workspaceText("imageProcessing")}</span><strong className="block truncate text-sm">{maximizedWorkspaceImage.name}</strong></div><button type="button" onClick={()=>setMaximizedImageId(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]" title={workspaceText("returnToGallery")} aria-label={workspaceText("returnToGallery")}><FiMinimize2/></button></header><div className="min-h-0 flex-1"><WorkspaceProcessingCanvas image={maximizedWorkspaceImage} role={workspace.role} renderedBlob={maximizedPreviewBlob}/></div></div>:<>
        <div className="mb-[18px] flex items-center justify-between gap-5">
          <div><div className="flex items-center gap-2"><h1 className="text-[21px] font-bold leading-tight text-[#192337]">{workspaceText("gallery")}</h1><button type="button" onClick={()=>setOperationLogOpen(true)} className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-[#2f65cf]" title={workspaceText("operationLog")}><FiTerminal/>{completeOperationLog.length?<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500"/>:null}</button></div><p className="mt-1 text-[13px] text-[#7b8494]">{workspaceText("imagesStayLocal")}</p></div>
          {workspace.role==="owner"?<><button type="button" onClick={()=>inputRef.current?.click()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-[13px] font-bold text-white hover:bg-[#2457bd]"><FiUploadCloud/>{workspaceText("chooseImages")}</button><input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event)=>event.target.files&&void addFiles(event.target.files)}/></>:null}
        </div>
        <WorkspaceGallery libraryCollapsed={libraryCollapsed} libraryImages={libraryImages} workingImages={workingImages} workingImagesSorted={workingImagesSorted} selectedId={selectedId} role={workspace.role} dragging={dragging} onlinePeers={onlinePeers} requestingSourceIds={requestingSourceIds} collaborationPreviewFor={(image)=>collaborationPreviewFor(image, workspace, collaborationContainers.current)} onToggleLibrary={()=>setLibraryCollapsed((value)=>!value)} onUpload={()=>inputRef.current?.click()} onDragEnter={(event)=>{if(workspace.role!=="owner")return;event.preventDefault();setDragging(true);}} onDragOver={(event)=>{if(workspace.role==="owner")event.preventDefault();}} onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}} onDrop={(event)=>{if(workspace.role!=="owner")return;event.preventDefault();setDragging(false);void addFiles(event.dataTransfer.files);}} onSelect={setSelectedId} onAddToWorking={(image)=>requestMoveImageToWorking(image)} onDeleteLibrary={(image)=>requestDeleteImage(image)} onPin={(image)=>void updateImage(image.imageId,{pinnedAt:image.pinnedAt?undefined:Date.now()})} onMoveToLibrary={(image)=>requestDeleteImage(image)} onRequestSource={(image)=>{setSelectedId(image.imageId);requestSource(image);}} onDownload={(image)=>downloadImage(image)} onMaximize={(image)=>void maximizeWorkspaceImage(image)} onOperation={(image,operation)=>void openImageOperation(image,operation)} />
        </>}
      </section>
      <WorkspaceSidebar>
        {collaborationOpen ? <WorkspaceCollaborationPanel onlineCollaborators={onlineCollaborators} proposals={proposals} role={workspace.role} runtime={runtime} onlinePeers={onlinePeers} reactionCounts={reactionCounts} messages={messages} message={message} selectedCollaborationActivities={selectedCollaborationActivities} selectedOriginalCommit={selectedOriginalCommit} selected={selected} onClose={()=>setCollaborationOpen(false)} onRemoveCollaborator={setRemovingCollaborator} onPreviewProposal={(proposal)=>void previewProposal(proposal)} onDecideProposal={(proposal,state)=>void decideProposal(proposal,state)} onRejectProposal={(proposal)=>{setRejectingProposal(proposal);setProposalRejectReason("");}} onRetryProposal={(proposal)=>void submitProposal(proposal)} onReact={react} onPreviewActivity={(activity)=>void previewCollaborationActivity(activity)} onOpenOriginal={()=>selectedOriginalCommit&&void openRollbackTarget(selectedOriginalCommit)} onMessageChange={setMessage} onSendMessage={sendMessage} /> : <WorkspaceImageSidebar selected={selected} selectedIsLibrary={selectedIsLibrary} shareId={workspace.shareToken} role={workspace.role} runtime={runtime} imagesCount={images.length} workingCount={workingImages.length} collaborators={collaborators} commits={commits} activities={selectedCollaborationActivities} proposals={proposals} selectedOriginalCommit={selectedOriginalCommit} requestingSource={selected ? requestingSourceIds.has(selected.imageId) : false} previewBlob={selected ? collaborationPreviewFor(selected, workspace, collaborationContainers.current) : undefined} onPublish={(image)=>void publishImage(image)} onDelete={requestDeleteImage} onRequestSource={requestSource} onOperation={(image,operation)=>void openImageOperation(image,operation)} onSave={()=>setSaveCollaborationOpen(true)} onActivity={(activity)=>void previewCollaborationActivity(activity)} onOriginal={()=>selectedOriginalCommit&&void openRollbackTarget(selectedOriginalCommit)} onRollback={(commit)=>void openRollbackTarget(commit)} onCreateShare={()=>void createShare()} onRotateShare={()=>void rotateShare()} onCopySuccess={()=>showToast(workspaceText("workspaceIdCopied"))} hasShareToken={Boolean(workspace.shareToken)} />}
      </WorkspaceSidebar>
    </div>
    <WorkspaceEditorDialogs editing={editing} image={editorImage} labels={labels} initialCrop={initialCrop} initialSize={initialResize} initialAdjustments={initialColorAdjustments} parameterAction={selected?.workspaceLocation === "working" ? (workspace.role === "owner" ? "apply" : "proposal") : undefined} loadingOverlay={editorLoadingOverlay} onClose={()=>{setEditing(null);setCompressingToWorkingImageId(null);releaseProcessingSource();}} onSave={(_source,result)=>saveProcessedResult(result)} onApplyCrop={async(parameters)=>{setEditing(null);releaseProcessingSource();await createOperation("crop",parameters);}} onApplyResize={async(parameters)=>{setEditing(null);releaseProcessingSource();await createOperation("resize",parameters);}} onApplyColor={async(parameters)=>{setEditing(null);releaseProcessingSource();await createOperation("brightness",parameters);}} onSaveCompression={async(_source,result)=>{if(compressingToWorkingImage){await saveProcessedCopy(compressingToWorkingImage,result);releaseProcessingSource();return;}await saveProcessedResult(result);}} onSaveConversion={(_source,result)=>saveProcessedResult(result)} />
    <WorkspaceDialogs workspace={workspace} runtime={runtime} leaveOpen={leaveConfirmOpen} removed={removedFromWorkspace} removingCollaborator={removingCollaborator} deleteImage={deletingImage} deleteChoice={deleteChoice} proposalPreview={proposalPreview} activityPreview={activityPreview} activityPreviewIsCurrent={activityPreviewIsCurrent} rollbackTarget={rollbackTarget} rollbackPreview={rollbackPreview} saveCollaborationOpen={saveCollaborationOpen} collaborationSaving={collaborationSaving} sourceRequest={sourceRequestDialog} sourceRequestImageName={images.find((image)=>image.imageId===sourceRequestDialog?.imageId)?.name} sourceRejectReason={sourceRejectReason} rejectingProposal={rejectingProposal} proposalRejectReason={proposalRejectReason} operationLogOpen={operationLogOpen} operationLogs={completeOperationLog} pendingResult={pendingProcessedResult?.result || null} resultSaving={processedResultSaving} settingsOpen={settingsOpen} styleDraft={styleDraft} compressionSuggestionOpen={Boolean(pendingWorkingImageId)} compressionSuggestionWeakNetwork={compressionSuggestionWeakNetwork} compressionLabels={labels as any} onCompressionContinue={() => { const image = images.find((item) => item.imageId === pendingWorkingImageId); setPendingWorkingImageId(null); if (image) void moveImageToWorking(image); }} onCompression={() => { const image = images.find((item) => item.imageId === pendingWorkingImageId); setPendingWorkingImageId(null); if (!image) return; setCompressingToWorkingImageId(image.imageId); void openImageOperation(image, "compress"); }} onCompressionCancel={() => setPendingWorkingImageId(null)} onRemovedReturnHome={()=>setRemovedFromWorkspace(false)} onCloseLeave={()=>setLeaveConfirmOpen(false)} onConfirmLeave={confirmLeaveWorkspace} onCloseRemoveCollaborator={()=>setRemovingCollaborator(null)} onConfirmRemoveCollaborator={()=>{const collaborator=removingCollaborator;setRemovingCollaborator(null);if(collaborator)removeCollaborator(collaborator);}} onCloseDelete={()=>setDeletingImage(null)} onDeleteChoice={setDeleteChoice} onConfirmDelete={()=>void confirmDeleteImage()} onCloseProposalPreview={()=>setProposalPreview(null)} onRejectProposalPreview={()=>{const proposal=proposals.find((item)=>item.proposalId===proposalPreview?.proposalId);setProposalPreview(null);if(proposal)void decideProposal(proposal,"rejected");}} onApproveProposalPreview={()=>{const proposal=proposals.find((item)=>item.proposalId===proposalPreview?.proposalId);setProposalPreview(null);if(proposal)void decideProposal(proposal,"approved");}} onCloseActivityPreview={()=>void cancelActivityPreview()} onRollbackActivity={()=>void rollbackActivityParameterState()} onCloseRollback={()=>void cancelRollbackTarget()} onConfirmRollback={()=>rollbackTarget&&void rollbackCommit(rollbackTarget)} onCloseSaveCollaboration={()=>setSaveCollaborationOpen(false)} onSaveCollaboration={(choice)=>void saveCollaborativeImage(choice)} onSourceReasonChange={setSourceRejectReason} onRejectSource={()=>sourceRequestDialog&&rejectSourceRequest(sourceRequestDialog)} onAcceptSource={()=>sourceRequestDialog&&void acceptSourceRequest(sourceRequestDialog)} onCloseRejectProposal={()=>setRejectingProposal(null)} onProposalReasonChange={setProposalRejectReason} onRejectProposal={()=>{const proposal=rejectingProposal;setRejectingProposal(null);if(proposal)void decideProposal(proposal,"rejected",proposalRejectReason);}} onCloseOperationLog={()=>setOperationLogOpen(false)} onClearOperationLog={async()=>{await clearOperationLogs(workspace.workspaceId);setOperationLogs([]);setActivities([]);}} onCancelResult={()=>setPendingProcessedResult(null)} onSaveResult={(destination)=>void confirmProcessedResult(destination)} onCloseSettings={()=>setSettingsOpen(false)} onStyleChange={setStyleDraft} onSaveStyle={()=>void saveStyle()} />
    <WorkspaceSourceRejectedDialog notice={sourceRejectedNotice} onClose={() => setSourceRejectedNotice(null)} />
    <WorkspaceStopCollaborationConfirmDialog image={stopCollaborationImage} stopping={stoppingCollaboration} onClose={() => { if (!stoppingCollaboration) setStopCollaborationImage(null); }} onConfirm={confirmStopCollaboration} onSaveAndConfirm={saveAndStopCollaboration} />
    <WorkspaceShareIdEntryDialog open={shareIdEntryOpen} lang={lang} desktop={desktop} onClose={() => setShareIdEntryOpen(false)} />
    <WorkspaceToast message={toastMessage} />
  </main>;
}
