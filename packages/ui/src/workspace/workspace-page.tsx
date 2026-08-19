"use client";

import React from "react";
import {
  FiArrowLeft, FiArrowRight, FiCheck, FiChevronLeft, FiChevronRight, FiClock, FiCrop, FiDownload,
  FiBookmark, FiEye, FiHardDrive, FiHome, FiImage, FiLink, FiMaximize2, FiMessageCircle,
  FiMinimize2, FiMoreHorizontal, FiRefreshCw, FiSend, FiSettings, FiShare2, FiShield,
  FiSliders, FiTrash2, FiUploadCloud, FiUsers, FiX,
} from "react-icons/fi";
import { TbPinned, TbPinnedFilled } from "react-icons/tb";
import { createWorkspaceShare, joinWorkspace, rotateWorkspaceShare, shareUrl } from "./api";
import {
  deleteWorkspaceImage, listActivities, listCommits, listProposals, listWorkspaceImages,
  promoteLocalWorkspace, purgeExpiredCache, restoreLocalWorkspace, saveActivity, saveCommit, saveProposal,
  readWorkspaceImagePreview, readWorkspaceImageSource, saveWorkspace, saveWorkspaceImage,
} from "./repository";
import { WorkspaceRealtimeClient } from "./realtime";
import { SourceTransferRegistry } from "./source-transfer";
import { isInboundEventAllowed, validateProposal } from "./policy";
import { workspaceRuntimeReducer } from "./state-machine";
import {
  defaultWorkspaceStyle, isValidStyle, type Collaborator, type WorkspaceActivity,
  type WorkspaceCommit, type WorkspaceEvent, type WorkspaceIdentity, type WorkspaceImage,
  type WorkspaceOperation, type WorkspaceProposal, type WorkspaceRuntimeState, type WorkspaceStyle,
} from "./types";
import { generateSharePlaceholder } from "../utils/share-placeholder";
import { generateShareThumbnail } from "../utils/share-thumbnail";
import { getShareRoomLabels } from "../locales";
import type { RoomImage } from "../components/share/share-room-types";
import ImageCropDialog from "../components/share/workspace/image-crop-dialog";
import ImageResizeDialog from "../components/share/workspace/image-resize-dialog";
import ImageColorAdjustmentDialog from "../components/share/workspace/image-color-adjustment-dialog";
import ImageCompressionDialog from "../components/share/workspace/image-compression-dialog";
import ImageConversionDialog from "../components/share/workspace/image-conversion-dialog";
import CompressionSuggestionDialog from "../components/share/workspace/compression-suggestion-dialog";
import type { ProcessedImageResult } from "../components/share/workspace/image-result-dialog";
import { adjustRoomImage, cropRoomImage, resizeRoomImage, type RoomColorAdjustments } from "../utils/room-image-editing";
import { convertRoomImageTask, type RoomConversionFormat } from "../utils/room-image-conversion";
import { compressRoomImageTask } from "../utils/room-image-compression-task";
import ReviewWorkspace from "../components/share/workspace/review-workspace";
import RoomImageMedia from "../components/share/room-image-media";
import type { ReviewCollaborationMessage } from "../utils/review-collaboration";
import {
  browserReportsWeakNetwork,
  normalizeWorkspaceImageLocation,
  reconcileCollaboratorSnapshot,
  sharedWorkingImages,
  shouldSuggestWorkspaceCompression,
} from "./image-flow";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const bytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const statusLabel: Record<WorkspaceRuntimeState, string> = { local: "Local", connecting: "Connecting", connected: "Connected", syncing: "Syncing", available: "Available", ownerOffline: "Owner offline", unavailable: "Unavailable" };

function headerBackground(style: WorkspaceStyle): React.CSSProperties {
  const value = style.header.background;
  return { background: value.type === "solid" ? value.color : `linear-gradient(${value.direction === "down" ? "180deg" : value.direction === "downRight" ? "135deg" : "90deg"}, ${value.from}, ${value.to})`, color: style.header.text.color };
}

async function dimensions(file: Blob) { const bitmap = await createImageBitmap(file); try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); } }
function blobFromBytes(value: unknown, mimeType: string) { return value instanceof ArrayBuffer ? new Blob([value],{type:mimeType}) : Array.isArray(value) ? new Blob([new Uint8Array(value.map(Number)).buffer as ArrayBuffer], { type: mimeType }) : null; }
async function digest(blob: Blob) { const value = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()); return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function rotateImage(source: Blob, name: string, degrees: number) {
  if (![90, 180, 270].includes(degrees)) throw new Error("Invalid rotate operation");
  const bitmap = await createImageBitmap(source);
  try {
    const swapsDimensions = degrees === 90 || degrees === 270;
    const width = swapsDimensions ? bitmap.height : bitmap.width;
    const height = swapsDimensions ? bitmap.width : bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas is unavailable");
    context.translate(width / 2, height / 2);
    context.rotate(degrees * Math.PI / 180);
    context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, name: name.replace(/\.[^.]+$/, "") + "-rotate.png", mimeType: "image/png", width, height };
  } finally {
    bitmap.close();
  }
}

function numberParameter(parameters: Record<string, unknown>, key: string) { const value=Number(parameters[key]); if(!Number.isFinite(value))throw new Error(`Invalid ${key}`); return value; }
async function replayOperations(image: WorkspaceImage, operations: WorkspaceOperation[]) {
  if (!image.source) throw new Error("Source data is unavailable");
  let current = new File([image.source], image.name, { type: image.mimeType });
  let width=image.width,height=image.height;
  for (const operation of operations) {
    if (operation.type === "crop") {
      const crop={x:numberParameter(operation.parameters,"x"),y:numberParameter(operation.parameters,"y"),width:numberParameter(operation.parameters,"width"),height:numberParameter(operation.parameters,"height")};
      if(crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>1||crop.y+crop.height>1)throw new Error("Invalid crop operation");
      const result=await cropRoomImage(current,crop);current=new File([result.blob],result.name,{type:result.blob.type});width=result.width;height=result.height;
    } else if (operation.type === "resize") {
      const targetWidth=numberParameter(operation.parameters,"width"),targetHeight=numberParameter(operation.parameters,"height");
      if(targetWidth<1||targetHeight<1||targetWidth>16384||targetHeight>16384)throw new Error("Invalid resize operation");
      const result=await resizeRoomImage(current,targetWidth,targetHeight);current=new File([result.blob],result.name,{type:result.blob.type});width=result.width;height=result.height;
    } else if (operation.type === "rotate") {
      const result = await rotateImage(current, current.name, numberParameter(operation.parameters, "degrees"));
      current = new File([result.blob], result.name, { type: result.mimeType });
      width = result.width;
      height = result.height;
    } else if (["brightness","contrast","saturation"].includes(operation.type)) {
      const result=await adjustRoomImage(current,operation.parameters as unknown as RoomColorAdjustments);current=new File([result.blob],result.name,{type:result.blob.type});width=result.width;height=result.height;
    } else if (operation.type === "compression") {
      const format=String(operation.parameters.format||"auto") as "auto"|RoomConversionFormat;
      if(!["auto","jpeg","png","webp","avif"].includes(format))throw new Error("Invalid compression format");
      const result=await compressRoomImageTask(current,format,new AbortController().signal);current=new File([result.blob],result.name,{type:result.blob.type});width=result.width;height=result.height;
    } else if (operation.type === "other" && operation.parameters.format) {
      const format=String(operation.parameters.format) as RoomConversionFormat;if(!["jpeg","png","webp","avif"].includes(format))throw new Error("Invalid conversion format");
      const result=await convertRoomImageTask(current,format,new AbortController().signal);current=new File([result.blob],result.name,{type:result.blob.type});width=result.width;height=result.height;
    }
  }
  return { blob: current as Blob, name: current.name, mimeType: current.type, width, height };
}

