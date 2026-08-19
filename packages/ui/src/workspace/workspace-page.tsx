"use client";

import React from "react";
import {
  FiCheck, FiCopy, FiDownload, FiEye, FiImage, FiLink, FiMessageCircle,
  FiRefreshCw, FiSettings, FiShare2, FiTrash2, FiUploadCloud, FiUsers, FiX,
} from "react-icons/fi";
import { createWorkspaceShare, joinWorkspace, rotateWorkspaceShare, shareUrl } from "./api";
import {
  deleteWorkspaceImage, listActivities, listCommits, listProposals, listWorkspaceImages,
  promoteLocalWorkspace, purgeExpiredCache, restoreLocalWorkspace, saveActivity, saveCommit, saveProposal,
  saveWorkspace, saveWorkspaceImage,
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
import type { ProcessedImageResult } from "../components/share/workspace/image-result-dialog";
import { adjustRoomImage, cropRoomImage, resizeRoomImage, type RoomColorAdjustments } from "../utils/room-image-editing";
import { convertRoomImageTask, type RoomConversionFormat } from "../utils/room-image-conversion";
import { compressRoomImageTask } from "../utils/room-image-compression-task";
import ReviewWorkspace from "../components/share/workspace/review-workspace";
import RoomImageMedia from "../components/share/room-image-media";
import type { ReviewCollaborationMessage } from "../utils/review-collaboration";

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
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [runtime, transitionRuntime] = React.useReducer(workspaceRuntimeReducer, shareToken ? "connecting" : "local");
  const [collaborators, setCollaborators] = React.useState<Collaborator[]>([]);
  const [activities, setActivities] = React.useState<WorkspaceActivity[]>([]);
  const [proposals, setProposals] = React.useState<WorkspaceProposal[]>([]);
  const [commits, setCommits] = React.useState<WorkspaceCommit[]>([]);
  const [messages, setMessages] = React.useState<Array<{ id: string; text: string; actor: string }>>([]);
  const [message, setMessage] = React.useState("");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [collaborationOpen, setCollaborationOpen] = React.useState(false);
  const [styleDraft, setStyleDraft] = React.useState<WorkspaceStyle>(defaultWorkspaceStyle());
  const [copied, setCopied] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<"crop" | "resize" | "adjust" | "compress" | "convert" | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewFullscreen, setReviewFullscreen] = React.useState(false);
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
  const onlinePeers = collaborators.filter((value) => value.online).length;

  const persistActivity = React.useCallback(async (workspaceId: string, kind: string, imageId?: string, detail?: unknown, actorId = "local") => {
    const value: WorkspaceActivity = { eventId: id("activity"), sequence: Date.now(), actorId, kind, imageId, detail, createdAt: Date.now() };
    setActivities((current) => [...current.slice(-49), value]); await saveActivity(workspaceId, value);
  }, []);

  const updateImage = React.useCallback(async (imageId: string, patch: Partial<WorkspaceImage>) => {
    let updated: WorkspaceImage | undefined;
    setImages((current) => current.map((image) => image.imageId === imageId ? (updated = { ...image, ...patch, updatedAt: Date.now() }) : image));
    if (updated) await saveWorkspaceImage(updated);
  }, []);

  const handleRealtimeEvent = React.useCallback((value: WorkspaceEvent | Record<string, unknown>) => {
    const type = String(value.type || "");
    if (workspace && !isInboundEventAllowed(workspace.role, type, value.senderRole)) return;
    if(workspace&&["placeholderUpsert","previewRemove","sourceRequest","sourceRejected","proposalSubmit","proposalDecision","commitCreated","styleUpdated","reaction","message"].includes(type))void persistActivity(workspace.workspaceId,type,typeof value.imageId==="string"?value.imageId:undefined,{senderName:value.senderName,reason:value.reason},typeof value.senderId==="string"?value.senderId:"remote");
    if (type === "syncRequired") { transitionRuntime({type:"transition",next:"syncing"}); realtimeRef.current?.send("stateRequest", {}, { route: "owner", delivery: "reliable" }); }
    else if (type === "deliveryFailed" && value.eventType === "proposalSubmit" && typeof value.eventId === "string") { const proposalId=pendingProposalEvents.current.get(value.eventId);if(proposalId){pendingProposalEvents.current.delete(value.eventId);setProposals((current)=>current.map((proposal)=>proposal.proposalId===proposalId?{...proposal,state:"failed"}:proposal));void listProposals(workspace?.workspaceId||"").then((stored)=>{const proposal=stored.find((item)=>item.proposalId===proposalId);if(proposal)void saveProposal({...proposal,state:"failed"});});} }
    else if (type === "connected") { transitionRuntime({type:"transition",next:"connected"}); const members = Array.isArray(value.members) ? value.members as Array<Record<string, unknown>> : []; setCollaborators(members.map((member) => ({ clientId: String(member.userId), displayName: String(member.userName || member.role || "Guest"), online: true }))); if(workspace?.role==="owner")transitionRuntime({type:"transition",next:"available"});else{transitionRuntime({type:"transition",next:value.ownerOnline === false ? "ownerOffline" : "syncing"});realtimeRef.current?.send("stateRequest", {}, { route: "owner", delivery: "reliable" });} }
    else if (type === "memberJoined") setCollaborators((current) => [...current.filter((item) => item.clientId !== value.userId), { clientId: String(value.userId), displayName: String(value.userName || "Guest"), online: true }]);
    else if (type === "memberLeft") setCollaborators((current) => current.map((item) => item.clientId === value.userId ? { ...item, online: false } : item));
    else if (type === "presence" && typeof value.senderId === "string") setCollaborators((current)=>current.map((item)=>item.clientId===value.senderId?{...item,online:true,currentAction:typeof value.action==="string"?value.action:undefined,currentImageId:typeof value.imageId==="string"?value.imageId:undefined}:item));
    else if (type === "ownerPresence") transitionRuntime({type:"transition",next:value.online ? "syncing" : "ownerOffline"});
    else if (type === "stateRequest" && workspace?.role === "owner") {
      realtimeRef.current?.send("stateSnapshot", { images: images.filter((image) => image.shared).map(({ source: _source, preview: _preview, ...image }) => image), style: workspace.style }, { delivery: "reliable" });
      images.filter((image) => image.shared).forEach((image) => {
        if (image.placeholder) realtimeRef.current?.send("placeholderUpsert", { imageId: image.imageId, imageName: image.name, mimeType: image.mimeType, size: image.size, width: image.width, height: image.height, placeholder: image.placeholder, revision: image.previewRevision, currentCommitId: image.currentCommitId }, { delivery: "reliable", dataClass: "preview" });
        if (image.preview) void image.preview.arrayBuffer().then((buffer) => realtimeRef.current?.sendBinary("previewUpsert", { image: { imageId: image.imageId, mimeType: image.preview?.type || "image/webp", version: image.previewRevision } }, buffer, { delivery: "bulk", dataClass: "preview" }));
      });
    } else if (type === "stateSnapshot") {
      transitionRuntime({type:"transition",next:"available"});
      if (value.style && isValidStyle(value.style as WorkspaceStyle)) {
        setStyleDraft(value.style as WorkspaceStyle);
        setWorkspace((current) => current ? { ...current, style: value.style as WorkspaceStyle } : current);
      }
      if (Array.isArray(value.images)) {
        setImages((current) => {
          const incomingImages = (value.images as WorkspaceImage[])
            .filter((image) => image.shared ?? image.state !== "private");
          const incomingIds = new Set(incomingImages.map((image) => image.imageId));
          const byId = new Map(current.map((image) => [image.imageId, incomingIds.has(image.imageId)
            ? image
            : { ...image, shared: false, state: "private" as const, preview: undefined }]));
          for (const incoming of incomingImages) {
            const cached = byId.get(incoming.imageId);
            byId.set(incoming.imageId, { ...incoming, ...cached, shared: true, state: incoming.state,
              currentCommitId: incoming.currentCommitId, previewRevision: Math.max(
                incoming.previewRevision || 0, cached?.previewRevision || 0,
              ) });
          }
          const next = [...byId.values()];
          next.forEach((image) => void saveWorkspaceImage(image));
          return next;
        });
      }
    }
    else if (type === "placeholderUpsert") {
      const imageId=String(value.imageId),revision=Number(value.revision||1);
      setImages((current) => {
        const existing=current.find((image)=>image.imageId===imageId);
        if(existing&&revision<existing.previewRevision)return current;
        const incoming:WorkspaceImage={imageId,workspaceId:workspace?.workspaceId||"",name:String(value.imageName||existing?.name||"Shared image"),mimeType:String(value.mimeType||existing?.mimeType||"image/*"),size:Number(value.size||existing?.size||0),width:Number(value.width||existing?.width||0),height:Number(value.height||existing?.height||0),state:existing?.state||"shared",shared:true,currentCommitId:typeof value.currentCommitId==="string"?value.currentCommitId:existing?.currentCommitId||null,previewRevision:revision,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now(),source:existing?.source,preview:existing?.preview,placeholder:value.placeholder as WorkspaceImage["placeholder"]};
        void saveWorkspaceImage(incoming);
        return existing?current.map((image)=>image.imageId===imageId?incoming:image):[...current,incoming];
      });
    }
    else if (type === "previewUpsert") {
      const data=value.image as Record<string,unknown>|undefined;
      if(data){const imageId=String(data.imageId),revision=Number(data.version||1),preview=blobFromBytes(data.bytes??value.bytes,String(data.mimeType||"image/webp"));if(preview)setImages((current)=>current.map((image)=>{if(image.imageId!==imageId||revision<image.previewRevision)return image;const next={...image,preview,shared:true,previewRevision:revision,updatedAt:Date.now()};void saveWorkspaceImage(next);return next;}));}
    }
    else if (type === "previewRemove") { void updateImage(String(value.imageId), { preview: undefined, shared: false, state: "private" }); }
    else if (type === "sourceRequest" && workspace?.role === "owner") setSourceRequestDialog(value);
    else if (type === "sourceStart" || type === "sourceChunk" || type === "sourceComplete") void receiveSource(value);
    else if (type === "sourceRejected") setNotice(typeof value.reason === "string" ? value.reason : "Source request was rejected");
    else if (type === "proposalSubmit" && workspace?.role === "owner" && value.proposal && typeof value.senderId === "string") { const incoming=value.proposal as WorkspaceProposal,senderId=value.senderId,image=images.find((item)=>item.imageId===incoming.imageId); if (!validateProposal(incoming,workspace.workspaceId,image)) return; const proposal={...incoming,state:image!.currentCommitId&&image!.currentCommitId!==incoming.baseCommitId?"conflict" as const:"pending" as const,authorId:senderId,operations:incoming.operations.map((operation)=>({...operation,authorId:senderId}))}; setProposals((current)=>current.some((p)=>p.proposalId===proposal.proposalId)?current:[...current,proposal]); void saveProposal(proposal); void updateImage(proposal.imageId,{state:"reviewing"}); }
    else if (type === "proposalDecision") { const proposalId=String(value.proposalId); setProposals((current)=>current.map((proposal)=>{if(proposal.proposalId!==proposalId)return proposal;const next={...proposal,state:String(value.state) as WorkspaceProposal["state"],rejectReason:typeof value.reason==="string"?value.reason:undefined};void saveProposal(next);return next;})); }
    else if (type === "commitCreated" && value.commit) { const commit=value.commit as WorkspaceCommit; setCommits((current)=>[...current.filter((item)=>item.commitId!==commit.commitId),commit]); if(workspace?.role==="collaborator")setNewVersions((current)=>({...current,[commit.imageId]:commit.commitId})); void saveCommit(commit); }
    else if (type === "styleUpdated" && value.style && isValidStyle(value.style as WorkspaceStyle)) { const style=value.style as WorkspaceStyle; setWorkspace((current)=>{if(!current||style.revision<=current.style.revision)return current;const next={...current,name:style.header.text.content,style};setStyleDraft(style);void saveWorkspace(next);return next;}); }
    else if (type === "reaction") showReaction(String(value.emoji||"👍"));
    else if (type === "message") setMessages((current)=>[...current,{id:String(value.eventId||id("message")),text:String(value.text||""),actor:String(value.senderName||"Guest")}]);
    else if (type === "reviewMessage" && value.message) reviewListeners.current.forEach((listener)=>listener({sequence:Number(value.sequence||0),message:value.message as ReviewCollaborationMessage}));
  }, [images, persistActivity, updateImage, workspace]);
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
      await updateImage(completed.imageId, {
        source: completed.source,
        size: completed.source.size,
        currentCommitId: completed.currentCommitId ?? undefined,
        state: "working",
      });
      setNewVersions((current) => {
        const next = { ...current };
        delete next[completed.imageId];
        return next;
      });
    }
  }

  async function acceptSourceRequest(value: Record<string, unknown>) {
    const image=images.find((item)=>item.imageId===value.imageId);
    if(!image?.source||!image.shared){setSourceRequestDialog(null);return;}
    const data=new Uint8Array(await image.source.arrayBuffer()),chunkSize=48*1024;
    const total=Math.ceil(data.length/chunkSize),sha256=await digest(image.source),targetUserId=String(value.senderId);
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
  React.useEffect(() => { if(selectedId)void listCommits(selectedId).then((values)=>setCommits((current)=>[...current.filter((item)=>item.imageId!==selectedId),...values])); }, [selectedId]);

  async function addFiles(files: FileList | File[]) { if(!workspace||workspace.role!=="owner")return;for(const file of Array.from(files)){if(!file.type.startsWith("image/"))continue;const size=await dimensions(file),imageId=id("image"),initialCommitId=`initial_${imageId}`;const image:WorkspaceImage={imageId,workspaceId:workspace.workspaceId,name:file.name,mimeType:file.type,size:file.size,...size,state:"private",shared:false,currentCommitId:initialCommitId,previewRevision:0,createdAt:Date.now(),updatedAt:Date.now(),source:file};const initial:WorkspaceCommit={commitId:initialCommitId,imageId,authorId:"owner",parentCommitId:null,mergeParentCommitIds:[],operations:[],snapshot:file,snapshotName:file.name,snapshotMimeType:file.type,snapshotWidth:size.width,snapshotHeight:size.height,createdAt:Date.now()};await Promise.all([saveWorkspaceImage(image),saveCommit(initial)]);setImages((current)=>[...current,image]);setCommits((current)=>[...current,initial]);await persistActivity(workspace.workspaceId,"imageAdded",image.imageId);} }
  async function publishPreview(image: WorkspaceImage, source: Blob) {
    const revision = image.previewRevision + 1;
    const [placeholder, thumbnail] = await Promise.all([
      generateSharePlaceholder(source),
      generateShareThumbnail(source, 640, 480),
    ]);
    const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
    await updateImage(image.imageId, { placeholder, preview, previewRevision: revision });
    realtimeRef.current?.send("placeholderUpsert", {
      imageId: image.imageId, imageName: image.name, mimeType: image.mimeType, size: image.size,
      width: image.width, height: image.height, placeholder, revision,
      currentCommitId: image.currentCommitId,
    }, { delivery: "reliable", dataClass: "preview" });
    realtimeRef.current?.sendBinary("previewUpsert", { image: {
      imageId: image.imageId, imageName: image.name, mimeType: "image/webp",
      sourceMimeType: image.mimeType, width: image.width, height: image.height,
      placeholder, version: revision, currentCommitId: image.currentCommitId,
    } }, thumbnail.slice().buffer as ArrayBuffer, { delivery: "bulk", dataClass: "preview" });
  }

  async function publishImage(image: WorkspaceImage) {
    if (!workspace || !image.source) return;
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
    await publishPreview(next, image.source);
    await persistActivity(workspace.workspaceId, "imageShared", image.imageId);
  }
  async function createShare(){if(!workspace)return;const created=await createWorkspaceShare(workspace.name);const previousId=workspace.workspaceId;const next={...workspace,workspaceId:created.workspace.id,shareToken:created.workspace.shareId,ownerCapability:created.ownerCapability,updatedAt:Date.now()};await promoteLocalWorkspace(previousId,next);setWorkspace(next);setImages((current)=>current.map((image)=>({...image,workspaceId:next.workspaceId})));const realtime=new WorkspaceRealtimeClient(next);realtimeRef.current?.disconnect();realtimeRef.current=realtime;realtime.subscribe((value)=>realtimeEventRef.current(value));transitionRuntime({type:"transition",next:"connecting"});await realtime.connect();}
  async function rotateShare(){if(!workspace)return;const result=await rotateWorkspaceShare(workspace);const next={...workspace,shareToken:result.workspace.shareId,updatedAt:Date.now()};await saveWorkspace(next);setWorkspace(next);setNotice("A new link was created. The previous link is no longer valid.");}
  async function copyShare(){if(!workspace?.shareToken)return;await navigator.clipboard.writeText(shareUrl(workspace.shareToken));setCopied(true);window.setTimeout(()=>setCopied(false),1500);}
  function showReaction(emoji:string){const node=document.createElement("div");node.textContent=emoji;node.className="pointer-events-none fixed left-1/2 top-1/2 z-[100] text-5xl workspace-reaction-float";document.body.append(node);reactionNodes.current.add(node);const timer=window.setTimeout(()=>{node.remove();reactionNodes.current.delete(node);reactionTimers.current.delete(timer);},1400);reactionTimers.current.add(timer);}
  function react(emoji:string){if(!onlinePeers)return;showReaction(emoji);realtimeRef.current?.send("reaction",{emoji},{delivery:"ephemeral",dataClass:"presence"});if(workspace)void persistActivity(workspace.workspaceId,"reaction",selected?.imageId,{emoji});}
  function sendMessage(){const text=message.trim();if(!text||!onlinePeers)return;setMessages((current)=>[...current,{id:id("message"),text,actor:"You"}]);realtimeRef.current?.send("message",{text},{delivery:"ephemeral"});if(workspace)void persistActivity(workspace.workspaceId,"message",selected?.imageId);setMessage("");}
  function requestSource(){if(!selected||!selected.shared||runtime!=="available")return;realtimeRef.current?.send("sourceRequest",{requestId:id("source"),imageId:selected.imageId},{route:"owner",delivery:"reliable",dataClass:"collaborationEvent"});}
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
    const latestSource = latest.source;
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
  async function rotateSelected(){if(!workspace||!selected?.source)return;const result=await rotateImage(selected.source,selected.name,90);if(workspace.role==="collaborator")await updateImage(selected.imageId,{preview:result.blob,width:result.width,height:result.height,state:"working"});await createOperation("rotate",{degrees:90},result);}

  const previewUrl=React.useMemo(()=>selected&&(selected.source||selected.preview)?URL.createObjectURL(selected.source||selected.preview!):null,[selected]);
  React.useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
  const editorImage = React.useMemo<RoomImage | null>(() => workspace && selected?.source && previewUrl ? {
    id: selected.imageId, roomId: workspace.workspaceId, name: selected.name, type: selected.mimeType,
    size: selected.size, blob: selected.source, direction: workspace.role === "owner" ? "sent" : "received",
    rootImageId: selected.imageId, parentImageId: null, ownerId: workspace.role === "owner" ? "owner" : "remote",
    width: selected.width, height: selected.height, source: workspace.role === "owner" ? "local" : "received",
    operation: "original", version: 1, createdAt: selected.createdAt, updatedAt: selected.updatedAt,
    url: previewUrl,
  } : null, [previewUrl, selected, workspace]);
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
  }
  if(!workspace&&runtime==="unavailable")return <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center"><FiX className="mb-3 h-8 w-8 text-red-500"/><h1 className="text-lg font-semibold text-slate-900">Workspace unavailable</h1><p className="mt-2 max-w-md text-sm text-slate-600">{notice||"The share link is invalid or no longer active."}</p><a href="/workspace" className="mt-5 rounded-md bg-[#2f65cf] px-4 py-2 text-sm text-white">Open my workspace</a></main>;
  if(!workspace)return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><FiRefreshCw className="mr-2 animate-spin"/>Loading workspace</main>;
  if(reviewOpen&&editorImage)return <ReviewWorkspace roomId={workspace.workspaceId} image={editorImage} labels={labels} actorId={workspace.role} role={workspace.role==="owner"?"owner":"guest"} fullscreen={reviewFullscreen} shareRecipients={[]} subscribeMessages={(listener)=>{reviewListeners.current.add(listener);return()=>reviewListeners.current.delete(listener);}} onSendMessage={(message)=>{realtimeRef.current?.send("reviewMessage",{message},{delivery:"reliable"});return true;}} onReviewStatusChange={(_imageId,status)=>{void updateImage(selected!.imageId,{state:status==="in-review"?"reviewing":status==="approved"?"committed":selected!.state});}} onReviewEditingChange={()=>undefined} onFullscreenChange={setReviewFullscreen} onGenerateImage={async(_source,result)=>{const processed={blob:result.blob,name:result.name,mimeType:result.blob.type||selected!.mimeType,width:result.width,height:result.height};await updateImage(selected!.imageId,{source:workspace.role==="owner"?result.blob:selected!.source,preview:result.blob,name:result.name,mimeType:processed.mimeType,size:result.blob.size,width:result.width,height:result.height});await createOperation("other",{review:true},processed);return{status:"saved",imageId:selected!.imageId};}} onResolveRejectedImage={async()=>undefined} onBack={()=>setReviewOpen(false)}/>;
  return <main className="flex h-screen min-h-0 flex-col bg-[#f4f6f8] text-slate-900">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4 sm:px-6" style={headerBackground(workspace.style)}>
      <div className="min-w-0"><div className="truncate text-lg" style={{fontFamily:workspace.style.header.text.fontFamily,fontSize:workspace.style.header.text.fontSize,fontWeight:workspace.style.header.text.fontWeight}}>{workspace.name}</div><div className="text-xs opacity-70">{statusLabel[runtime]} · {images.length} images · {images.filter((image)=>image.shared).length} shared</div></div>
      <div className="flex items-center gap-1">
        <button className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5" onClick={()=>setCollaborationOpen((value)=>!value)} title="Collaboration"><FiUsers/>{onlinePeers?<span className="absolute right-0 top-0 min-w-4 rounded-full bg-emerald-500 px-1 text-center text-[10px] text-white">{onlinePeers}</span>:null}</button>
        {workspace.shareToken?<button className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5" onClick={()=>void copyShare()} title="Copy share link">{copied?<FiCheck/>:<FiCopy/>}</button>:null}
        <button className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-black/5" onClick={()=>setSettingsOpen(true)} title="Workspace settings"><FiSettings/></button>
      </div>
    </header>
    {notice?<div className="flex items-center justify-between bg-amber-50 px-4 py-2 text-sm text-amber-900"><span>{notice}</span><button onClick={()=>setNotice(null)}><FiX/></button></div>:null}
    {workspace.role==="collaborator"&&(runtime==="ownerOffline"||runtime==="unavailable")?<div className="bg-slate-800 px-4 py-2 text-sm text-white">{images.length?"Owner is offline. Showing cached workspace data.":"Owner is offline and no cached workspace data is available."}</div>:null}
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-h-0 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-semibold">Images</h1><p className="text-sm text-slate-500">{workspace.role==="owner"?"Private until you share them":"Shared by the workspace owner"}</p></div>{workspace.role==="owner"?<><button onClick={()=>inputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white hover:bg-[#2457bd]"><FiUploadCloud/>Add images</button><input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event)=>event.target.files&&void addFiles(event.target.files)}/></>:null}</div>
        {images.length?<div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">{images.map((image)=><WorkspaceGalleryCard key={image.imageId} image={image} role={workspace.role} selected={selectedId===image.imageId} onSelect={()=>setSelectedId(image.imageId)}/>)}</div>:<button onClick={()=>workspace.role==="owner"&&inputRef.current?.click()} className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 bg-white/60 text-slate-500"><FiUploadCloud className="mb-3 h-8 w-8"/><span>{workspace.role==="owner"?"Add your first image":"No shared images available"}</span></button>}
      </section>
      <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Selected image</h2>
        {selected ? <>
          <div className="mt-4 aspect-[4/3] overflow-hidden rounded-md bg-slate-100"><WorkspaceImageMedia image={selected} role={workspace.role} fit="contain"/></div>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm"><dt className="text-slate-500">Name</dt><dd className="truncate text-right">{selected.name}</dd><dt className="text-slate-500">Dimensions</dt><dd className="text-right">{selected.width} × {selected.height}</dd><dt className="text-slate-500">Format</dt><dd className="text-right">{selected.mimeType.replace("image/", "").toUpperCase()}</dd><dt className="text-slate-500">State</dt><dd className="text-right capitalize">{selected.state}</dd><dt className="text-slate-500">Commit</dt><dd className="truncate text-right">{selected.currentCommitId || "Initial"}</dd></dl>
          <h3 className="mt-6 text-sm font-semibold uppercase text-slate-500">Quick actions</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">{(["crop", "resize", "adjust", "compress", "convert"] as const).map((type) => <button key={type} onClick={() => setEditing(type)} disabled={!selected.source} className="h-9 rounded-md border border-slate-200 text-xs capitalize hover:bg-slate-50 disabled:opacity-40">{type}</button>)}<button onClick={() => void rotateSelected()} disabled={!selected.source} className="h-9 rounded-md border border-slate-200 text-xs capitalize hover:bg-slate-50 disabled:opacity-40">Rotate</button><button onClick={() => setReviewOpen(true)} disabled={!selected.source} className="h-9 rounded-md border border-slate-200 text-xs capitalize hover:bg-slate-50 disabled:opacity-40">Review</button></div>
          <div className="mt-3 flex gap-2">{workspace.role === "owner" ? <button onClick={() => void publishImage(selected)} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-3 text-sm text-white"><FiShare2/>{selected.shared ? "Unshare" : "Share image"}</button> : !selected.source ? <button onClick={requestSource} disabled={runtime !== "available"} className="h-9 flex-1 rounded-md bg-[#2f65cf] text-sm text-white disabled:opacity-40">Request source</button> : null}{selected.source ? <a href={previewUrl || undefined} download={selected.name} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200" title="Download"><FiDownload/></a> : null}{workspace.role === "owner" ? <button onClick={() => { void deleteWorkspaceImage(selected.imageId); setImages((current) => current.filter((item) => item.imageId !== selected.imageId)); }} className="flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-600" title="Delete"><FiTrash2/></button> : null}</div>
          {workspace.role==="collaborator"&&newVersions[selected.imageId]?<div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm"><div className="font-medium text-blue-900">A new version is available</div><div className="mt-2 flex flex-wrap gap-2"><button onClick={()=>selected.preview?setVersionPreview({imageName:selected.name,blob:selected.preview}):setNotice("The new Preview is still loading") } className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-blue-800">Review</button><button onClick={requestSource} disabled={runtime!=="available"} className="rounded-md bg-[#2f65cf] px-3 py-1.5 text-white disabled:opacity-40">Update</button><button onClick={()=>setNewVersions((current)=>{const next={...current};delete next[selected.imageId];return next;})} className="px-3 py-1.5 text-slate-600">Later</button></div></div>:null}
        </> : <p className="mt-4 text-sm text-slate-500">Select an image to inspect it.</p>}
        <div className="my-6 h-px bg-slate-200"/><h2 className="text-sm font-semibold uppercase text-slate-500">Workspace share</h2><div className="mt-3">{workspace.role!=="owner"?<p className="text-sm text-slate-500">Joined with a share link.</p>:workspace.shareToken?<div className="space-y-2"><button onClick={()=>void copyShare()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-sm"><FiCopy/>Copy share link</button><button onClick={()=>void rotateShare()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-sm"><FiRefreshCw/>Create new link</button></div>:<button onClick={()=>void createShare()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-sm"><FiLink/>Create share link</button>}</div>
        {proposals.length?<><div className="my-6 h-px bg-slate-200"/><h2 className="text-sm font-semibold uppercase text-slate-500">Proposals</h2><div className="mt-3 space-y-2">{proposals.slice().reverse().map((proposal)=><div key={proposal.proposalId} className="rounded-md border border-slate-200 p-3 text-sm"><div className="flex justify-between"><span>{proposal.operations.map((op)=>op.type).join(", ")}</span><span className="text-slate-500">{proposal.state}</span></div>{workspace.role==="owner"&&["submitted","pending","deferred","conflict"].includes(proposal.state)?<div className="mt-2 flex flex-wrap gap-1"><button onClick={()=>void previewProposal(proposal)} className="rounded border px-2 py-1">Preview</button><button onClick={()=>void decideProposal(proposal,"applied")} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Apply</button><button onClick={()=>{setRejectingProposal(proposal);setProposalRejectReason("");}} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button><button onClick={()=>void decideProposal(proposal,"deferred")} className="rounded bg-slate-100 px-2 py-1">Defer</button></div>:workspace.role==="collaborator"&&proposal.state==="failed"?<button onClick={()=>void submitProposal(proposal)} disabled={runtime!=="available"} className="mt-2 rounded border px-2 py-1 disabled:opacity-40">Retry</button>:null}</div>)}</div></>:null}
        {selected && commits.some((commit)=>commit.imageId===selected.imageId) ? <><div className="my-6 h-px bg-slate-200"/><h2 className="text-sm font-semibold uppercase text-slate-500">Version history</h2><div className="mt-3 space-y-2">{commits.filter((commit)=>commit.imageId===selected.imageId).slice().reverse().map((commit)=><div key={commit.commitId} className="flex items-center justify-between rounded-md border border-slate-200 p-2 text-xs"><div className="min-w-0"><div className="truncate font-medium">{commit.commitId===selected.currentCommitId?"Current version":commit.commitId.startsWith("initial_")?"Initial version":commit.operations.map((operation)=>operation.type).join(", ")||"Version"}</div><div className="text-slate-500">{new Date(commit.createdAt).toLocaleString()}</div></div>{workspace.role==="owner"&&commit.snapshot&&commit.commitId!==selected.currentCommitId?<button onClick={()=>void rollbackCommit(commit)} className="ml-2 rounded border px-2 py-1">Restore</button>:workspace.role==="collaborator"&&commit.commitId!==selected.currentCommitId?<button onClick={requestSource} disabled={runtime!=="available"} className="ml-2 rounded border px-2 py-1 disabled:opacity-40">Update</button>:null}</div>)}</div></>:null}
      </aside>
    </div>
    {collaborationOpen?<div className="absolute right-4 top-14 z-40 flex h-[min(620px,calc(100vh-80px))] w-[min(360px,calc(100vw-32px))] flex-col rounded-md border border-slate-200 bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><strong>Collaboration</strong><button onClick={()=>setCollaborationOpen(false)}><FiX/></button></div><div className="border-b p-4"><div className="mb-2 text-xs font-semibold uppercase text-slate-500">Collaborators</div>{collaborators.length?collaborators.map((person)=><div key={person.clientId} className="flex items-center gap-2 py-1.5 text-sm"><span className={`h-2 w-2 rounded-full ${person.online?"bg-emerald-500":"bg-slate-300"}`}/><span className="min-w-0 flex-1 truncate">{person.displayName}</span>{person.currentAction?<span className="text-xs text-slate-400">{person.currentAction}</span>:null}</div>):<p className="text-sm text-slate-500">No collaborators connected</p>}</div><div className="flex gap-2 border-b p-3">{["👍","❤️","👀","❗"].map((emoji)=><button key={emoji} disabled={!onlinePeers} onClick={()=>react(emoji)} className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 disabled:opacity-30">{emoji}</button>)}</div><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-2 text-xs font-semibold uppercase text-slate-500">Activity</div>{activities.slice(-10).reverse().map((item)=><div key={item.eventId} className="mb-2 text-xs text-slate-500"><span className="font-medium text-slate-700">{item.kind}</span>{item.imageId?` · ${item.imageId.slice(0,12)}`:""}</div>)}<div className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-500">Messages</div>{messages.map((item)=><div key={item.id} className="mb-3 text-sm"><span className="font-medium">{item.actor}</span><p className="text-slate-600">{item.text}</p></div>)}</div><div className="flex gap-2 border-t p-3"><input value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&sendMessage()} disabled={!onlinePeers} className="min-w-0 flex-1 rounded-md border px-3 text-sm" placeholder="Message"/><button onClick={sendMessage} disabled={!onlinePeers||!message.trim()} className="flex h-9 w-9 items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-30"><FiMessageCircle/></button></div></div>:null}
    <ImageCropDialog image={editing === "crop" ? editorImage : null} labels={labels} onClose={() => setEditing(null)} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageResizeDialog image={editing === "resize" ? editorImage : null} labels={labels} onClose={() => setEditing(null)} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageColorAdjustmentDialog image={editing === "adjust" ? editorImage : null} labels={labels} onClose={() => setEditing(null)} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageCompressionDialog image={editing === "compress" ? editorImage : null} labels={labels} onClose={() => setEditing(null)} onSave={(_source, result) => saveProcessedResult(result)}/>
    <ImageConversionDialog image={editing === "convert" ? editorImage : null} labels={labels} onClose={() => setEditing(null)} onSave={(_source, result) => saveProcessedResult(result)}/>
    {proposalPreview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setProposalPreview(null)}><div className="w-full max-w-3xl rounded-md bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Proposal preview</h2><p className="text-xs text-slate-500">{proposalPreview.proposalId}</p></div><button onClick={()=>setProposalPreview(null)} className="flex h-9 w-9 items-center justify-center"><FiX/></button></div><div className="aspect-video overflow-hidden rounded-md bg-slate-100"><BlobImageMedia blob={proposalPreview.blob} alt="Proposal preview"/></div></div></div> : null}
    {versionPreview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setVersionPreview(null)}><div className="w-full max-w-3xl rounded-md bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">New version preview</h2><p className="text-xs text-slate-500">{versionPreview.imageName}</p></div><button onClick={()=>setVersionPreview(null)} className="flex h-9 w-9 items-center justify-center"><FiX/></button></div><div className="aspect-video overflow-hidden rounded-md bg-slate-100"><BlobImageMedia blob={versionPreview.blob} alt={versionPreview.imageName}/></div></div></div>:null}
    {sourceRequestDialog ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Source data request</h2><p className="mt-2 text-sm text-slate-600">{String(sourceRequestDialog.requesterName||"Guest")} wants the original data for {images.find((image)=>image.imageId===sourceRequestDialog.imageId)?.name||"this image"}.</p><label className="mt-4 block text-sm">Reject reason (optional)<input value={sourceRejectReason} onChange={(event)=>setSourceRejectReason(event.target.value)} maxLength={240} className="mt-1 h-9 w-full rounded-md border px-3"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={()=>rejectSourceRequest(sourceRequestDialog)} className="h-9 rounded-md border border-red-200 px-4 text-sm text-red-700">Reject</button><button onClick={()=>void acceptSourceRequest(sourceRequestDialog)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm text-white">Accept</button></div></div></div>:null}
    {rejectingProposal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Reject proposal</h2><label className="mt-4 block text-sm">Reason<textarea value={proposalRejectReason} onChange={(event)=>setProposalRejectReason(event.target.value)} maxLength={500} rows={4} className="mt-1 w-full rounded-md border p-3"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setRejectingProposal(null)} className="h-9 rounded-md border px-4 text-sm">Cancel</button><button onClick={()=>{const proposal=rejectingProposal;setRejectingProposal(null);void decideProposal(proposal,"rejected",proposalRejectReason);}} className="h-9 rounded-md bg-red-600 px-4 text-sm text-white">Reject</button></div></div></div>:null}
    {settingsOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-white p-5 shadow-xl"><div className="flex justify-between"><h2 className="text-lg font-semibold">Workspace style</h2><button onClick={() => setSettingsOpen(false)}><FiX/></button></div>
      <fieldset disabled={workspace.role!=="owner"} className="mt-5 grid gap-4 disabled:opacity-70 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Title<input value={styleDraft.header.text.content} onChange={(event) => setStyleDraft((value) => ({...value, header: {...value.header, text: {...value.header.text, content: event.target.value}}}))} className="mt-1 h-9 w-full rounded-md border px-3"/></label>
        <label className="text-sm">Font family<select value={styleDraft.header.text.fontFamily} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontFamily:event.target.value as WorkspaceStyle["header"]["text"]["fontFamily"]}}}))} className="mt-1 h-9 w-full rounded-md border px-2"><option>Inter</option><option>System</option><option>Serif</option><option>Monospace</option></select></label>
        <label className="text-sm">Font weight<select value={styleDraft.header.text.fontWeight} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontWeight:Number(event.target.value) as 400|500|600|700}}}))} className="mt-1 h-9 w-full rounded-md border px-2"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>
        <label className="text-sm">Font size<input type="number" min={12} max={32} value={styleDraft.header.text.fontSize} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontSize:Number(event.target.value)}}}))} className="mt-1 h-9 w-full rounded-md border px-3"/></label>
        <label className="text-sm">Text color<input type="color" value={styleDraft.header.text.color} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,color:event.target.value}}}))} className="mt-1 h-9 w-full"/></label>
        <label className="text-sm">Background<select value={styleDraft.header.background.type} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,background:event.target.value==="solid"?{type:"solid",color:"#ffffff"}:{type:"gradient",from:"#ffffff",to:"#dbeafe",direction:"right"}}}))} className="mt-1 h-9 w-full rounded-md border px-2"><option value="solid">Solid</option><option value="gradient">Gradient</option></select></label>
        {styleDraft.header.background.type === "solid" ? <label className="text-sm">Background color<input type="color" value={styleDraft.header.background.color} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"solid",color:event.target.value}}}))} className="mt-1 h-9 w-full"/></label> : <><label className="text-sm">From<input type="color" value={styleDraft.header.background.from} onChange={(event)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,from:event.target.value}}}:value)} className="mt-1 h-9 w-full"/></label><label className="text-sm">To<input type="color" value={styleDraft.header.background.to} onChange={(event)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,to:event.target.value}}}:value)} className="mt-1 h-9 w-full"/></label><label className="text-sm">Direction<select value={styleDraft.header.background.direction} onChange={(event)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,direction:event.target.value as "right"|"down"|"downRight"}}}:value)} className="mt-1 h-9 w-full rounded-md border px-2"><option value="right">Right</option><option value="down">Down</option><option value="downRight">Diagonal</option></select></label></>}
      </fieldset>
      <div className="mt-5 rounded-md border border-slate-200 px-4 py-3" style={headerBackground(styleDraft)}><span style={{fontFamily:styleDraft.header.text.fontFamily,fontSize:styleDraft.header.text.fontSize,fontWeight:styleDraft.header.text.fontWeight}}>{styleDraft.header.text.content || "Workspace"}</span></div>
      <div className="mt-5 flex justify-end gap-2">{workspace.role==="owner"?<><button onClick={()=>setStyleDraft(workspace.style)} className="h-9 rounded-md border px-4 text-sm">Cancel changes</button><button onClick={()=>setStyleDraft(defaultWorkspaceStyle())} className="h-9 rounded-md border px-4 text-sm">Reset</button><button onClick={()=>void saveStyle()} disabled={!isValidStyle(styleDraft)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm text-white disabled:opacity-40">Save</button></>:<button onClick={()=>setSettingsOpen(false)} className="h-9 rounded-md border px-4 text-sm">Close</button>}</div>
    </div></div> : null}
  </main>;
}