export default function WorkspacePage({ shareToken }: { shareToken?: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const realtimeRef = React.useRef<WorkspaceRealtimeClient | null>(null);
  const realtimeEventRef = React.useRef<(value: WorkspaceEvent | Record<string, unknown>) => void>(() => undefined);
  const [workspace, setWorkspace] = React.useState<WorkspaceIdentity | null>(null);
  const [images, setImages] = React.useState<WorkspaceImage[]>([]);
  const imagesRef = React.useRef<WorkspaceImage[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [runtime, transitionRuntime] = React.useReducer(workspaceRuntimeReducer, shareToken ? "connecting" : "local");
  const [collaborators, setCollaborators] = React.useState<Collaborator[]>([]);
  const [activities, setActivities] = React.useState<WorkspaceActivity[]>([]);
  const [proposals, setProposals] = React.useState<WorkspaceProposal[]>([]);
  const [commits, setCommits] = React.useState<WorkspaceCommit[]>([]);
  const [messages, setMessages] = React.useState<Array<{ id: string; text: string; actor: string }>>([]);
  const [reactionCounts, setReactionCounts] = React.useState<Record<string, number>>({});
  const [message, setMessage] = React.useState("");
  const [pendingWorkingImageId, setPendingWorkingImageId] = React.useState<string | null>(null);
  const [compressingToWorkingImageId, setCompressingToWorkingImageId] = React.useState<string | null>(null);
  const [compressionSuggestionWeakNetwork, setCompressionSuggestionWeakNetwork] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [collaborationOpen, setCollaborationOpen] = React.useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = React.useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [styleDraft, setStyleDraft] = React.useState<WorkspaceStyle>(defaultWorkspaceStyle());
  const [copied, setCopied] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<"crop" | "resize" | "adjust" | "compress" | "convert" | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewFullscreen, setReviewFullscreen] = React.useState(false);
  const [processingSource, setProcessingSource] = React.useState<{ imageId: string; blob: Blob } | null>(null);
  const [proposalPreview, setProposalPreview] = React.useState<{ proposalId: string; blob: Blob } | null>(null);
  const [sourceRequestDialog, setSourceRequestDialog] = React.useState<Record<string, unknown> | null>(null);
  const [sourceRejectReason, setSourceRejectReason] = React.useState("");
  const [rejectingProposal, setRejectingProposal] = React.useState<WorkspaceProposal | null>(null);
  const [proposalRejectReason, setProposalRejectReason] = React.useState("");
  const [newVersions, setNewVersions] = React.useState<Record<string, string>>({});
  const [versionPreview, setVersionPreview] = React.useState<{ imageName: string; blob: Blob } | null>(null);
  const reviewListeners = React.useRef(new Set<(event:{sequence:number;message:ReviewCollaborationMessage})=>void>());
  const pendingProposalEvents = React.useRef(new Map<string, string>());
  const reactionNodes = React.useRef(new Set<HTMLElement>());
  const reactionTimers = React.useRef(new Set<number>());
  const selected = images.find((image) => image.imageId === selectedId) || null;
  const selectedIsLibrary = workspace?.role === "owner" && selected?.workspaceLocation === "library";
  const onlinePeers = collaborators.filter((value) => value.online).length;
  const libraryImages = images.filter((image) => workspace?.role === "owner" && image.workspaceLocation === "library");
  const workingImages = images.filter((image) => workspace?.role === "collaborator" || image.workspaceLocation === "working");
  const workingImagesSorted = [...workingImages].sort((left, right) =>
    (right.pinnedAt || 0) - (left.pinnedAt || 0) || right.updatedAt - left.updatedAt,
  );
  const pendingWorkingImage = images.find((image) => image.imageId === pendingWorkingImageId) || null;
  const compressingToWorkingImage = images.find((image) => image.imageId === compressingToWorkingImageId) || null;
  imagesRef.current = images;

  const persistActivity = React.useCallback(async (workspaceId: string, kind: string, imageId?: string, detail?: unknown, actorId = "local") => {
    const value: WorkspaceActivity = { eventId: id("activity"), sequence: Date.now(), actorId, kind, imageId, detail, createdAt: Date.now() };
    setActivities((current) => [...current.slice(-49), value]); await saveActivity(workspaceId, value);
  }, []);

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

  async function loadSource(image: WorkspaceImage) {
    if (processingSource?.imageId === image.imageId) return processingSource.blob;
    return readWorkspaceImageSource(image);
  }

  async function openImageOperation(image: WorkspaceImage, operation: WorkspaceCardOperation) {
    const source = await loadSource(image);
    if (!source) {
      setNotice("Source data is unavailable");
      return;
    }
    setSelectedId(image.imageId);
    setProcessingSource({ imageId: image.imageId, blob: source });
    if (operation === "review") setReviewOpen(true);
    else setEditing(operation);
  }

  function releaseProcessingSource() {
    setProcessingSource(null);
  }

  async function downloadImage(image: WorkspaceImage) {
    const source = await readWorkspaceImageSource(image);
    if (!source) {
      setNotice("Source data is unavailable");
      return;
    }
    const url = URL.createObjectURL(source);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = image.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const sendWorkspaceSnapshot = React.useCallback((targetUserId?: string) => {
    if (!workspace || workspace.role !== "owner") return;
    const sharedImages = sharedWorkingImages(imagesRef.current);
    const route = targetUserId ? "user" as const : "workspace" as const;
    realtimeRef.current?.send("stateSnapshot", {
      images: sharedImages.map(({ source: _source, preview: _preview, ...image }) => image),
      style: workspace.style,
    }, { route, targetUserId, delivery: "reliable" });
    sharedImages.forEach((image) => {
      if (image.sourceCached && (!image.placeholder || !image.previewCached)) {
        void readWorkspaceImageSource(image).then((source) => {
          if (source) return publishPreview(image, source, targetUserId);
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
      if (image.preview) void image.preview.arrayBuffer().then((buffer) => {
        realtimeRef.current?.sendBinary("previewUpsert", {
          image: {
            imageId: image.imageId,
            mimeType: image.preview?.type || "image/webp",
            version: image.previewRevision,
          },
        }, buffer, { route, targetUserId, delivery: "bulk", dataClass: "preview" });
      });
    });
  }, [workspace]);

  const handleRealtimeEvent = React.useCallback((value: WorkspaceEvent | Record<string, unknown>) => {
    const type = String(value.type || "");
    if (workspace && !isInboundEventAllowed(workspace.role, type, value.senderRole)) return;
    if(workspace&&["placeholderUpsert","previewRemove","sourceRequest","sourceRejected","proposalSubmit","proposalDecision","commitCreated","styleUpdated","message"].includes(type))void persistActivity(workspace.workspaceId,type,typeof value.imageId==="string"?value.imageId:undefined,{senderName:value.senderName,reason:value.reason},typeof value.senderId==="string"?value.senderId:"remote");
    if (type === "syncRequired") { transitionRuntime({type:"transition",next:"syncing"}); realtimeRef.current?.send("stateRequest", {}, { route: "owner", delivery: "reliable" }); }
    else if (type === "deliveryFailed" && value.eventType === "proposalSubmit" && typeof value.eventId === "string") {
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
    else if (type === "connected") { transitionRuntime({type:"transition",next:"connected"}); const members = Array.isArray(value.members) ? value.members as Array<Record<string, unknown>> : []; setCollaborators(members.map((member) => ({ clientId: String(member.userId), displayName: String(member.userName || member.role || "Guest"), online: true }))); if(workspace?.role==="owner")transitionRuntime({type:"transition",next:"available"});else transitionRuntime({type:"transition",next:value.ownerOnline === false ? "ownerOffline" : "syncing"}); }
    else if (type === "memberJoined") {
      setCollaborators((current) => [...current.filter((item) => item.clientId !== value.userId), { clientId: String(value.userId), displayName: String(value.userName || "Guest"), online: true }]);
      if (workspace?.role === "owner" && value.role === "collaborator" && typeof value.userId === "string") {
        sendWorkspaceSnapshot(value.userId);
      }
    }
    else if (type === "memberLeft") setCollaborators((current) => current.map((item) => item.clientId === value.userId ? { ...item, online: false } : item));
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
        reconciled.removedImageIds.forEach((imageId) => void deleteWorkspaceImage(imageId));
        reconciled.images.forEach((image) => void saveWorkspaceImage(image));
      }
    }
    else if (type === "placeholderUpsert") {
      const imageId=String(value.imageId),revision=Number(value.revision||1);
      setImages((current) => {
        const existing=current.find((image)=>image.imageId===imageId);
        if(existing&&revision<existing.previewRevision)return current;
        const incoming:WorkspaceImage={imageId,workspaceId:workspace?.workspaceId||"",name:String(value.imageName||existing?.name||"Shared image"),mimeType:String(value.mimeType||existing?.mimeType||"image/*"),size:Number(value.size||existing?.size||0),width:Number(value.width||existing?.width||0),height:Number(value.height||existing?.height||0),workspaceLocation:"working",state:existing?.state||"shared",shared:true,currentCommitId:typeof value.currentCommitId==="string"?value.currentCommitId:existing?.currentCommitId||null,previewRevision:revision,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now(),sourceCached:existing?.sourceCached,previewCached:existing?.previewCached,placeholder:value.placeholder as WorkspaceImage["placeholder"]};
        void saveWorkspaceImage(incoming);
        return existing?current.map((image)=>image.imageId===imageId?incoming:image):[...current,incoming];
      });
    }
    else if (type === "previewUpsert") {
      const data=value.image as Record<string,unknown>|undefined;
      if(data){const imageId=String(data.imageId),revision=Number(data.version||1),preview=blobFromBytes(data.bytes??value.bytes,String(data.mimeType||"image/webp"));if(preview){const image=imagesRef.current.find((candidate)=>candidate.imageId===imageId);if(image&&revision>=image.previewRevision)void (async()=>{const persisted={...image,preview,previewCached:true,shared:true,previewRevision:revision,updatedAt:Date.now()};await saveWorkspaceImage(persisted);const cached={...persisted,preview:undefined};imagesRef.current=imagesRef.current.map((candidate)=>candidate.imageId===imageId?cached:candidate);setImages(imagesRef.current);})();}}
    }
    else if (type === "previewRemove") {
      const imageId = String(value.imageId);
      void deleteWorkspaceImage(imageId);
      const nextImages = imagesRef.current.filter((image) => image.imageId !== imageId);
      imagesRef.current = nextImages;
      setImages(nextImages);
      setNewVersions((current) => {
        if (!(imageId in current)) return current;
        const next = { ...current };
        delete next[imageId];
        return next;
      });
    }
    else if (type === "sourceRequest" && workspace?.role === "owner") setSourceRequestDialog(value);
    else if (type === "sourceStart" || type === "sourceChunk" || type === "sourceComplete") void receiveSource(value);
    else if (type === "sourceRejected") setNotice(typeof value.reason === "string" ? value.reason : "Source request was rejected");
    else if (type === "proposalSubmit" && workspace?.role === "owner" && value.proposal && typeof value.senderId === "string") { const incoming=value.proposal as WorkspaceProposal,senderId=value.senderId,image=images.find((item)=>item.imageId===incoming.imageId); if (!validateProposal(incoming,workspace.workspaceId,image)) return; const proposal={...incoming,state:image!.currentCommitId&&image!.currentCommitId!==incoming.baseCommitId?"conflict" as const:"pending" as const,authorId:senderId,operations:incoming.operations.map((operation)=>({...operation,authorId:senderId}))}; setProposals((current)=>current.some((p)=>p.proposalId===proposal.proposalId)?current:[...current,proposal]); void saveProposal(proposal); void updateImage(proposal.imageId,{state:"reviewing"}); }
    else if (type === "proposalDecision") { const proposalId=String(value.proposalId); setProposals((current)=>current.map((proposal)=>{if(proposal.proposalId!==proposalId)return proposal;const next={...proposal,state:String(value.state) as WorkspaceProposal["state"],rejectReason:typeof value.reason==="string"?value.reason:undefined};void saveProposal(next);return next;})); }
    else if (type === "commitCreated" && value.commit) { const commit=value.commit as WorkspaceCommit; setCommits((current)=>[...current.filter((item)=>item.commitId!==commit.commitId),commit]); if(workspace?.role==="collaborator")setNewVersions((current)=>({...current,[commit.imageId]:commit.commitId})); void saveCommit(commit); }
    else if (type === "styleUpdated" && value.style && isValidStyle(value.style as WorkspaceStyle)) { const style=value.style as WorkspaceStyle; setWorkspace((current)=>{if(!current||style.revision<=current.style.revision)return current;const next={...current,name:style.header.text.content,style};setStyleDraft(style);void saveWorkspace(next);return next;}); }
    else if (type === "reaction") {
      const emoji = String(value.emoji || "👍");
      showReaction(emoji);
      setReactionCounts((current) => ({ ...current, [emoji]: (current[emoji] || 0) + 1 }));
    }
    else if (type === "message") setMessages((current)=>[...current,{id:String(value.eventId||id("message")),text:String(value.text||""),actor:String(value.senderName||"Guest")}]);
    else if (type === "reviewMessage" && value.message) reviewListeners.current.forEach((listener)=>listener({sequence:Number(value.sequence||0),message:value.message as ReviewCollaborationMessage}));
  }, [images, persistActivity, sendWorkspaceSnapshot, updateImage, workspace]);
  realtimeEventRef.current = handleRealtimeEvent;

  const sourceTransfers = React.useRef(new SourceTransferRegistry());
  async function receiveSource(value: Record<string, unknown>) {
    const requestId = String(value.requestId || "");
    if (value.type === "sourceStart") {
      sourceTransfers.current.start({
        requestId,
        imageId: String(value.imageId || ""),
        mimeType: String(value.mimeType || ""),
        totalChunks: Number(value.totalChunks),
        totalBytes: Number(value.totalBytes),
        sha256: String(value.sha256 || ""),
        currentCommitId: typeof value.currentCommitId === "string" ? value.currentCommitId : null,
      });
      return;
    }
    if (value.type === "sourceChunk") {
      const chunk = value.bytes instanceof ArrayBuffer
        ? value.bytes
        : ArrayBuffer.isView(value.bytes)
          ? value.bytes
          : Array.isArray(value.bytes)
            ? new Uint8Array(value.bytes.map(Number))
            : null;
      if (chunk) sourceTransfers.current.push(requestId, Number(value.index), chunk);
      return;
    }
    const completed = await sourceTransfers.current.complete(requestId);
    if (completed) {
      const image = imagesRef.current.find((candidate) => candidate.imageId === completed.imageId);
      if (!image) return;
      const persisted: WorkspaceImage = {
        ...image,
        source: completed.source,
        sourceCached: true,
        size: completed.source.size,
        currentCommitId: completed.currentCommitId ?? image.currentCommitId,
        state: "working" as const,
        updatedAt: Date.now(),
      };
      await saveWorkspaceImage(persisted);
      const cached = { ...persisted, source: undefined };
      imagesRef.current = imagesRef.current.map((candidate) => candidate.imageId === completed.imageId ? cached : candidate);
      setImages(imagesRef.current);
      setNewVersions((current) => {
        const next = { ...current };
        delete next[completed.imageId];
        return next;
      });
    }
  }

  async function acceptSourceRequest(value: Record<string, unknown>) {
    const image=images.find((item)=>item.imageId===value.imageId);
    if(!image?.sourceCached||!image.shared){setSourceRequestDialog(null);return;}
    const source=await readWorkspaceImageSource(image);
    if(!source){setSourceRequestDialog(null);return;}
    const data=new Uint8Array(await source.arrayBuffer()),chunkSize=48*1024;
    const total=Math.ceil(data.length/chunkSize),sha256=await digest(source),targetUserId=String(value.senderId);
    realtimeRef.current?.send("sourceStart",{requestId:value.requestId,imageId:image.imageId,mimeType:image.mimeType,totalChunks:total,totalBytes:data.length,sha256,currentCommitId:image.currentCommitId},{route:"user",targetUserId,delivery:"reliable",dataClass:"sourceOrCommit"});
    for(let index=0;index<total;index++){const chunk=data.slice(index*chunkSize,(index+1)*chunkSize);realtimeRef.current?.sendBinary("sourceChunk",{requestId:value.requestId,index},chunk.buffer as ArrayBuffer,{route:"user",targetUserId,delivery:"bulk",dataClass:"sourceOrCommit"});}
    realtimeRef.current?.send("sourceComplete",{requestId:value.requestId},{route:"user",targetUserId,delivery:"reliable",dataClass:"sourceOrCommit"});
    setSourceRequestDialog(null);setSourceRejectReason("");
  }

  function rejectSourceRequest(value: Record<string, unknown>) {
    const reason=sourceRejectReason.trim()||"Rejected by Owner";
    realtimeRef.current?.send("sourceRejected",{requestId:value.requestId,reason},{route:"user",targetUserId:String(value.senderId),delivery:"reliable"});
    setSourceRequestDialog(null);setSourceRejectReason("");
  }

  React.useEffect(() => { let active=true; void (async()=>{ let current:WorkspaceIdentity; if(shareToken){const joined=await joinWorkspace(shareToken);current={workspaceId:joined.workspace.id,name:joined.workspace.name,role:"collaborator",shareToken,ownerCapability:null,createdAt:Date.parse(joined.workspace.createdAt),updatedAt:Date.parse(joined.workspace.updatedAt),style:defaultWorkspaceStyle()};await saveWorkspace(current);}else current=await restoreLocalWorkspace();await purgeExpiredCache(); if(!active)return; setWorkspace(current);setStyleDraft(current.style);const [storedImages,storedActivities,storedProposals]=await Promise.all([listWorkspaceImages(current.workspaceId),listActivities(current.workspaceId),listProposals(current.workspaceId)]);if(!active)return;setImages(storedImages);setActivities(storedActivities);setProposals(storedProposals);if(current.role==="collaborator"||current.shareToken){const realtime=new WorkspaceRealtimeClient(current);realtimeRef.current=realtime;realtime.subscribe((value)=>realtimeEventRef.current(value));transitionRuntime({type:"transition",next:"connecting"});await realtime.connect();}})().catch((error)=>{setNotice(error instanceof Error?error.message:"Workspace unavailable");transitionRuntime({type:"transition",next:"unavailable"});});return()=>{active=false;sourceTransfers.current.clear();pendingProposalEvents.current.clear();reactionTimers.current.forEach((timer)=>window.clearTimeout(timer));reactionTimers.current.clear();reactionNodes.current.forEach((node)=>node.remove());reactionNodes.current.clear();realtimeRef.current?.disconnect();realtimeRef.current=null;};},[shareToken]);

  React.useEffect(() => { if (!selectedId && images[0]) setSelectedId(images[0].imageId); if (selectedId && !images.some((image) => image.imageId === selectedId)) setSelectedId(images[0]?.imageId || null); }, [images, selectedId]);
  React.useEffect(()=>{if(realtimeRef.current&&runtime==="available")realtimeRef.current.send("presence",{action:selectedId?"viewing":"idle",imageId:selectedId},{delivery:"ephemeral",dataClass:"presence"});},[runtime,selectedId]);
  React.useEffect(() => {
    if (workspace?.role !== "collaborator" || runtime !== "syncing") return;
    const requestSnapshot = () => realtimeRef.current?.send(
      "stateRequest",
      {},
      { route: "owner", delivery: "reliable" },
    );
    const initialTimer = window.setTimeout(requestSnapshot, 1_000);
    const timer = window.setInterval(requestSnapshot, 2_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [runtime, workspace?.role]);
  React.useEffect(() => { if(selectedId)void listCommits(selectedId).then((values)=>setCommits((current)=>[...current.filter((item)=>item.imageId!==selectedId),...values])); }, [selectedId]);

  async function addFiles(files: FileList | File[]) { if(!workspace||workspace.role!=="owner")return;for(const file of Array.from(files)){if(!file.type.startsWith("image/"))continue;const [size,thumbnail]=await Promise.all([dimensions(file),generateShareThumbnail(file,320,240)]),imageId=id("image"),initialCommitId=`initial_${imageId}`,preview=new Blob([thumbnail.slice().buffer as ArrayBuffer],{type:"image/webp"});const image:WorkspaceImage={imageId,workspaceId:workspace.workspaceId,name:file.name,mimeType:file.type,size:file.size,...size,workspaceLocation:"library",state:"private",shared:false,currentCommitId:initialCommitId,previewRevision:0,createdAt:Date.now(),updatedAt:Date.now(),sourceCached:true,previewCached:true,source:file,preview};const initial:WorkspaceCommit={commitId:initialCommitId,imageId,authorId:"owner",parentCommitId:null,mergeParentCommitIds:[],operations:[],snapshot:file,snapshotName:file.name,snapshotMimeType:file.type,snapshotWidth:size.width,snapshotHeight:size.height,createdAt:Date.now()};await Promise.all([saveWorkspaceImage(image),saveCommit(initial)]);const cached={...image,source:undefined,preview:undefined};setImages((current)=>[...current,cached]);setCommits((current)=>[...current,initial]);setSelectedId(imageId);await persistActivity(workspace.workspaceId,"imageAdded",image.imageId);}if(inputRef.current)inputRef.current.value=""; }
  async function moveImageToWorking(image: WorkspaceImage) {
    if (!workspace || workspace.role !== "owner") return;
    await updateImage(image.imageId, {
      workspaceLocation: "working",
      state: image.state === "private" ? "working" : image.state,
    });
    setSelectedId(image.imageId);
    await persistActivity(workspace.workspaceId, "imageMovedToWorking", image.imageId);
  }
  function requestMoveImageToWorking(image: WorkspaceImage) {
    const weakNetwork = browserReportsWeakNetwork();
    if (shouldSuggestWorkspaceCompression(image.size, weakNetwork)) {
      setCompressionSuggestionWeakNetwork(weakNetwork);
      setPendingWorkingImageId(image.imageId);
      return;
    }
    void moveImageToWorking(image);
  }
  async function moveImageToLibrary(image: WorkspaceImage) {
    if (!workspace || workspace.role !== "owner") return;
    realtimeRef.current?.send("previewRemove", { imageId: image.imageId }, {
      delivery: "reliable", dataClass: "preview",
    });
    await updateImage(image.imageId, {
      workspaceLocation: "library",
      shared: false,
      state: "private",
    });
    setSelectedId(image.imageId);
    await persistActivity(workspace.workspaceId, "imageMovedToLibrary", image.imageId);
  }
  async function saveCompressedWorkingCopy(source: WorkspaceImage, result: ProcessedImageResult) {
    if (!workspace || workspace.role !== "owner") return;
    const imageId = id("image");
    const initialCommitId = `initial_${imageId}`;
    const createdAt = Date.now();
    const thumbnail = await generateShareThumbnail(result.blob, 320, 240);
    const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
    const image: WorkspaceImage = {
      imageId,
      workspaceId: workspace.workspaceId,
      name: result.name,
      mimeType: result.blob.type || source.mimeType,
      size: result.blob.size,
      width: result.width,
      height: result.height,
      workspaceLocation: "working",
      state: "working",
      shared: false,
      currentCommitId: initialCommitId,
      previewRevision: 0,
      createdAt,
      updatedAt: createdAt,
      sourceCached: true,
      previewCached: true,
      source: result.blob,
      preview,
    };
    const initialCommit: WorkspaceCommit = {
      commitId: initialCommitId,
      imageId,
      authorId: "owner",
      parentCommitId: null,
      mergeParentCommitIds: [],
      operations: [],
      snapshot: result.blob,
      snapshotName: result.name,
      snapshotMimeType: image.mimeType,
      snapshotWidth: result.width,
      snapshotHeight: result.height,
      createdAt,
    };
    await Promise.all([saveWorkspaceImage(image), saveCommit(initialCommit)]);
    setImages((current) => [...current, { ...image, source: undefined, preview: undefined }]);
    setCommits((current) => [...current, initialCommit]);
    setSelectedId(imageId);
    setCompressingToWorkingImageId(null);
    setEditing(null);
    await persistActivity(workspace.workspaceId, "imageCompressedToWorking", imageId, {
      sourceImageId: source.imageId,
    });
  }
  async function publishPreview(image: WorkspaceImage, source: Blob, targetUserId?: string) {
    const revision = image.previewRevision + 1;
    const [placeholder, thumbnail] = await Promise.all([
      generateSharePlaceholder(source),
      generateShareThumbnail(source, 640, 480),
    ]);
    const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
    await updateImage(image.imageId, { placeholder, preview, previewRevision: revision });
    const route = targetUserId ? "user" as const : "workspace" as const;
    realtimeRef.current?.send("placeholderUpsert", {
      imageId: image.imageId, imageName: image.name, mimeType: image.mimeType, size: image.size,
      width: image.width, height: image.height, placeholder, revision,
      currentCommitId: image.currentCommitId,
    }, { route, targetUserId, delivery: "reliable", dataClass: "preview" });
    realtimeRef.current?.sendBinary("previewUpsert", { image: {
      imageId: image.imageId, imageName: image.name, mimeType: "image/webp",
      sourceMimeType: image.mimeType, width: image.width, height: image.height,
      placeholder, version: revision, currentCommitId: image.currentCommitId,
    } }, thumbnail.slice().buffer as ArrayBuffer, { route, targetUserId, delivery: "bulk", dataClass: "preview" });
  }

  async function publishImage(image: WorkspaceImage) {
    if (!workspace || !image.sourceCached) return;
    const shared = !image.shared;
    const next = { ...image, shared, state: shared ? "shared" as const : "private" as const };
    await updateImage(image.imageId, { shared, state: next.state });
    if (!shared) {
      realtimeRef.current?.send("previewRemove", { imageId: image.imageId }, {
        delivery: "reliable", dataClass: "preview",
      });
      await persistActivity(workspace.workspaceId, "imageUnshared", image.imageId);
      return;
    }
    const source = await readWorkspaceImageSource(image);
    if (!source) return;
    await publishPreview(next, source);
    await persistActivity(workspace.workspaceId, "imageShared", image.imageId);
  }
  async function createShare(){if(!workspace)return;const created=await createWorkspaceShare(workspace.name);const previousId=workspace.workspaceId;const next={...workspace,workspaceId:created.workspace.id,shareToken:created.workspace.shareId,ownerCapability:created.ownerCapability,updatedAt:Date.now()};await promoteLocalWorkspace(previousId,next);setWorkspace(next);setImages((current)=>current.map((image)=>({...image,workspaceId:next.workspaceId})));const realtime=new WorkspaceRealtimeClient(next);realtimeRef.current?.disconnect();realtimeRef.current=realtime;realtime.subscribe((value)=>realtimeEventRef.current(value));transitionRuntime({type:"transition",next:"connecting"});await realtime.connect();}
  async function rotateShare(){if(!workspace)return;const result=await rotateWorkspaceShare(workspace);const next={...workspace,shareToken:result.workspace.shareId,updatedAt:Date.now()};await saveWorkspace(next);setWorkspace(next);setNotice("A new link was created. The previous link is no longer valid.");}
  async function copyShare(){if(!workspace?.shareToken)return;await navigator.clipboard.writeText(shareUrl(workspace.shareToken));setCopied(true);window.setTimeout(()=>setCopied(false),1500);}
  function showReaction(emoji:string){const node=document.createElement("div");node.textContent=emoji;node.className="pointer-events-none fixed left-1/2 top-1/2 z-[100] text-5xl workspace-reaction-float";document.body.append(node);reactionNodes.current.add(node);const timer=window.setTimeout(()=>{node.remove();reactionNodes.current.delete(node);reactionTimers.current.delete(timer);},1400);reactionTimers.current.add(timer);}
  function react(emoji:string){if(!onlinePeers)return;showReaction(emoji);setReactionCounts((current)=>({...current,[emoji]:(current[emoji]||0)+1}));realtimeRef.current?.send("reaction",{emoji},{delivery:"ephemeral",dataClass:"presence"});}
  function sendMessage(){const text=message.trim();if(!text||!onlinePeers)return;setMessages((current)=>[...current,{id:id("message"),text,actor:"You"}]);realtimeRef.current?.send("message",{text},{delivery:"ephemeral"});if(workspace)void persistActivity(workspace.workspaceId,"message",selected?.imageId);setMessage("");}
  function requestSource(value: WorkspaceImage | React.SyntheticEvent | null = selected){const image=value&&"imageId" in value?value:selected;if(!image||!image.shared||runtime!=="available")return;realtimeRef.current?.send("sourceRequest",{requestId:id("source"),imageId:image.imageId},{route:"owner",delivery:"reliable",dataClass:"collaborationEvent"});}
  async function submitProposal(proposal:WorkspaceProposal){const submitted={...proposal,state:"submitted" as const};await saveProposal(submitted);setProposals((current)=>current.map((item)=>item.proposalId===proposal.proposalId?submitted:item));const eventId=realtimeRef.current?.send("proposalSubmit",{proposal:submitted},{route:"owner",delivery:"reliable"});if(eventId)pendingProposalEvents.current.set(eventId,proposal.proposalId);}
  async function createOperation(
    type: WorkspaceOperation["type"],
    parameters: Record<string, unknown> = {},
    processed?: { blob: Blob; name: string; mimeType: string; width: number; height: number },
  ) {
    if (!workspace || !selected) return;
    const operation: WorkspaceOperation = { operationId: id("operation"), imageId: selected.imageId,
      authorId: "local", baseCommitId: selected.currentCommitId || `initial_${selected.imageId}`,
      type, parameters, createdAt: Date.now() };
    if (workspace.role === "collaborator") {
      const proposal: WorkspaceProposal = { proposalId: id("proposal"), workspaceId: workspace.workspaceId,
        imageId: selected.imageId, authorId: "local", baseCommitId: operation.baseCommitId,
        operations: [operation], state: "draft", createdAt: Date.now() };
      await saveProposal(proposal);
      setProposals((current) => [...current, proposal]);
      await submitProposal(proposal);
      return;
    }
    const latest = processed ? { ...selected, source: processed.blob, name: processed.name,
      mimeType: processed.mimeType, size: processed.blob.size, width: processed.width,
      height: processed.height } : images.find((image) => image.imageId === selected.imageId) || selected;
    const latestSource = latest.source || await loadSource(selected);
    if (!latestSource) throw new Error("Source data is unavailable");
    const commit: WorkspaceCommit = { commitId: id("commit"), imageId: selected.imageId,
      authorId: "owner", parentCommitId: selected.currentCommitId, mergeParentCommitIds: [],
      operations: [operation], snapshot: latestSource, snapshotName: latest.name,
      snapshotMimeType: latest.mimeType, snapshotWidth: latest.width, snapshotHeight: latest.height,
      createdAt: Date.now() };
    await saveCommit(commit);
    setCommits((current) => [...current, commit]);
    const updated = { ...latest, currentCommitId: commit.commitId, state: "committed" as const };
    await updateImage(selected.imageId, updated);
    if (updated.shared) await publishPreview(updated, latestSource);
    const { snapshot: _snapshot, ...commitMetadata } = commit;
    realtimeRef.current?.send("commitCreated", { commit: commitMetadata }, {
      delivery: "reliable", dataClass: "sourceOrCommit",
    });
  }

  async function proposalInput(proposal: WorkspaceProposal) {
    const image = images.find((item) => item.imageId === proposal.imageId);
    if (!image) throw new Error("Proposal image is unavailable");
    if (image.currentCommitId === proposal.baseCommitId) return image;
    const history = await listCommits(proposal.imageId);
    const base = history.find((commit) => commit.commitId === proposal.baseCommitId);
    if (!base?.snapshot) throw new Error("Proposal base version is unavailable");
    return { ...image, source: base.snapshot, name: base.snapshotName || image.name,
      mimeType: base.snapshotMimeType || image.mimeType, width: base.snapshotWidth || image.width,
      height: base.snapshotHeight || image.height };
  }

  async function previewProposal(proposal: WorkspaceProposal) {
    try {
      const result = await replayOperations(await proposalInput(proposal), proposal.operations);
      setProposalPreview({ proposalId: proposal.proposalId, blob: result.blob });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Proposal preview is unavailable");
    }
  }

  async function decideProposal(proposal:WorkspaceProposal,state:"applied"|"rejected"|"deferred",rejectReason?:string){
    const reason=state==="rejected"?(rejectReason?.trim()||"Rejected by Owner"):undefined;
    if(state==="applied"){
      const image=images.find((item)=>item.imageId===proposal.imageId);if(!image)return;
      try{
        const result=await replayOperations(await proposalInput(proposal),proposal.operations);
        const commit:WorkspaceCommit={commitId:id("commit"),imageId:proposal.imageId,authorId:"owner",parentCommitId:image.currentCommitId,mergeParentCommitIds:image.currentCommitId!==proposal.baseCommitId?[proposal.baseCommitId]:[],operations:proposal.operations,snapshot:result.blob,snapshotName:result.name,snapshotMimeType:result.mimeType,snapshotWidth:result.width,snapshotHeight:result.height,createdAt:Date.now()};
        await saveCommit(commit);setCommits((current)=>[...current,commit]);
        const updated={...image,source:result.blob,preview:result.blob,name:result.name,mimeType:result.mimeType,size:result.blob.size,width:result.width,height:result.height,currentCommitId:commit.commitId,state:"committed" as const};
        await updateImage(proposal.imageId,updated);
        if(updated.shared)await publishPreview(updated,result.blob);
        const{snapshot:_snapshot,...metadata}=commit;realtimeRef.current?.send("commitCreated",{commit:metadata},{delivery:"reliable",dataClass:"sourceOrCommit"});
      }catch(error){setNotice(error instanceof Error?error.message:"Proposal could not be applied");return;}
    }
    const next={...proposal,state,rejectReason:reason};await saveProposal(next);setProposals((current)=>current.map((item)=>item.proposalId===proposal.proposalId?next:item));realtimeRef.current?.send("proposalDecision",{proposalId:proposal.proposalId,state,reason},{route:"user",targetUserId:proposal.authorId,delivery:"reliable"});
  }
  async function saveStyle(){if(!workspace||workspace.role!=="owner"||!isValidStyle(styleDraft))return;const style={...styleDraft,revision:workspace.style.revision+1};const next={...workspace,name:style.header.text.content,style,updatedAt:Date.now()};await saveWorkspace(next);setWorkspace(next);setStyleDraft(style);setSettingsOpen(false);realtimeRef.current?.send("styleUpdated",{style},{delivery:"reliable"});}
  async function rollbackCommit(commit: WorkspaceCommit) {
    if (workspace?.role !== "owner" || !selected || !commit.snapshot) return;
    const rollback: WorkspaceCommit = { ...commit, commitId: id("commit"), authorId: "owner",
      parentCommitId: selected.currentCommitId, mergeParentCommitIds: [], operations: [{
        operationId: id("operation"), imageId: selected.imageId, authorId: "owner",
        baseCommitId: selected.currentCommitId || commit.commitId, type: "other",
        parameters: { rollbackTo: commit.commitId }, createdAt: Date.now(),
      }], createdAt: Date.now() };
    await saveCommit(rollback);
    setCommits((current) => [...current, rollback]);
    const updated = { ...selected, source: commit.snapshot, preview: commit.snapshot,
      name: commit.snapshotName || selected.name, mimeType: commit.snapshotMimeType || selected.mimeType,
      width: commit.snapshotWidth || selected.width, height: commit.snapshotHeight || selected.height,
      size: commit.snapshot.size, currentCommitId: rollback.commitId, state: "committed" as const };
    await updateImage(selected.imageId, updated);
    if (updated.shared) await publishPreview(updated, commit.snapshot);
    const { snapshot: _snapshot, ...metadata } = rollback;
    realtimeRef.current?.send("commitCreated", { commit: metadata }, {
      delivery: "reliable", dataClass: "sourceOrCommit",
    });
  }
  async function rotateSelected(){if(!workspace||!selected)return;const source=await loadSource(selected);if(!source)return;const result=await rotateImage(source,selected.name,90);if(workspace.role==="collaborator")await updateImage(selected.imageId,{preview:result.blob,width:result.width,height:result.height,state:"working"});await createOperation("rotate",{degrees:90},result);releaseProcessingSource();}

  const editorSource=selected&&processingSource?.imageId===selected.imageId?processingSource.blob:null;
  const previewUrl=React.useMemo(()=>editorSource?URL.createObjectURL(editorSource):null,[editorSource]);
  React.useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
  const editorImage = React.useMemo<RoomImage | null>(() => workspace && selected && editorSource && previewUrl ? {
    id: selected.imageId, roomId: workspace.workspaceId, name: selected.name, type: selected.mimeType,
    size: selected.size, blob: editorSource, direction: workspace.role === "owner" ? "sent" : "received",
    rootImageId: selected.imageId, parentImageId: null, ownerId: workspace.role === "owner" ? "owner" : "remote",
    width: selected.width, height: selected.height, source: workspace.role === "owner" ? "local" : "received",
    operation: "original", version: 1, createdAt: selected.createdAt, updatedAt: selected.updatedAt,
    url: previewUrl,
  } : null, [editorSource, previewUrl, selected, workspace]);
  const labels = React.useMemo(() => getShareRoomLabels("en"), []);
  async function saveProcessedResult(result: ProcessedImageResult) {
    if (!workspace || !selected) return;
    const operationType: WorkspaceOperation["type"] = result.operation === "adjust"
      ? "brightness"
      : result.operation === "compress"
        ? "compression"
        : result.operation === "convert"
          ? "other"
          : result.operation;
    if (workspace.role !== "owner") {
      await updateImage(selected.imageId, { preview: result.blob, state: "working" });
    }
    setEditing(null);
    await createOperation(operationType, result.parameters || {}, { blob: result.blob, name: result.name,
      mimeType: result.blob.type || selected.mimeType, width: result.width, height: result.height });
    releaseProcessingSource();
  }
  if(!workspace&&runtime==="unavailable")return <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center"><FiX className="mb-3 h-8 w-8 text-red-500"/><h1 className="text-lg font-semibold text-slate-900">Workspace unavailable</h1><p className="mt-2 max-w-md text-sm text-slate-600">{notice||"The share link is invalid or no longer active."}</p><a href="/workspace" className="mt-5 rounded-md bg-[#2f65cf] px-4 py-2 text-sm text-white">Open my workspace</a></main>;
  if(!workspace)return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><FiRefreshCw className="mr-2 animate-spin"/>Loading workspace</main>;
  if(reviewOpen&&editorImage)return <main className="flex h-screen min-h-0 min-w-0 overflow-hidden"><ReviewWorkspace roomId={workspace.workspaceId} image={editorImage} labels={labels} actorId={workspace.role} role={workspace.role==="owner"?"owner":"guest"} fullscreen={reviewFullscreen} shareRecipients={[]} subscribeMessages={subscribeReviewMessages} onSendMessage={sendReviewMessage} onReviewStatusChange={handleReviewStatusChange} onReviewEditingChange={handleReviewEditingChange} onFullscreenChange={setReviewFullscreen} onGenerateImage={async(_source,result)=>{const processed={blob:result.blob,name:result.name,mimeType:result.blob.type||selected!.mimeType,width:result.width,height:result.height};await updateImage(selected!.imageId,{source:workspace.role==="owner"?result.blob:editorSource||undefined,preview:result.blob,name:result.name,mimeType:processed.mimeType,size:result.blob.size,width:result.width,height:result.height});await createOperation("other",{review:true},processed);return{status:"saved",imageId:selected!.imageId};}} onResolveRejectedImage={async()=>undefined} onBack={()=>{setReviewOpen(false);releaseProcessingSource();}}/></main>;
  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[#f3f5f8] text-[#172033]">
    <header className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[#dfe3e8] px-3 sm:gap-6 sm:px-[22px]" style={headerBackground(workspace.style)}>
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {workspace.role==="collaborator"?<button type="button" onClick={()=>setLeaveConfirmOpen(true)} className="shrink-0" aria-label="Leave workspace"><img src="/images/wordmark.png" alt="PicBind" className="h-6 max-w-[78px] object-contain sm:h-7 sm:max-w-none"/></button>:<a href="/" className="shrink-0" aria-label="PicBind home"><img src="/images/wordmark.png" alt="PicBind" className="h-6 max-w-[78px] object-contain sm:h-7 sm:max-w-none"/></a>}
        <div className="min-w-0 border-l border-current/25 pl-2 sm:pl-4">
          <span className="hidden text-[10px] font-semibold uppercase opacity-70 sm:block">Image Workspace</span>
          <strong className="block max-w-[92px] truncate sm:max-w-[34vw]" style={{fontFamily:workspace.style.header.text.fontFamily,fontSize:workspace.style.header.text.fontSize,fontWeight:workspace.style.header.text.fontWeight}}>{workspace.style.header.text.content||workspace.name}</strong>
        </div>
        <span className="hidden rounded bg-black/5 px-2 py-1 text-[10px] font-semibold uppercase opacity-70 sm:inline-flex">{statusLabel[runtime]}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" className={`relative flex h-9 items-center justify-center gap-1 rounded-md px-2 hover:bg-black/5 ${collaborationOpen?"bg-black/5":""}`} onClick={()=>setCollaborationOpen((value)=>!value)} title="Collaboration" aria-pressed={collaborationOpen}><FiUsers className="h-[18px] w-[18px]"/>{onlinePeers?<span className="min-w-3 text-[10px] font-bold">{onlinePeers}</span>:null}</button>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5" onClick={()=>workspace.shareToken?void copyShare():workspace.role==="owner"?void createShare():undefined} title={workspace.shareToken?"Copy share link":"Create share link"}>{copied?<FiCheck/>:<FiShare2/>}</button>
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5" onClick={()=>setSettingsOpen(true)} title="Workspace settings"><FiSettings/></button>
        {workspace.role==="collaborator"?<button type="button" onClick={()=>setLeaveConfirmOpen(true)} className="hidden h-9 w-9 items-center justify-center rounded-md text-red-600 hover:bg-red-50 sm:flex" title="Leave workspace"><FiX/></button>:<a href="/" className="hidden h-9 w-9 items-center justify-center rounded-md hover:bg-black/5 sm:flex" title="Home"><FiHome/></a>}
      </div>
    </header>
    {notice?<div className="flex shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900"><span>{notice}</span><button type="button" onClick={()=>setNotice(null)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-amber-100"><FiX/></button></div>:null}
    {workspace.role==="collaborator"&&(runtime==="ownerOffline"||runtime==="unavailable")?<div className="shrink-0 border-b border-amber-200 bg-[#fff9eb] px-[18px] py-2 text-xs text-[#754f13]"><strong className="mr-2">Owner is offline.</strong>{images.length?"Showing cached workspace data.":"No cached workspace data is available."}</div>:null}
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_clamp(320px,24vw,420px)] lg:overflow-hidden">
      <section className="flex min-w-0 flex-col p-4 sm:p-6 lg:min-h-0 lg:overflow-auto">
        <div className="mb-[18px] flex items-center justify-between gap-5">
          <div><h1 className="text-[21px] font-bold leading-tight text-[#192337]">Gallery</h1><p className="mt-1 text-[13px] text-[#7b8494]">Images stay on this device until you explicitly share them.</p></div>
          {workspace.role==="owner"?<><button type="button" onClick={()=>inputRef.current?.click()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-[13px] font-bold text-white hover:bg-[#2457bd]"><FiUploadCloud/>Choose images</button><input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event)=>event.target.files&&void addFiles(event.target.files)}/></>:null}
        </div>
        <div className={`grid min-h-[360px] flex-1 overflow-hidden rounded-lg border-2 border-dashed bg-white/80 transition ${dragging?"border-[#2f65cf] bg-blue-50":"border-[#c9d0da]"} ${libraryCollapsed?"sm:grid-cols-[44px_minmax(0,1fr)]":"sm:grid-cols-[240px_minmax(0,1fr)]"}`} onDragEnter={(event)=>{if(workspace.role!=="owner")return;event.preventDefault();setDragging(true);}} onDragOver={(event)=>{if(workspace.role==="owner")event.preventDefault();}} onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}} onDrop={(event)=>{if(workspace.role!=="owner")return;event.preventDefault();setDragging(false);void addFiles(event.dataTransfer.files);}}>
          {libraryCollapsed?<aside className="hidden min-h-0 flex-col items-center border-r border-slate-200 bg-slate-50/80 pt-2 sm:flex"><button type="button" onClick={()=>setLibraryCollapsed(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title="Expand Origin library"><FiChevronRight/></button><button type="button" onClick={()=>workspace.role==="owner"&&inputRef.current?.click()} className="relative mt-2 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title="Origin library"><FiImage/>{libraryImages.length?<span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[#2f65cf] px-1 text-center text-[8px] text-white">{Math.min(libraryImages.length,99)}</span>:null}</button></aside>:<aside className="hidden min-h-0 min-w-0 flex-col border-r border-slate-200 bg-slate-50/80 sm:flex"><div className="flex items-start justify-between border-b border-slate-200 p-3"><div className="min-w-0"><h2 className="text-xs font-semibold text-slate-800">Origin · Library</h2><p className="mt-0.5 text-[10px] leading-4 text-slate-500">Choose an original, then add it to Working</p></div><button type="button" onClick={()=>setLibraryCollapsed(true)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title="Collapse Origin library"><FiChevronLeft/></button></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{libraryImages.length?libraryImages.map((image)=><WorkspaceLibraryItem key={image.imageId} image={image} role={workspace.role} selected={selectedId===image.imageId} onSelect={()=>setSelectedId(image.imageId)} onAdd={()=>requestMoveImageToWorking(image)} onDelete={()=>{void deleteWorkspaceImage(image.imageId);setImages((current)=>current.filter((item)=>item.imageId!==image.imageId));}}/>):workspace.role==="owner"?<button type="button" onClick={()=>inputRef.current?.click()} className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-400 hover:bg-white/70 hover:text-[#2f65cf]"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50"><FiImage/></span><strong className="text-xs text-slate-700">Choose or drop originals</strong><span className="text-[10px]">PNG, JPEG, WebP or AVIF</span></button>:<div className="flex h-full min-h-40 items-center justify-center p-4 text-center text-xs text-slate-400">Origin images stay on the Owner device</div>}</div></aside>}
          <section className="flex min-h-0 min-w-0 flex-col" aria-label="Working and processing images">
            <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 px-4"><div><h2 className="text-xs font-semibold text-slate-800">Working · Processing</h2><p className="mt-0.5 text-[10px] text-slate-500">Process, review, and share selected images</p></div><span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{workingImages.length}</span></div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {workingImages.length?<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-8 gap-y-4 p-4 sm:pr-8">{workingImagesSorted.map((image)=><WorkspaceGalleryCard key={image.imageId} image={image} role={workspace.role} selected={selectedId===image.imageId} onlinePeers={onlinePeers} onSelect={()=>setSelectedId(image.imageId)} onPin={()=>void updateImage(image.imageId,{pinnedAt:image.pinnedAt?undefined:Date.now()})} onMoveToLibrary={()=>void moveImageToLibrary(image)} onShare={()=>void publishImage(image)} onRequestSource={()=>{setSelectedId(image.imageId);requestSource(image);}} onDownload={()=>void downloadImage(image)} onOperation={(operation)=>void openImageOperation(image,operation)}/>)}</div>:<div className="flex min-h-[300px] h-full w-full flex-col items-center justify-center px-6 text-center text-slate-400"><FiArrowRight className="mb-3 h-7 w-7"/><strong className="text-sm text-slate-600">Working is empty</strong><span className="mt-1 text-xs">Add an image from Origin to begin processing.</span></div>}
            </div>
          </section>
        </div>
      </section>
      <aside className="border-t border-[#dfe3e8] bg-white lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
        {collaborationOpen?<>
          <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold text-[#26344c]"><FiUsers/><span>Collaboration</span></div><button type="button" onClick={()=>setCollaborationOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><FiX/></button></div></section>
          <section className="border-b border-[#e4e7eb] p-4"><div className="mb-3 text-[11px] font-bold uppercase text-[#778294]">Collaborators</div>{collaborators.length?collaborators.map((person)=><div key={person.clientId} className="flex items-center gap-2 py-1.5 text-sm"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{person.displayName.slice(0,2).toUpperCase()}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-800">{person.displayName}</strong><span className="block truncate text-[10px] text-slate-400">{person.currentAction||"Viewing workspace"}</span></span><i className={`h-2 w-2 rounded-full ${person.online?"bg-emerald-500":"bg-slate-300"}`}/></div>):<p className="text-xs text-slate-500">No collaborators connected</p>}</section>
          {proposals.length?<section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#778294]"><FiClock/>Pending proposals</div><div className="mt-2 grid gap-1.5">{proposals.slice().reverse().map((proposal)=><div key={proposal.proposalId} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs"><div className="flex items-center justify-between gap-2"><strong className="truncate">{proposal.operations.map((op)=>op.type).join(", ")}</strong><span className="text-[10px] text-slate-500">{proposal.state}</span></div>{workspace.role==="owner"&&["submitted","pending","deferred","conflict"].includes(proposal.state)?<div className="mt-2 flex flex-wrap gap-1"><button type="button" onClick={()=>void previewProposal(proposal)} className="rounded border bg-white px-2 py-1">Preview</button><button type="button" onClick={()=>void decideProposal(proposal,"applied")} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Apply</button><button type="button" onClick={()=>{setRejectingProposal(proposal);setProposalRejectReason("");}} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button><button type="button" onClick={()=>void decideProposal(proposal,"deferred")} className="rounded bg-slate-200 px-2 py-1">Defer</button></div>:workspace.role==="collaborator"&&proposal.state==="failed"?<button type="button" onClick={()=>void submitProposal(proposal)} disabled={runtime!=="available"} className="mt-2 rounded border bg-white px-2 py-1 disabled:opacity-40">Retry</button>:null}</div>)}</div></section>:null}
          <section className="border-b border-[#e4e7eb] p-3"><div className="flex gap-2">{["👍","❤️","👀","✅","❗"].map((emoji)=>{const count=reactionCounts[emoji]||0;return <button type="button" key={emoji} disabled={!onlinePeers} onClick={()=>react(emoji)} className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-slate-100 px-1 transition hover:bg-blue-50 disabled:opacity-30"><span>{emoji}</span>{count?<span className="text-[10px] font-bold tabular-nums text-slate-500">+{count}</span>:null}</button>;})}</div></section>
          <section className="flex min-h-[260px] flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-2 text-[11px] font-bold uppercase text-[#778294]">Activity</div>{activities.some((item)=>item.kind!=="reaction")?activities.filter((item)=>item.kind!=="reaction").slice(-10).reverse().map((item)=><div key={item.eventId} className="mb-2 border-l-2 border-slate-200 pl-2 text-[11px] text-slate-500"><strong className="text-slate-700">{item.kind}</strong>{item.imageId?` · ${item.imageId.slice(0,12)}`:""}</div>):<p className="text-xs text-slate-400">No recent activity</p>}<div className="mb-2 mt-5 text-[11px] font-bold uppercase text-[#778294]">Messages</div>{messages.length?messages.map((item)=><div key={item.id} className="mb-3 text-xs"><strong>{item.actor}</strong><p className="mt-0.5 text-slate-600">{item.text}</p></div>):<p className="text-xs text-slate-400">No messages</p>}</div><div className="flex gap-2 border-t p-3"><input value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&sendMessage()} disabled={!onlinePeers} className="h-9 min-w-0 flex-1 rounded-md border px-3 text-xs" placeholder="Type a message"/><button type="button" onClick={sendMessage} disabled={!onlinePeers||!message.trim()} className="flex h-9 w-9 items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-30"><FiMessageCircle/></button></div></section>
        </>:<>
          <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[#26344c]"><FiImage/><span>Selected image</span></div>{selected?<><div className="mt-3 grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3"><div className="h-14 w-14 overflow-hidden rounded-md border bg-slate-100"><WorkspaceImageMedia image={selected} role={workspace.role}/></div><div className="min-w-0"><strong className="block truncate text-[13px]">{selected.name}</strong><span className="block text-[11px] text-slate-500">{selected.width} × {selected.height} · {selected.mimeType.replace("image/","").toUpperCase()}</span><span className="block text-[11px] text-slate-500">{bytes(selected.size)}</span></div></div><dl className="mt-3 grid gap-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-500">Location</dt><dd>{selected.workspaceLocation==="library"?"Origin":"Working"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Status</dt><dd className="capitalize">{selected.state}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Current commit</dt><dd className="max-w-[160px] truncate">{selected.currentCommitId||"Initial"}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Collaboration</dt><dd>{selected.shared?"Shared":"Not shared"}</dd></div></dl>{selectedIsLibrary?<button type="button" onClick={()=>requestMoveImageToWorking(selected)} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[#2f65cf] bg-[#2f65cf] text-xs font-bold text-white hover:bg-[#2457bd]"><FiArrowRight/>Add to Working</button>:workspace.role==="owner"?<button type="button" onClick={()=>void publishImage(selected)} className={`mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border text-xs font-bold ${selected.shared?"border-slate-300 bg-white text-slate-600 hover:bg-slate-50":"border-[#2f65cf] bg-[#2f65cf] text-white hover:bg-[#2457bd]"}`}><FiShield/>{selected.shared?"Unshare image":"Share for collaboration"}</button>:!selected.sourceCached?<button type="button" onClick={()=>requestSource(selected)} disabled={runtime!=="available"} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white disabled:opacity-40"><FiDownload/>Request source</button>:null}<div className="mt-4 text-[11px] font-bold uppercase text-[#778294]">Quick actions</div><div className="mt-2 grid grid-cols-3 gap-2"><WorkspaceAction icon={<FiCrop/>} label="Crop" disabled={selectedIsLibrary||!selected.sourceCached} onClick={()=>void openImageOperation(selected,"crop")}/><WorkspaceAction icon={<FiMaximize2/>} label="Resize" disabled={selectedIsLibrary||!selected.sourceCached} onClick={()=>void openImageOperation(selected,"resize")}/><WorkspaceAction icon={<FiSliders/>} label="Adjust" disabled={selectedIsLibrary||!selected.sourceCached} onClick={()=>void openImageOperation(selected,"adjust")}/><WorkspaceAction icon={<FiMinimize2/>} label="Compress" disabled={selectedIsLibrary||!selected.sourceCached} onClick={()=>void openImageOperation(selected,"compress")}/><WorkspaceAction icon={<FiRefreshCw/>} label="Convert" disabled={selectedIsLibrary||!selected.sourceCached} onClick={()=>void openImageOperation(selected,"convert")}/><WorkspaceAction icon={<FiEye/>} label="Review" disabled={selectedIsLibrary||!selected.sourceCached} onClick={()=>void openImageOperation(selected,"review")}/></div><div className="mt-3 flex gap-2">{selected.sourceCached?<button type="button" onClick={()=>void downloadImage(selected)} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md border text-xs"><FiDownload/>Download</button>:null}{selectedIsLibrary?<button type="button" onClick={()=>{void deleteWorkspaceImage(selected.imageId);setImages((current)=>current.filter((item)=>item.imageId!==selected.imageId));}} className="flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-600" title="Delete"><FiTrash2/></button>:workspace.role==="owner"?<button type="button" onClick={()=>void moveImageToLibrary(selected)} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600" title="Return to Origin"><FiArrowLeft/></button>:null}</div>{workspace.role==="collaborator"&&newVersions[selected.imageId]?<div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs"><strong className="text-blue-900">A new version is available</strong><div className="mt-2 flex gap-2"><button type="button" onClick={()=>void readWorkspaceImagePreview(selected).then((preview)=>preview?setVersionPreview({imageName:selected.name,blob:preview}):setNotice("The new Preview is still loading"))} className="rounded border bg-white px-2 py-1">Review</button><button type="button" onClick={()=>requestSource(selected)} disabled={runtime!=="available"} className="rounded bg-[#2f65cf] px-2 py-1 text-white">Update</button><button type="button" onClick={()=>setNewVersions((current)=>{const next={...current};delete next[selected.imageId];return next;})}>Later</button></div></div>:null}</>:<div className="mt-4 flex flex-col items-center gap-2 py-5 text-center text-xs text-slate-400"><FiImage className="h-6 w-6"/><p>Select an image to inspect it.</p></div>}</section>
          <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiHardDrive/><span>Workspace overview</span></div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{images.length}</strong><span className="text-[10px] text-slate-500">Images total</span></div><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{images.filter((image)=>image.shared).length}</strong><span className="text-[10px] text-slate-500">Shared</span></div></div><div className="mt-3 flex gap-2 rounded-md bg-emerald-50 p-3 text-emerald-800"><FiShield className="mt-0.5 shrink-0"/><p className="text-[11px] leading-4">Image data is stored locally on this device.</p></div></section>
          <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiShare2/><span>Workspace share</span></div>{workspace.role!=="owner"?<p className="mt-3 text-xs leading-5 text-slate-500">Joined with a permanent share link.</p>:<><p className="mt-3 text-xs leading-5 text-slate-500">Create a permanent link for collaborators. Creating a new link invalidates the previous one.</p>{workspace.shareToken?<button type="button" onClick={()=>void rotateShare()} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border text-xs"><FiRefreshCw/>Create new link</button>:<button type="button" onClick={()=>void createShare()} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white"><FiLink/>Create share link</button>}</>}</section>
          {selected&&commits.some((commit)=>commit.imageId===selected.imageId)?<section className="p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiClock/><span>Version history</span></div><div className="mt-3 grid gap-2">{commits.filter((commit)=>commit.imageId===selected.imageId).slice().reverse().map((commit)=><div key={commit.commitId} className="flex items-center justify-between rounded-md border p-2 text-[11px]"><div className="min-w-0"><strong className="block truncate">{commit.commitId===selected.currentCommitId?"Current version":commit.commitId.startsWith("initial_")?"Initial version":commit.operations.map((operation)=>operation.type).join(", ")||"Version"}</strong><span className="text-slate-400">{new Date(commit.createdAt).toLocaleString()}</span></div>{workspace.role==="owner"&&commit.snapshot&&commit.commitId!==selected.currentCommitId?<button type="button" onClick={()=>void rollbackCommit(commit)} className="ml-2 rounded border px-2 py-1">Restore</button>:workspace.role==="collaborator"&&commit.commitId!==selected.currentCommitId?<button type="button" onClick={()=>requestSource(selected)} disabled={runtime!=="available"} className="ml-2 rounded border px-2 py-1">Update</button>:null}</div>)}</div></section>:null}
        </>}
      </aside>
    </div>
    <ImageCropDialog image={editing === "crop" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageResizeDialog image={editing === "resize" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageColorAdjustmentDialog image={editing === "adjust" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageCompressionDialog image={editing === "compress" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);setCompressingToWorkingImageId(null);releaseProcessingSource();}} onSave={(_source, result) => compressingToWorkingImage?saveCompressedWorkingCopy(compressingToWorkingImage,result).finally(releaseProcessingSource):saveProcessedResult(result)}/>
    <ImageConversionDialog image={editing === "convert" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)}/>
    <CompressionSuggestionDialog open={Boolean(pendingWorkingImage)} weakNetwork={compressionSuggestionWeakNetwork} labels={labels} onCancel={()=>setPendingWorkingImageId(null)} onContinue={()=>{const image=pendingWorkingImage;setPendingWorkingImageId(null);if(image)void moveImageToWorking(image);}} onCompress={()=>{const image=pendingWorkingImage;setPendingWorkingImageId(null);if(image){setCompressingToWorkingImageId(image.imageId);void openImageOperation(image,"compress");}}}/>
    {leaveConfirmOpen?<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setLeaveConfirmOpen(false)}><div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Leave workspace"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700"><FiUsers/></div><h2 className="mt-4 text-base font-semibold">Leave this workspace?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Leaving disconnects the current collaboration session. Opening Image Workspace from the home page returns to your own workspace.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setLeaveConfirmOpen(false)} className="h-9 rounded-md border px-4 text-sm">Cancel</button><a href="/workspace" className="flex h-9 items-center rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white">Leave workspace</a></div></div></div>:null}
    {proposalPreview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setProposalPreview(null)}><div className="w-full max-w-3xl rounded-md bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Proposal preview</h2><p className="text-xs text-slate-500">{proposalPreview.proposalId}</p></div><button onClick={()=>setProposalPreview(null)} className="flex h-9 w-9 items-center justify-center"><FiX/></button></div><div className="aspect-video overflow-hidden rounded-md bg-slate-100"><BlobImageMedia blob={proposalPreview.blob} alt="Proposal preview"/></div></div></div> : null}
    {versionPreview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setVersionPreview(null)}><div className="w-full max-w-3xl rounded-md bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">New version preview</h2><p className="text-xs text-slate-500">{versionPreview.imageName}</p></div><button onClick={()=>setVersionPreview(null)} className="flex h-9 w-9 items-center justify-center"><FiX/></button></div><div className="aspect-video overflow-hidden rounded-md bg-slate-100"><BlobImageMedia blob={versionPreview.blob} alt={versionPreview.imageName}/></div></div></div>:null}
    {sourceRequestDialog ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Source data request</h2><p className="mt-2 text-sm text-slate-600">{String(sourceRequestDialog.requesterName||"Guest")} wants the original data for {images.find((image)=>image.imageId===sourceRequestDialog.imageId)?.name||"this image"}.</p><label className="mt-4 block text-sm">Reject reason (optional)<input value={sourceRejectReason} onChange={(event)=>setSourceRejectReason(event.target.value)} maxLength={240} className="mt-1 h-9 w-full rounded-md border px-3"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={()=>rejectSourceRequest(sourceRequestDialog)} className="h-9 rounded-md border border-red-200 px-4 text-sm text-red-700">Reject</button><button onClick={()=>void acceptSourceRequest(sourceRequestDialog)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm text-white">Accept</button></div></div></div>:null}
    {rejectingProposal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Reject proposal</h2><label className="mt-4 block text-sm">Reason<textarea value={proposalRejectReason} onChange={(event)=>setProposalRejectReason(event.target.value)} maxLength={500} rows={4} className="mt-1 w-full rounded-md border p-3"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setRejectingProposal(null)} className="h-9 rounded-md border px-4 text-sm">Cancel</button><button onClick={()=>{const proposal=rejectingProposal;setRejectingProposal(null);void decideProposal(proposal,"rejected",proposalRejectReason);}} className="h-9 rounded-md bg-red-600 px-4 text-sm text-white">Reject</button></div></div></div>:null}
    {settingsOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}><div className="flex max-h-[calc(100vh-32px)] w-full max-w-[720px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-base font-semibold">Workspace settings</h2><p className="mt-0.5 text-xs text-slate-500">Workspace style editor</p></div><button type="button" onClick={()=>setSettingsOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><FiX/></button></header><div className="grid min-h-0 overflow-y-auto md:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]"><div className="flex min-w-0 flex-col gap-2.5 border-b bg-[#f6f7f9] p-[18px] md:border-b-0 md:border-r"><span className="text-[11px] font-bold text-slate-500">Style preview</span><div className="flex min-h-[94px] min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-md border border-black/10 px-4 py-3" style={headerBackground(styleDraft)}><strong className="truncate" style={{fontFamily:styleDraft.header.text.fontFamily,fontSize:styleDraft.header.text.fontSize,fontWeight:styleDraft.header.text.fontWeight}}>{styleDraft.header.text.content||"Workspace"}</strong><span className="text-[10px] opacity-70">Image Workspace</span></div></div>{workspace.role==="owner"?<fieldset className="grid gap-4 p-[18px] sm:grid-cols-2"><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Header text<input value={styleDraft.header.text.content} maxLength={80} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,content:event.target.value}}}))} className="h-9 rounded-md border bg-white px-3 text-sm font-normal text-slate-800"/></label><div className="grid gap-1.5 sm:col-span-2"><span className="text-[11px] font-bold text-slate-500">Background</span><div className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-xs"><button type="button" onClick={()=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"solid",color:"#ffffff"},text:{...value.header.text,color:"#273247"}}}))} className={`h-8 rounded ${styleDraft.header.background.type==="solid"?"bg-white font-semibold shadow-sm":"text-slate-500"}`}>Solid</button><button type="button" onClick={()=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"gradient",from:"#17324d",to:"#2f7d66",direction:"right"},text:{...value.header.text,color:"#ffffff"}}}))} className={`h-8 rounded ${styleDraft.header.background.type==="gradient"?"bg-white font-semibold shadow-sm":"text-slate-500"}`}>Gradient</button></div></div>{styleDraft.header.background.type==="solid"?<ColorControl label="Background color" value={styleDraft.header.background.color} onChange={(color)=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"solid",color}}}))}/>:<><ColorControl label="Gradient from" value={styleDraft.header.background.from} onChange={(from)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,from}}}:value)}/><ColorControl label="Gradient to" value={styleDraft.header.background.to} onChange={(to)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,to}}}:value)}/><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Gradient direction<select value={styleDraft.header.background.direction} onChange={(event)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,direction:event.target.value as "right"|"down"|"downRight"}}}:value)} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="right">Right</option><option value="down">Down</option><option value="downRight">Down right</option></select></label></>}<ColorControl label="Text color" value={styleDraft.header.text.color} onChange={(color)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,color}}}))}/><label className="grid gap-1.5 text-[11px] font-bold text-slate-500">Font family<select value={styleDraft.header.text.fontFamily} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontFamily:event.target.value as WorkspaceStyle["header"]["text"]["fontFamily"]}}}))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option>Inter</option><option>System</option><option>Serif</option><option>Monospace</option></select></label><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Font size<div className="flex h-9 items-center gap-3"><input type="range" min={12} max={32} value={styleDraft.header.text.fontSize} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontSize:Number(event.target.value)}}}))} className="min-w-0 flex-1 accent-[#2f65cf]"/><output className="w-12 text-right text-xs font-normal text-slate-600">{styleDraft.header.text.fontSize} px</output></div></label><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Font weight<select value={styleDraft.header.text.fontWeight} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontWeight:Number(event.target.value) as 400|500|600|700}}}))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label></fieldset>:<dl className="grid content-start gap-3 p-[18px] text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">Workspace name</dt><dd className="truncate">{workspace.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Status</dt><dd>{statusLabel[runtime]}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Workspace ID</dt><dd className="max-w-[220px] truncate">{workspace.workspaceId}</dd></div></dl>}</div><footer className="flex items-center gap-2 border-t px-5 py-3">{workspace.role==="owner"?<><button type="button" onClick={()=>setStyleDraft(defaultWorkspaceStyle())} className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs"><FiRefreshCw/>Reset style</button><span className="flex-1"/><button type="button" onClick={()=>{setStyleDraft(workspace.style);setSettingsOpen(false);}} className="h-9 rounded-md border px-4 text-xs">Cancel</button><button type="button" onClick={()=>void saveStyle()} disabled={!isValidStyle(styleDraft)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white disabled:opacity-40">Save</button></>:<><span className="flex-1"/><button type="button" onClick={()=>setSettingsOpen(false)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white">Close</button></>}</footer></div></div> : null}
  </main>;
}

type WorkspaceCardOperation = "crop" | "resize" | "adjust" | "compress" | "convert" | "review";

function WorkspaceGalleryCard({image,role,selected,onlinePeers,onSelect,onPin,onMoveToLibrary,onShare,onRequestSource,onDownload,onOperation}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];selected:boolean;onlinePeers:number;onSelect():void;onPin():void;onMoveToLibrary():void;onShare():void;onRequestSource():void;onDownload():void;onOperation(operation:WorkspaceCardOperation):void}) {
  const [menuOpen,setMenuOpen]=React.useState(false);
  const hasSource=Boolean(image.sourceCached);
  return <article className={`relative min-w-0 rounded-md border bg-white transition ${selected?"border-[#2f65cf] shadow-[0_0_0_2px_#2f65cf]":"border-slate-200 hover:border-slate-300"}`}>
    <div className="relative aspect-[5/3] overflow-hidden rounded-t-[5px] bg-slate-100" onClick={onSelect}>
      <WorkspaceImageMedia image={image} role={role} controls/>
      <button type="button" onClick={(event)=>{event.stopPropagation();onPin();}} className="absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title={image.pinnedAt?"Unpin image":"Pin image"} aria-pressed={Boolean(image.pinnedAt)}>{image.pinnedAt?<TbPinnedFilled className="h-3.5 w-3.5"/>:<TbPinned className="h-3.5 w-3.5"/>}</button>
      {role==="owner"?<button type="button" onClick={(event)=>{event.stopPropagation();onMoveToLibrary();}} className="absolute right-20 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-600" title="Return to Origin"><FiTrash2 className="h-3.5 w-3.5"/></button>:null}
      {hasSource?<button type="button" onClick={(event)=>{event.stopPropagation();onOperation("review");}} className="absolute right-11 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title="Review and annotate"><FiEye className="h-3.5 w-3.5"/></button>:null}
      {hasSource?<button type="button" onClick={(event)=>{event.stopPropagation();setMenuOpen((value)=>!value);}} className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title="Image actions" aria-expanded={menuOpen}><FiMoreHorizontal className="h-4 w-4"/></button>:null}
      {menuOpen?<><button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="Close image actions" onClick={(event)=>{event.stopPropagation();setMenuOpen(false);}}/><div className="absolute right-2 top-10 z-30 grid min-w-36 gap-0.5 rounded-md border bg-white p-1 shadow-xl" role="menu" onClick={(event)=>event.stopPropagation()}>{([['convert','Convert',<FiRefreshCw key="convert"/>],['compress','Compress',<FiMinimize2 key="compress"/>],['crop','Crop',<FiCrop key="crop"/>],['resize','Resize',<FiMaximize2 key="resize"/>],['adjust','Adjust',<FiSliders key="adjust"/>]] as Array<[WorkspaceCardOperation,string,React.ReactNode]>).map(([operation,label,icon])=><button type="button" role="menuitem" key={operation} onClick={()=>{setMenuOpen(false);onOperation(operation);}} className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-[#2f65cf]"><span>{icon}</span><span>{label}</span></button>)}</div></>:null}
    </div>
    <button type="button" onClick={onSelect} className="block w-full px-3 pt-3 text-left"><div className="flex min-w-0 items-center justify-between gap-2"><strong className="truncate text-sm font-semibold text-slate-800">{image.name}</strong>{image.shared?<span className="inline-flex h-5 shrink-0 items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-bold capitalize text-emerald-700">{image.state}</span>:null}</div></button>
    <div className="flex min-h-12 items-center justify-between gap-2 px-3 pb-3 pt-1 text-xs text-slate-500"><span className="min-w-0"><span className="block">{bytes(image.size)}</span><span className="block text-[10px] text-slate-400">{image.width} × {image.height}</span></span><span className="flex shrink-0 items-center gap-1.5">{role==="owner"?<button type="button" onClick={onShare} className={`flex h-7 w-7 items-center justify-center rounded-md ${image.shared?"border border-emerald-200 bg-emerald-50 text-emerald-700":"bg-[#2f65cf] text-white hover:bg-[#2457bd]"}`} title={image.shared?"Stop sharing":"Share for collaboration"}><FiSend className="h-3.5 w-3.5"/></button>:!hasSource?<button type="button" onClick={onRequestSource} disabled={!onlinePeers} className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-40" title="Request source data"><FiBookmark className="h-3.5 w-3.5"/></button>:null}{hasSource?<button type="button" onClick={onDownload} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" title="Download"><FiDownload className="h-3.5 w-3.5"/></button>:<button type="button" disabled className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-300" title="Source data unavailable"><FiDownload className="h-3.5 w-3.5"/></button>}</span></div>
  </article>;
}

function WorkspaceLibraryItem({image,role,selected,onSelect,onAdd,onDelete}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];selected:boolean;onSelect():void;onAdd():void;onDelete():void}) {
  return <article className={`mb-2 grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-white p-1.5 ${selected?"border-[#2f65cf] shadow-[0_0_0_1px_#2f65cf]":"border-slate-200"}`}><button type="button" onClick={onSelect} className="contents text-left"><span className="block h-11 w-[52px] overflow-hidden rounded bg-slate-100"><WorkspaceImageMedia image={image} role={role}/></span><span className="min-w-0 text-left"><strong className="block truncate text-[11px] font-semibold text-slate-700">{image.name}</strong><span className="mt-0.5 block text-[10px] text-slate-400">{bytes(image.size)}</span></span></button><span className="flex flex-col gap-1"><button type="button" onClick={onAdd} className="flex h-7 w-7 items-center justify-center rounded text-[#2f65cf] hover:bg-blue-50" title="Add to Working"><FiArrowRight className="h-3.5 w-3.5"/></button><button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete image"><FiTrash2 className="h-3.5 w-3.5"/></button></span></article>;
}

function WorkspaceAction({icon,label,disabled,onClick}:{icon:React.ReactNode;label:string;disabled:boolean;onClick():void}) {
  return <button type="button" onClick={onClick} disabled={disabled} title={label} className="flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-[#dfe3e8] bg-white text-[10px] text-[#526078] hover:border-[#9bb8ec] hover:bg-[#f2f6fd] hover:text-[#2457bd] disabled:cursor-not-allowed disabled:opacity-35"><span className="text-[15px]">{icon}</span><span>{label}</span></button>;
}

function ColorControl({label,value,onChange}:{label:string;value:string;onChange(value:string):void}) {
  return <label className="grid gap-1.5 text-[11px] font-bold text-slate-500"><span>{label}</span><span className="flex h-9 items-center gap-2 rounded-md border bg-white px-2"><input type="color" value={value} onChange={(event)=>onChange(event.target.value)} aria-label={label} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"/><code className="text-[11px] font-normal uppercase text-slate-600">{value}</code></span></label>;
}

function WorkspaceImageMedia({image,role,fit="cover",controls=false}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];fit?:"cover"|"contain";controls?:boolean}) {
  const [showPreview,setShowPreview]=React.useState(false);
  const [preview,setPreview]=React.useState<Blob>();
  React.useEffect(()=>{let active=true;setPreview(undefined);void (async()=>{let value=image.previewCached?await readWorkspaceImagePreview(image):null;if(!value&&image.sourceCached){const source=await readWorkspaceImageSource(image);if(source){const thumbnail=await generateShareThumbnail(source,320,240);value=new Blob([thumbnail.slice().buffer as ArrayBuffer],{type:"image/webp"});await saveWorkspaceImage({...image,preview:value,previewCached:true});}}if(active&&value)setPreview(value);})();return()=>{active=false;};},[image.imageId,image.previewCached,image.previewRevision,image.sourceCached]);
  const previewUrl=useBlobUrl(preview);
  React.useEffect(()=>setShowPreview(false),[image.imageId,image.previewRevision,preview]);
  const stopPreview=React.useCallback(()=>setShowPreview(false),[]);
  return <div className="relative h-full w-full overflow-hidden" style={{background:image.placeholder?.dominantColor}}>
    {role==="owner"&&previewUrl?<img src={previewUrl} alt={image.name} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:image.placeholder?<RoomImageMedia alt={image.name} placeholder={image.placeholder}/>:previewUrl?<img src={previewUrl} alt={image.name} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:<div className="flex h-full items-center justify-center text-slate-400"><FiImage className="h-8 w-8"/></div>}
    {role!=="owner"&&showPreview&&previewUrl?<img src={previewUrl} alt="" className={`pointer-events-none absolute inset-0 z-[5] h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`} aria-hidden="true"/>:null}
    {role!=="owner"&&controls&&previewUrl?<button type="button" className="absolute bottom-2 left-2 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]" aria-label="Hold to preview" title="Hold to preview" onClick={(event)=>event.stopPropagation()} onContextMenu={(event)=>event.preventDefault()} onPointerDown={(event)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);setShowPreview(true);}} onPointerUp={(event)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);stopPreview();}} onPointerCancel={stopPreview} onKeyDown={(event)=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();setShowPreview(true);}}} onKeyUp={(event)=>{if(event.key===" "||event.key==="Enter")stopPreview();}} onBlur={stopPreview}><FiImage className="h-3.5 w-3.5" aria-hidden="true"/></button>:null}
  </div>;
}

function useBlobUrl(blob?:Blob){const[url,setUrl]=React.useState("");React.useEffect(()=>{if(!blob){setUrl("");return;}const next=URL.createObjectURL(blob);setUrl(next);return()=>URL.revokeObjectURL(next);},[blob]);return url;}

function BlobImageMedia({blob,alt}:{blob:Blob;alt:string}){const url=useBlobUrl(blob);return url?<img src={url} alt={alt} className="h-full w-full object-cover"/>:null;}