function WorkspaceGalleryCard({image,role,selected,onSelect}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];selected:boolean;onSelect():void}) {
  return <article className={`overflow-hidden rounded-md border bg-white shadow-sm transition ${selected?"border-[#2f65cf] ring-2 ring-blue-100":"border-slate-200 hover:border-slate-300"}`}>
    <div className="aspect-[4/3] cursor-pointer bg-slate-100" onClick={onSelect}><WorkspaceImageMedia image={image} role={role}/></div>
    <button type="button" onClick={onSelect} className="block w-full p-3 text-left">
      <div className="truncate text-sm font-medium">{image.name}</div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500"><span>{image.state}</span><span>{bytes(image.size)}</span></div>
    </button>
  </article>;
}

function WorkspaceImageMedia({image,role,fit="cover"}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];fit?:"cover"|"contain"}) {
  const [showPreview,setShowPreview]=React.useState(false);
  const primary=role==="owner"?image.source||image.preview:image.source;
  const preview=!primary?image.preview:undefined;
  const primaryUrl=useBlobUrl(primary);
  const previewUrl=useBlobUrl(preview);
  React.useEffect(()=>setShowPreview(false),[image.imageId,image.previewRevision,preview]);
  const stopPreview=React.useCallback(()=>setShowPreview(false),[]);
  return <div className="relative h-full w-full overflow-hidden" style={{background:image.placeholder?.dominantColor}}>
    {primaryUrl?<img src={primaryUrl} alt={image.name} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:image.placeholder?<RoomImageMedia alt={image.name} placeholder={image.placeholder}/>:<div className="flex h-full items-center justify-center text-slate-400"><FiImage className="h-8 w-8"/></div>}
    {showPreview&&previewUrl?<img src={previewUrl} alt="" className={`pointer-events-none absolute inset-0 z-[5] h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`} aria-hidden="true"/>:null}
    {previewUrl?<button type="button" className="absolute bottom-2 left-2 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]" aria-label="Hold to preview" title="Hold to preview" onClick={(event)=>event.stopPropagation()} onContextMenu={(event)=>event.preventDefault()} onPointerDown={(event)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);setShowPreview(true);}} onPointerUp={(event)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);stopPreview();}} onPointerCancel={stopPreview} onKeyDown={(event)=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();setShowPreview(true);}}} onKeyUp={(event)=>{if(event.key===" "||event.key==="Enter")stopPreview();}} onBlur={stopPreview}><FiImage className="h-3.5 w-3.5" aria-hidden="true"/></button>:null}
  </div>;
}

function useBlobUrl(blob?:Blob){const[url,setUrl]=React.useState("");React.useEffect(()=>{if(!blob){setUrl("");return;}const next=URL.createObjectURL(blob);setUrl(next);return()=>URL.revokeObjectURL(next);},[blob]);return url;}

function BlobImageMedia({blob,alt}:{blob:Blob;alt:string}){const url=useBlobUrl(blob);return url?<img src={url} alt={alt} className="h-full w-full object-cover"/>:null;}
