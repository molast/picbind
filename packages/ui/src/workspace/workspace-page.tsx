"use client";

import React from "react";
import { createPortal } from "react-dom";
import {
  FiArrowLeft, FiArrowRight, FiCheck, FiChevronLeft, FiChevronRight, FiClock, FiCrop, FiDownload, FiLoader,
  FiBookmark, FiEye, FiHardDrive, FiHome, FiImage, FiLink, FiMaximize2, FiMessageCircle,
  FiMinimize2, FiMoreHorizontal, FiRefreshCw, FiSettings, FiShare2, FiShield, FiTerminal,
  FiSliders, FiTrash2, FiUploadCloud, FiUsers, FiX, FiZoomIn, FiZoomOut,
} from "react-icons/fi";
import { TbPinned, TbPinnedFilled } from "react-icons/tb";
import { createWorkspaceShare, joinWorkspace, rotateWorkspaceShare, shareUrl } from "./api";
import {
  clearOperationLogs, clearWorkspaceImageHistory, deleteCollaborationActivitiesAfter, deleteCommitsAfter, deleteWorkspaceImage, listActivities, listCommits, listOperationLogs,
  listProposals, listWorkspaceImages, promoteLocalWorkspace, purgeExpiredCache, restoreLocalWorkspace,
  saveActivity, saveCollaborationActivity, saveCommit, saveProposal,
  readWorkspaceCommitSnapshot, readWorkspaceImagePreview, readWorkspaceImageSource,
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
import { getLang, getShareRoomLabels } from "../locales";
import type { RoomImage } from "../components/share/share-room-types";
import ImageCropDialog from "../components/share/workspace/image-crop-dialog";
import ImageResizeDialog from "../components/share/workspace/image-resize-dialog";
import ImageColorAdjustmentDialog from "../components/share/workspace/image-color-adjustment-dialog";
import ImageCompressionDialog from "../components/share/workspace/image-compression-dialog";
import ImageConversionDialog from "../components/share/workspace/image-conversion-dialog";
import CompressionSuggestionDialog from "../components/share/workspace/compression-suggestion-dialog";
import type { ProcessedImageResult } from "../components/share/workspace/image-result-dialog";
import { adjustRoomImage, cropRoomImage, resizeRoomImage, type NormalizedCrop, type RoomColorAdjustments } from "../utils/room-image-editing";
import { DEFAULT_COLOR_ADJUSTMENTS } from "../utils/room-color-adjustments";
import { convertRoomImageTask, type RoomConversionFormat } from "../utils/room-image-conversion";
import { compressRoomImageTask } from "../utils/room-image-compression-task";
import ReviewWorkspace from "../components/share/workspace/review-workspace";
import { renderReviewAnnotations } from "../components/share/workspace/review-annotation-layer";
import RoomImageMedia from "../components/share/room-image-media";
import type { ReviewAnnotation, ReviewCollaborationMessage } from "../utils/review-collaboration";
import {
  browserReportsWeakNetwork,
  canRenderFromCollaborationSource,
  canDeleteWorkspaceImage,
  canStartImageCollaboration,
  needsCollaborationPreviewGeneration,
  normalizeWorkspaceImageLocation,
  reconcileCollaboratorSnapshot,
  sharedWorkingImages,
  shouldSuggestWorkspaceCompression,
  workspaceOperationStorageMode,
} from "./image-flow";
import {
  emptyImageParameterDocument,
  imageParameterDocumentsEqual,
  isValidImageParameterDocument,
  setImageOperation,
  type ImageParameterDocument,
  type ImageOperationType,
} from "./image-protocol";
import { collaborationActivitiesForImage, currentActivityEventId } from "./activity";
import {
  adoptCollaborationPreview,
  adoptCollaborationRender,
  createCollaborationImageContainer,
  disposeCollaborationImageContainer,
  replaceCollaborationDocument,
  type CollaborationImageContainer,
} from "./collaboration-image-container";
import { renderWorkspaceParameterPreview } from "./parameter-preview";
import WorkspaceOperationLogDialog from "./workspace-operation-log-dialog";

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const bytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
const statusLabel: Record<WorkspaceRuntimeState, string> = { local: "Local", connecting: "Connecting", connected: "Connected", syncing: "Syncing", available: "Available", ownerOffline: "Owner offline", unavailable: "Unavailable" };
const collaborationStatusLabel = () => getLang() === "zh" ? "协作中" : "Collaborating";
const cachedCommit = (commit: WorkspaceCommit): WorkspaceCommit => ({
  ...commit,
  snapshotCached: commit.snapshotCached || Boolean(commit.snapshot),
  snapshot: undefined,
});

function protocolOperationType(operation: WorkspaceOperation["type"], parameters: Record<string, unknown>): ImageOperationType {
  if (operation === "brightness" || operation === "contrast" || operation === "saturation") return "color";
  if (operation === "other" && parameters.review) return "draw";
  if (operation === "other") return "filter";
  if (operation === "compression") return "filter";
  return operation;
}

function parameterDocumentOperations(image: WorkspaceImage): WorkspaceOperation[] {
  return (image.parameterDocument || emptyImageParameterDocument()).operations.map((operation) => {
    const explicitType = operation.params.workspaceOperationType;
    const type: WorkspaceOperation["type"] = typeof explicitType === "string"
      ? explicitType as WorkspaceOperation["type"]
      : operation.type === "color" ? "brightness"
        : operation.type === "filter" ? "other"
          : operation.type === "draw" ? "other"
            : operation.type === "crop" || operation.type === "resize" || operation.type === "rotate"
              ? operation.type
              : "other";
    const { workspaceOperationType: _workspaceOperationType, ...parameters } = operation.params;
    return {
      operationId: operation.id,
      imageId: image.imageId,
      authorId: operation.userId,
      baseCommitId: image.currentCommitId || `initial_${image.imageId}`,
      type,
      parameters,
      createdAt: operation.time,
    };
  });
}

function headerBackground(style: WorkspaceStyle): React.CSSProperties {
  const value = style.header.background;
  return { background: value.type === "solid" ? value.color : `linear-gradient(${value.direction === "down" ? "180deg" : value.direction === "downRight" ? "135deg" : "90deg"}, ${value.from}, ${value.to})`, color: style.header.text.color };
}

async function dimensions(file: Blob) { const bitmap = await createImageBitmap(file); try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); } }
function blobFromBytes(value: unknown, mimeType: string) { return value instanceof ArrayBuffer ? new Blob([value],{type:mimeType}) : Array.isArray(value) ? new Blob([new Uint8Array(value.map(Number)).buffer as ArrayBuffer], { type: mimeType }) : null; }
function placeholderFrom(value: unknown): WorkspaceImage["placeholder"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const placeholder = value as Record<string, unknown>;
  return Number.isFinite(placeholder.width) && Number(placeholder.width) > 0
    && Number.isFinite(placeholder.height) && Number(placeholder.height) > 0
    && typeof placeholder.dominantColor === "string"
    && typeof placeholder.blurHash === "string"
    ? placeholder as WorkspaceImage["placeholder"]
    : undefined;
}
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
    } else if (operation.type === "other" && operation.parameters.review && Array.isArray(operation.parameters.annotations)) {
      const overlay = await renderReviewAnnotations(operation.parameters.annotations as ReviewAnnotation[], width, height);
      const [sourceBitmap, overlayBitmap] = await Promise.all([createImageBitmap(current), createImageBitmap(overlay)]);
      try {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.drawImage(sourceBitmap, 0, 0, width, height);
        context.drawImage(overlayBitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        current = new File([blob], current.name.replace(/\.[^.]+$/, "") + "-doodle.png", { type: blob.type });
      } finally {
        sourceBitmap.close();
        overlayBitmap.close();
      }
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
  const [, refreshCollaborationRender] = React.useReducer((version: number) => version + 1, 0);
  const imagesRef = React.useRef<WorkspaceImage[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [runtime, transitionRuntime] = React.useReducer(workspaceRuntimeReducer, shareToken ? "connecting" : "local");
  const [collaborators, setCollaborators] = React.useState<Collaborator[]>([]);
  const [removedFromWorkspace, setRemovedFromWorkspace] = React.useState(false);
  const [activities, setActivities] = React.useState<WorkspaceActivity[]>([]);
  const [operationLogs, setOperationLogs] = React.useState<WorkspaceActivity[]>([]);
  const [operationLogOpen, setOperationLogOpen] = React.useState(false);
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
  const [processingSource, setProcessingSource] = React.useState<{
    imageId: string;
    blob: Blob;
    width: number;
    height: number;
  } | null>(null);
  const [editorPreparing, setEditorPreparing] = React.useState(false);
  const [proposalPreview, setProposalPreview] = React.useState<{ proposalId: string; imageId: string; original: Blob; result: Blob } | null>(null);
  const [sourceRequestDialog, setSourceRequestDialog] = React.useState<Record<string, unknown> | null>(null);
  const [sourceRejectReason, setSourceRejectReason] = React.useState("");
  const [requestingSourceIds, setRequestingSourceIds] = React.useState<Set<string>>(() => new Set());
  const [rejectingProposal, setRejectingProposal] = React.useState<WorkspaceProposal | null>(null);
  const [proposalRejectReason, setProposalRejectReason] = React.useState("");
  const [newVersions, setNewVersions] = React.useState<Record<string, string>>({});
  const [activityPreview, setActivityPreview] = React.useState<{
    activity: WorkspaceActivity;
    parameterDocument: ImageParameterDocument;
    preview: Blob;
    commitId?: string;
  } | null>(null);
  const [maximizedImageId, setMaximizedImageId] = React.useState<string | null>(null);
  const [deletingImage, setDeletingImage] = React.useState<WorkspaceImage | null>(null);
  const [deleteChoice, setDeleteChoice] = React.useState<"library" | "permanent">("library");
  const [rollbackTarget, setRollbackTarget] = React.useState<WorkspaceCommit | null>(null);
  const [rollbackPreview, setRollbackPreview] = React.useState<Blob | null>(null);
  const [saveCollaborationOpen, setSaveCollaborationOpen] = React.useState(false);
  const [collaborationSaveChoice, setCollaborationSaveChoice] = React.useState<"replace" | "copy">("copy");
  const [collaborationSaving, setCollaborationSaving] = React.useState(false);
  const [pendingProcessedResult, setPendingProcessedResult] = React.useState<{
    source: WorkspaceImage;
    result: ProcessedImageResult;
  } | null>(null);
  const [processedResultSaving, setProcessedResultSaving] = React.useState(false);
  const reviewListeners = React.useRef(new Set<(event:{sequence:number;message:ReviewCollaborationMessage})=>void>());
  const pendingProposalEvents = React.useRef(new Map<string, string>());
  const pendingSourceRequests = React.useRef(new Map<string, { imageId: string; timer: number; eventId?: string }>());
  const collaborationContainers = React.useRef(new Map<string, CollaborationImageContainer>());
  const collaborationRenderSequence = React.useRef(0);
  const latestCollaborationRenders = React.useRef(new Map<string, number>());
  const operationOpenSequence = React.useRef(0);
  const reactionNodes = React.useRef(new Set<HTMLElement>());
  const reactionTimers = React.useRef(new Set<number>());
  const deduplicatedImages = React.useMemo(
    () => [...new Map(images.map((image) => [image.imageId, image])).values()],
    [images],
  );
  const selected = deduplicatedImages.find((image) => image.imageId === selectedId) || null;
  const selectedIsLibrary = workspace?.role === "owner" && selected?.workspaceLocation === "library";
  const realtimeConnected = runtime === "connected" || runtime === "available" || runtime === "syncing";
  const onlineCollaborators = realtimeConnected ? collaborators.filter((value) => value.online) : [];
  const onlinePeers = onlineCollaborators.length;
  const libraryImages = deduplicatedImages.filter((image) => workspace?.role === "owner" && image.workspaceLocation === "library");
  const workingImages = deduplicatedImages.filter((image) => workspace?.role === "collaborator" || image.workspaceLocation === "working");
  const workingImagesSorted = [...workingImages].sort((left, right) =>
    (right.pinnedAt || 0) - (left.pinnedAt || 0) || right.updatedAt - left.updatedAt,
  );
  const pendingWorkingImage = images.find((image) => image.imageId === pendingWorkingImageId) || null;
  const compressingToWorkingImage = images.find((image) => image.imageId === compressingToWorkingImageId) || null;
  const completeOperationLog = [...operationLogs, ...activities.filter((activity) => activity.kind !== "historyRolledBack")]
    .sort((left, right) => left.createdAt - right.createdAt);
  const selectedCollaborationActivities = selected?.shared
    ? collaborationActivitiesForImage(activities, selected.imageId)
    : [];
  const currentCollaborationActivityId = currentActivityEventId(
    selectedCollaborationActivities,
    selected?.currentCommitId,
  );
  const activityPreviewIsCurrent = activityPreview?.activity.eventId === currentCollaborationActivityId;
  const selectedImageCommits = selected
    ? commits.filter((commit) => commit.imageId === selected.imageId)
      .sort((left, right) => left.createdAt - right.createdAt)
    : [];
  const selectedOriginalCommit = selected
    ? selectedImageCommits.find((commit) => commit.commitId.startsWith("initial_")) || {
      commitId: `initial_${selected.imageId}`,
      imageId: selected.imageId,
      authorId: "owner",
      parentCommitId: null,
      mergeParentCommitIds: [],
      operations: [],
      createdAt: 0,
    }
    : undefined;
  const collaborationPreviewFor = (image: WorkspaceImage) => {
    const container = collaborationContainers.current.get(image.imageId);
    return workspace && container
      && canRenderFromCollaborationSource(workspace.role, container.sourceKind === "source")
      ? container.preview
      : undefined;
  };
  const maximizedWorkspaceImage = images.find((image) => image.imageId === maximizedImageId && image.shared) || null;
  const maximizedPreviewBlob = maximizedWorkspaceImage
    ? collaborationPreviewFor(maximizedWorkspaceImage)
    : undefined;
  imagesRef.current = deduplicatedImages;

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

  async function loadSource(image: WorkspaceImage, materialize = false) {
    if (processingSource?.imageId === image.imageId) return processingSource.blob;
    const container = collaborationContainers.current.get(image.imageId);
    if (image.shared && materialize) return (await syncCollaborationContainer(
      image, image.parameterDocument || emptyImageParameterDocument(),
    ))?.rendered || null;
    if (image.shared && container && !container.disposed) return container.preview;
    if (image.shared) return (await syncCollaborationPreview(
      image, image.parameterDocument || emptyImageParameterDocument(),
    ))?.preview || null;
    return readWorkspaceImageSource(image);
  }

  async function syncCollaborationPreview(
    image: WorkspaceImage,
    parameterDocument = image.parameterDocument || emptyImageParameterDocument(),
    sourceOverride?: Blob,
  ) {
    const requestSequence = ++collaborationRenderSequence.current;
    latestCollaborationRenders.current.set(image.imageId, requestSequence);
    let container = collaborationContainers.current.get(image.imageId);
    let created = false;
    if (sourceOverride) {
      container = createCollaborationImageContainer({
        imageId: image.imageId, source: sourceOverride, sourceKind: "source", name: image.name, mimeType: image.mimeType,
        width: image.width, height: image.height, parameterDocument: emptyImageParameterDocument(),
      });
      collaborationContainers.current.set(image.imageId, container);
      refreshCollaborationRender();
      created = true;
    } else if (!container || container.disposed) {
      const original = image.sourceCached ? await readWorkspaceImageSource(image) : null;
      const source = original || await readWorkspaceImagePreview(image);
      if (!source) return null;
      if (latestCollaborationRenders.current.get(image.imageId) !== requestSequence) {
        return collaborationContainers.current.get(image.imageId) || null;
      }
      const sourceDocument = emptyImageParameterDocument();
      container = createCollaborationImageContainer({
        imageId: image.imageId, source, sourceKind: original ? "source" : "preview", name: image.name, mimeType: image.mimeType,
        width: image.width, height: image.height, parameterDocument: sourceDocument,
      });
      collaborationContainers.current.set(image.imageId, container);
      created = true;
    }
    if (imageParameterDocumentsEqual(container.parameterDocument, parameterDocument)) {
      if (created) refreshCollaborationRender();
      return container;
    }
    const result = await renderWorkspaceParameterPreview(
      container.source,
      { width: container.sourceWidth, height: container.sourceHeight },
      parameterDocumentOperations({ ...image, parameterDocument }),
    );
    if (latestCollaborationRenders.current.get(image.imageId) !== requestSequence) {
      return collaborationContainers.current.get(image.imageId) || null;
    }
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) {
      collaborationContainers.current.delete(image.imageId);
      latestCollaborationRenders.current.delete(image.imageId);
      return null;
    }
    const previewed = adoptCollaborationPreview(container, parameterDocument, result);
    collaborationContainers.current.set(image.imageId, previewed);
    refreshCollaborationRender();
    return previewed;
  }

  async function renderCollaborationPreviewSnapshot(
    image: WorkspaceImage,
    parameterDocument: ImageParameterDocument,
  ) {
    const container = collaborationContainers.current.get(image.imageId);
    let source: Blob | null = null;
    let width = image.width;
    let height = image.height;
    if (container && !container.disposed) {
      source = container.source;
      width = container.sourceWidth;
      height = container.sourceHeight;
    } else {
      source = image.sourceCached ? await readWorkspaceImageSource(image) : null;
      source ||= await readWorkspaceImagePreview(image);
    }
    if (!source) return null;
    return renderWorkspaceParameterPreview(
      source,
      { width, height },
      parameterDocumentOperations({ ...image, parameterDocument }),
    );
  }

  async function syncCollaborationContainer(
    image: WorkspaceImage,
    parameterDocument = image.parameterDocument || emptyImageParameterDocument(),
  ) {
    let container = collaborationContainers.current.get(image.imageId);
    if (!container || container.disposed || container.sourceKind !== "source") {
      const source = await readWorkspaceImageSource(image);
      if (!source) return null;
      const sourceSize = await dimensions(source);
      container = createCollaborationImageContainer({
        imageId: image.imageId, source, sourceKind: "source", name: image.name, mimeType: image.mimeType,
        width: sourceSize.width, height: sourceSize.height, parameterDocument: emptyImageParameterDocument(),
      });
    }
    const rendered = await replaceCollaborationDocument(
      container,
      parameterDocument,
      parameterDocumentOperations({ ...image, parameterDocument }),
      (source, operations) => replayOperations({ ...image, source, width: container!.sourceWidth, height: container!.sourceHeight }, operations),
    );
    collaborationContainers.current.set(image.imageId, rendered);
    return rendered;
  }

  async function openImageOperation(image: WorkspaceImage, operation: WorkspaceCardOperation) {
    const parameterType: Partial<Record<WorkspaceCardOperation, ImageOperationType>> = {
      crop: "crop", resize: "resize", adjust: "color", review: "draw",
    };
    const editableParameterType = parameterType[operation];
    const requestSequence = ++operationOpenSequence.current;
    setEditorPreparing(Boolean(editableParameterType && image.shared));
    const container = image.shared ? collaborationContainers.current.get(image.imageId) : null;
    const source = editableParameterType && container?.sourceKind === "source"
      ? container.source
      : editableParameterType && image.shared
        ? await readWorkspaceImageSource(image)
        : await loadSource(image, image.shared);
    if (operationOpenSequence.current !== requestSequence) return;
    if (!source) {
      if (operationOpenSequence.current === requestSequence) setEditorPreparing(false);
      setNotice("Source data is unavailable");
      return;
    }
    const sourceSize = editableParameterType && image.shared
      ? {width:container?.sourceWidth || image.width,height:container?.sourceHeight || image.height}
      : await dimensions(source);
    if (operationOpenSequence.current !== requestSequence) return;
    setSelectedId(image.imageId);
    setProcessingSource({ imageId: image.imageId, blob: source, ...sourceSize });
    if (operation === "review") setReviewOpen(true);
    else setEditing(operation);
    if (editableParameterType && image.shared) {
      const parameterDocument = image.parameterDocument || emptyImageParameterDocument();
      const baseDocument = {
        ...parameterDocument,
        operations: parameterDocument.operations.filter((candidate) => candidate.type !== editableParameterType),
      };
      void renderWorkspaceParameterPreview(
        source,
        sourceSize,
        parameterDocumentOperations({...image,parameterDocument:baseDocument}),
      ).then((result) => {
        if (operationOpenSequence.current !== requestSequence) return;
        setEditorPreparing(false);
        setProcessingSource({imageId:image.imageId,blob:result.blob,width:result.width,height:result.height});
      }).catch((error) => {
        if (operationOpenSequence.current !== requestSequence) return;
        setEditorPreparing(false);
        setNotice(error instanceof Error ? error.message : "Editor preview is unavailable");
      });
    }
  }

  function releaseProcessingSource() {
    operationOpenSequence.current += 1;
    setEditorPreparing(false);
    setProcessingSource(null);
  }

  async function downloadImage(image: WorkspaceImage) {
    const source = image.shared
      ? (await syncCollaborationContainer(image, image.parameterDocument || emptyImageParameterDocument()))?.rendered
      : await readWorkspaceImageSource(image);
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

  function maximizeCollaborativeImage(image: WorkspaceImage) {
    setSelectedId(image.imageId);
    setMaximizedImageId(image.imageId);
  }

  const sendWorkspaceSnapshot = React.useCallback((targetUserId?: string) => {
    if (!workspace || workspace.role !== "owner") return;
    const sharedImages = sharedWorkingImages(imagesRef.current);
    const route = targetUserId ? "user" as const : "workspace" as const;
    realtimeRef.current?.send("stateSnapshot", {
      images: sharedImages.map(({ source: _source, preview: _preview, sourceCached: _sourceCached, previewCached: _previewCached, ...image }) => image),
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
    if (workspace && !isInboundEventAllowed(workspace.role, type, value.senderRole)) return;
    if(workspace&&["placeholderUpsert","previewRemove","sourceRequest","sourceRejected","styleUpdated","message"].includes(type))void persistWorkspaceLog(workspace.workspaceId,type,typeof value.imageId==="string"?value.imageId:undefined,{senderName:value.senderName,reason:value.reason},typeof value.senderId==="string"?value.senderId:"remote");
    if (type === "syncRequired") { transitionRuntime({type:"transition",next:"syncing"}); realtimeRef.current?.send("stateRequest", {}, { route: "owner", delivery: "reliable" }); }
    else if (type === "deliveryFailed" && value.eventType === "sourceRequest" && typeof value.eventId === "string") {
      finishSourceRequest({eventId:value.eventId});
      setNotice("Source request could not be delivered");
    }
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
    else if (type === "memberRemoved" && workspace?.role === "collaborator") {
      realtimeRef.current?.disconnect();
      transitionRuntime({type:"transition",next:"unavailable"});
      setRemovedFromWorkspace(true);
    }
    else if (type === "connected") { transitionRuntime({type:"transition",next:"connected"}); const members = Array.isArray(value.members) ? value.members as Array<Record<string, unknown>> : []; setCollaborators(members.map((member) => ({ clientId: String(member.userId), displayName: String(member.userName || member.role || "Guest"), role: member.role === "owner" ? "owner" : "collaborator", online: true }))); if(workspace?.role==="owner")transitionRuntime({type:"transition",next:"available"});else transitionRuntime({type:"transition",next:value.ownerOnline === false ? "ownerOffline" : "syncing"}); }
    else if (type === "memberJoined") {
      setCollaborators((current) => [...current.filter((item) => item.clientId !== value.userId), { clientId: String(value.userId), displayName: String(value.userName || "Guest"), role: value.role === "owner" ? "owner" : "collaborator", online: true }]);
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
        reconciled.removedImageIds.forEach((imageId) => void deleteWorkspaceImage(imageId));
        reconciled.images.forEach((image) => void saveWorkspaceImage(image));
        reconciled.images
          .filter((image) => image.shared && (image.sourceCached || image.previewCached))
          .forEach((image) => void syncCollaborationPreview(
            image,
            image.parameterDocument || emptyImageParameterDocument(),
          ).catch((error) => setNotice(error instanceof Error ? error.message : "Image preview is unavailable")));
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
      latestCollaborationRenders.current.delete(imageId);
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
    else if (type === "sourceRejected") {finishSourceRequest({requestId:typeof value.requestId==="string"?value.requestId:undefined,imageId:typeof value.imageId==="string"?value.imageId:undefined});setNotice(typeof value.reason === "string" ? value.reason : "Source request was rejected");}
    else if (type === "proposalSubmit" && workspace?.role === "owner" && value.proposal && typeof value.senderId === "string") { const incoming=value.proposal as WorkspaceProposal,senderId=value.senderId,image=images.find((item)=>item.imageId===incoming.imageId); if (!validateProposal(incoming,workspace.workspaceId,image)) return; const proposal={...incoming,state:image!.currentCommitId&&image!.currentCommitId!==incoming.baseCommitId?"conflict" as const:"pending" as const,authorId:senderId,operations:incoming.operations.map((operation)=>({...operation,authorId:senderId}))}; setProposals((current)=>current.some((p)=>p.proposalId===proposal.proposalId)?current:[...current,proposal]); void saveProposal(proposal); void updateImage(proposal.imageId,{state:"reviewing"}); void persistCollaborationActivity(workspace.workspaceId,"proposalSubmitted",proposal.imageId,{proposalId:proposal.proposalId,operations:proposal.operations.map(({operationId,type,parameters})=>({operationId,type,parameters})),status:proposal.state},senderId); }
    else if (type === "proposalDecision") { const proposalId=String(value.proposalId); setProposals((current)=>current.map((proposal)=>{if(proposal.proposalId!==proposalId)return proposal;const next={...proposal,state:String(value.state) as WorkspaceProposal["state"],rejectReason:typeof value.reason==="string"?value.reason:undefined};const operation=proposal.operations[0];void saveProposal(next);if(workspace)void persistCollaborationActivity(workspace.workspaceId,`proposal${next.state[0].toUpperCase()}${next.state.slice(1)}`,proposal.imageId,{proposalId,commitId:typeof value.commitId==="string"?value.commitId:undefined,operationType:typeof value.operationType==="string"?value.operationType:operation?.type,operations:Array.isArray(value.operations)?value.operations:proposal.operations.map(({operationId,type,parameters,authorId})=>({operationId,operationType:type,parameters,actorId:authorId})),parameterDocument:isValidImageParameterDocument(value.parameterDocument)?value.parameterDocument:undefined,reason:next.rejectReason},"owner");if(next.state==="rejected"||next.state==="later"){const image=imagesRef.current.find((candidate)=>candidate.imageId===proposal.imageId);if(image?.sourceCached)void syncCollaborationPreview(image,image.parameterDocument||emptyImageParameterDocument()).catch((error)=>setNotice(error instanceof Error?error.message:"Image preview is unavailable"));}return next;})); }
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
          const patched={...image,currentCommitId:commit.commitId,parameterDocument,state:"shared" as const};
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
      if(targetCreatedAt){setCommits((current)=>current.filter((commit)=>commit.imageId!==imageId||commit.createdAt<=targetCreatedAt));void deleteCommitsAfter(imageId,targetCreatedAt);}
      if(workspace&&activityCreatedAt!==null){setActivities((current)=>current.filter((activity)=>activity.imageId!==imageId||activity.createdAt<=activityCreatedAt));void deleteCollaborationActivitiesAfter(workspace.workspaceId,imageId,activityCreatedAt);}
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
  }, [images, persistCollaborationActivity, persistWorkspaceLog, sendWorkspaceSnapshot, updateImage, workspace]);
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
      if (sourceTransfers.current.isCompletionPending(requestId)) {
        await receiveSource({...value,type:"sourceComplete"});
      }
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
      finishSourceRequest({requestId,imageId:completed.imageId});
      setNewVersions((current) => {
        const next = { ...current };
        delete next[completed.imageId];
        return next;
      });
      if (persisted.shared) {
        const previous = collaborationContainers.current.get(completed.imageId);
        if (previous) disposeCollaborationImageContainer(previous);
        collaborationContainers.current.delete(completed.imageId);
        await syncCollaborationPreview(cached, cached.parameterDocument, completed.source);
      }
    } else if (!sourceTransfers.current.has(requestId)) {
      finishSourceRequest({requestId});
      setNotice("Received source data is incomplete or invalid");
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

  React.useEffect(() => { let active=true; void (async()=>{ let current:WorkspaceIdentity; if(shareToken){const joined=await joinWorkspace(shareToken);current={workspaceId:joined.workspace.id,name:joined.workspace.name,role:"collaborator",shareToken,ownerCapability:null,createdAt:Date.parse(joined.workspace.createdAt),updatedAt:Date.parse(joined.workspace.updatedAt),style:defaultWorkspaceStyle()};await saveWorkspace(current);}else current=await restoreLocalWorkspace();await purgeExpiredCache(); if(!active)return; setWorkspace(current);setStyleDraft(current.style);const [storedImages,storedActivities,storedLogs,storedProposals]=await Promise.all([listWorkspaceImages(current.workspaceId),listActivities(current.workspaceId),listOperationLogs(current.workspaceId),listProposals(current.workspaceId)]);if(!active)return;setImages(storedImages);setActivities(storedActivities);setOperationLogs(storedLogs);setProposals(storedProposals);if(current.role==="collaborator"||current.shareToken){const realtime=new WorkspaceRealtimeClient(current);realtimeRef.current=realtime;realtime.subscribe((value)=>realtimeEventRef.current(value));transitionRuntime({type:"transition",next:"connecting"});await realtime.connect();}})().catch((error)=>{setNotice(error instanceof Error?error.message:"Workspace unavailable");transitionRuntime({type:"transition",next:"unavailable"});});return()=>{active=false;sourceTransfers.current.clear();pendingProposalEvents.current.clear();pendingSourceRequests.current.forEach((request)=>window.clearTimeout(request.timer));pendingSourceRequests.current.clear();collaborationContainers.current.forEach((container)=>disposeCollaborationImageContainer(container));collaborationContainers.current.clear();reactionTimers.current.forEach((timer)=>window.clearTimeout(timer));reactionTimers.current.clear();reactionNodes.current.forEach((node)=>node.remove());reactionNodes.current.clear();realtimeRef.current?.disconnect();realtimeRef.current=null;};},[shareToken]);

  React.useEffect(() => { if (!selectedId && images[0]) setSelectedId(images[0].imageId); if (selectedId && !images.some((image) => image.imageId === selectedId)) setSelectedId(images[0]?.imageId || null); }, [images, selectedId]);
  React.useEffect(()=>{if(!maximizedImageId)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setMaximizedImageId(null);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[maximizedImageId]);
  React.useEffect(()=>{images.filter((image)=>image.shared&&(image.sourceCached||image.previewCached)&&!collaborationContainers.current.has(image.imageId)).forEach((image)=>{void syncCollaborationPreview(image,image.parameterDocument||emptyImageParameterDocument()).catch((error)=>setNotice(error instanceof Error?error.message:"The shared image could not be decoded"));});},[images]);
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

  async function addFiles(files: FileList | File[]) { if(!workspace||workspace.role!=="owner")return;for(const file of Array.from(files)){if(!file.type.startsWith("image/"))continue;const [size,thumbnail]=await Promise.all([dimensions(file),generateShareThumbnail(file,320,240)]),imageId=id("image"),initialCommitId=`initial_${imageId}`,preview=new Blob([thumbnail.slice().buffer as ArrayBuffer],{type:"image/webp"});const image:WorkspaceImage={imageId,workspaceId:workspace.workspaceId,name:file.name,mimeType:file.type,size:file.size,...size,workspaceLocation:"library",state:"private",shared:false,currentCommitId:initialCommitId,previewRevision:0,createdAt:Date.now(),updatedAt:Date.now(),sourceCached:true,previewCached:true,source:file,preview};const initial:WorkspaceCommit={commitId:initialCommitId,imageId,authorId:"owner",parentCommitId:null,mergeParentCommitIds:[],operations:[],snapshot:file,snapshotName:file.name,snapshotMimeType:file.type,snapshotWidth:size.width,snapshotHeight:size.height,createdAt:Date.now()};await saveWorkspaceImage(image);await saveCommit(initial);const cached={...image,source:undefined,preview:undefined};setImages((current)=>[...current,cached]);setCommits((current)=>[...current,cachedCommit(initial)]);setSelectedId(imageId);await persistWorkspaceLog(workspace.workspaceId,"imageAdded",image.imageId);}if(inputRef.current)inputRef.current.value=""; }
  async function moveImageToWorking(image: WorkspaceImage) {
    if (!workspace || workspace.role !== "owner") return;
    await updateImage(image.imageId, {
      workspaceLocation: "working",
      state: image.state === "private" ? "working" : image.state,
    });
    setSelectedId(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId, "imageMovedToWorking", image.imageId);
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
    if (image.shared) {
      setNotice("当前图片正处于协作中，不可删除。请先停止协作。");
      return;
    }
    realtimeRef.current?.send("previewRemove", { imageId: image.imageId }, {
      delivery: "reliable", dataClass: "preview",
    });
    const source = image.sourceCached ? await readWorkspaceImageSource(image) : null;
    const sourceSize = source ? await dimensions(source) : { width: image.width, height: image.height };
    const initialCommitId = `initial_${image.imageId}`;
    await clearWorkspaceImageHistory(image.imageId);
    await updateImage(image.imageId, {
      workspaceLocation: "library",
      shared: false,
      state: "private",
      currentCommitId: initialCommitId,
      parameterDocument: emptyImageParameterDocument(),
      width: sourceSize.width,
      height: sourceSize.height,
    });
    const initialCommit: WorkspaceCommit = {
      commitId: initialCommitId,
      imageId: image.imageId,
      authorId: "owner",
      parentCommitId: null,
      mergeParentCommitIds: [],
      operations: [],
      createdAt: Date.now(),
    };
    await saveCommit(initialCommit);
    setCommits((current) => [...current.filter((commit) => commit.imageId !== image.imageId), cachedCommit(initialCommit)]);
    setActivities((current) => current.filter((activity) => activity.imageId !== image.imageId));
    setProposals((current) => current.filter((proposal) => proposal.imageId !== image.imageId));
    setNewVersions((current) => { const next={...current};delete next[image.imageId];return next; });
    const container=collaborationContainers.current.get(image.imageId);
    if(container)disposeCollaborationImageContainer(container);
    collaborationContainers.current.delete(image.imageId);
    if(maximizedImageId===image.imageId)setMaximizedImageId(null);
    if(processingSource?.imageId===image.imageId){setProcessingSource(null);setEditing(null);setReviewOpen(false);}
    if(activityPreview?.activity.imageId===image.imageId)setActivityPreview(null);
    if(rollbackTarget?.imageId===image.imageId){setRollbackTarget(null);setRollbackPreview(null);}
    setSelectedId(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId, "imageMovedToLibrary", image.imageId);
  }
  function requestDeleteImage(image: WorkspaceImage) {
    if (!canDeleteWorkspaceImage(image)) {
      setNotice("当前图片正处于协作中，不可删除。请先停止协作。");
      return;
    }
    setDeleteChoice(image.workspaceLocation === "working" ? "library" : "permanent");
    setDeletingImage(image);
  }
  async function confirmDeleteImage() {
    if (!workspace || !deletingImage) return;
    const image = deletingImage;
    setDeletingImage(null);
    if (deleteChoice === "library" && image.workspaceLocation === "working") {
      await moveImageToLibrary(image);
      return;
    }
    await deleteWorkspaceImage(image.imageId);
    await persistWorkspaceLog(workspace.workspaceId,"imageDeleted",undefined,{imageId:image.imageId,name:image.name});
    setImages((current) => current.filter((item) => item.imageId !== image.imageId));
    setCommits((current) => current.filter((commit) => commit.imageId !== image.imageId));
    setActivities((current) => current.filter((activity) => activity.imageId !== image.imageId));
    setProposals((current) => current.filter((proposal) => proposal.imageId !== image.imageId));
    setNewVersions((current) => { const next={...current};delete next[image.imageId];return next; });
    const container=collaborationContainers.current.get(image.imageId);
    if(container)disposeCollaborationImageContainer(container);
    collaborationContainers.current.delete(image.imageId);
    if(maximizedImageId===image.imageId)setMaximizedImageId(null);
    if(processingSource?.imageId===image.imageId){setProcessingSource(null);setEditing(null);setReviewOpen(false);}
    if(activityPreview?.activity.imageId===image.imageId)setActivityPreview(null);
    if(rollbackTarget?.imageId===image.imageId){setRollbackTarget(null);setRollbackPreview(null);}
    if (selectedId === image.imageId) setSelectedId(null);
  }
  async function saveProcessedCopy(
    source: WorkspaceImage,
    result: ProcessedImageResult,
    destination: "library" | "working" = "working",
  ) {
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
      workspaceLocation: destination,
      state: destination === "library" ? "private" : "working",
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
    await saveWorkspaceImage(image);
    await saveCommit(initialCommit);
    setImages((current) => [...current, { ...image, source: undefined, preview: undefined }]);
    setCommits((current) => [...current, cachedCommit(initialCommit)]);
    setSelectedId(imageId);
    setCompressingToWorkingImageId(null);
    setEditing(null);
    await persistWorkspaceLog(workspace.workspaceId, "imageCreatedFromOperation", imageId, {
      sourceImageId: source.imageId,
      operation: result.operation,
      destination,
    });
    return imageId;
  }
  function queueProcessedResult(source: WorkspaceImage, result: ProcessedImageResult) {
    setEditing(null);
    setPendingProcessedResult({ source, result });
    releaseProcessingSource();
  }
  async function confirmProcessedResult(destination: "library" | "working") {
    if (!pendingProcessedResult || processedResultSaving) return;
    setProcessedResultSaving(true);
    try {
      await saveProcessedCopy(pendingProcessedResult.source, pendingProcessedResult.result, destination);
      setPendingProcessedResult(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save processed image");
    } finally {
      setProcessedResultSaving(false);
    }
  }
  async function publishPreview(image: WorkspaceImage, source: Blob, targetUserId?: string) {
    const revision = image.previewRevision + 1;
    const [placeholder, thumbnail] = await Promise.all([
      generateSharePlaceholder(source),
      generateShareThumbnail(source, 640, 480),
    ]);
    const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) return;
    await updateImage(image.imageId, { placeholder, preview, previewRevision: revision });
    if (!imagesRef.current.some((candidate) => candidate.imageId === image.imageId && candidate.shared)) return;
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
    if (shared && !canStartImageCollaboration(imagesRef.current, image.imageId)) {
      setNotice("同一时间只能有一张图片处于协作状态。");
      return;
    }
    const next = { ...image, shared, state: shared ? "shared" as const : "private" as const };
    await updateImage(image.imageId, { shared, state: next.state });
    if (!shared) {
      realtimeRef.current?.send("previewRemove", { imageId: image.imageId }, {
        delivery: "reliable", dataClass: "preview",
      });
      const container=collaborationContainers.current.get(image.imageId);if(container)disposeCollaborationImageContainer(container);collaborationContainers.current.delete(image.imageId);
      await persistWorkspaceLog(workspace.workspaceId, "imageUnshared", image.imageId);
      return;
    }
    const source = await readWorkspaceImageSource(image);
    if (!source) return;
    const sourceSize=await dimensions(source);const parameterDocument=image.parameterDocument||emptyImageParameterDocument();const container=createCollaborationImageContainer({imageId:image.imageId,source,sourceKind:"source",name:image.name,mimeType:image.mimeType,width:sourceSize.width,height:sourceSize.height,parameterDocument:emptyImageParameterDocument()});
    collaborationContainers.current.set(image.imageId,container);
    await syncCollaborationPreview({...next,parameterDocument},parameterDocument);
    await publishPreview(next, source);
    await persistWorkspaceLog(workspace.workspaceId, "imageShared", image.imageId);
  }
  async function createShare(){if(!workspace)return;const created=await createWorkspaceShare(workspace.name);const previousId=workspace.workspaceId;const next={...workspace,workspaceId:created.workspace.id,shareToken:created.workspace.shareId,ownerCapability:created.ownerCapability,updatedAt:Date.now()};await promoteLocalWorkspace(previousId,next);setWorkspace(next);setImages((current)=>current.map((image)=>({...image,workspaceId:next.workspaceId})));const realtime=new WorkspaceRealtimeClient(next);realtimeRef.current?.disconnect();realtimeRef.current=realtime;realtime.subscribe((value)=>realtimeEventRef.current(value));transitionRuntime({type:"transition",next:"connecting"});await realtime.connect();}
  async function rotateShare(){if(!workspace)return;const result=await rotateWorkspaceShare(workspace);const next={...workspace,shareToken:result.workspace.shareId,updatedAt:Date.now()};await saveWorkspace(next);setWorkspace(next);setNotice("A new link was created. The previous link is no longer valid.");}
  async function copyShare(){if(!workspace?.shareToken)return;await navigator.clipboard.writeText(shareUrl(workspace.shareToken));setCopied(true);window.setTimeout(()=>setCopied(false),1500);}
  function showReaction(emoji:string){const node=document.createElement("div");node.textContent=emoji;node.className="pointer-events-none fixed left-1/2 top-1/2 z-[100] text-5xl workspace-reaction-float";document.body.append(node);reactionNodes.current.add(node);const timer=window.setTimeout(()=>{node.remove();reactionNodes.current.delete(node);reactionTimers.current.delete(timer);},1400);reactionTimers.current.add(timer);}
  function react(emoji:string){if(!onlinePeers)return;showReaction(emoji);setReactionCounts((current)=>({...current,[emoji]:(current[emoji]||0)+1}));realtimeRef.current?.send("reaction",{emoji},{delivery:"ephemeral",dataClass:"presence"});}
  function sendMessage(){const text=message.trim();if(!text||!onlinePeers)return;setMessages((current)=>[...current,{id:id("message"),text,actor:"You"}]);realtimeRef.current?.send("message",{text},{delivery:"ephemeral"});if(workspace)void persistWorkspaceLog(workspace.workspaceId,"message",selected?.imageId);setMessage("");}
  function removeCollaborator(person: Collaborator) {
    if (workspace?.role !== "owner" || person.role !== "collaborator") return;
    realtimeRef.current?.removeCollaborator(person.clientId);
  }
  function requestSource(value: WorkspaceImage | React.SyntheticEvent | null = selected){const image=value&&"imageId" in value?value:selected;if(!image||!image.shared||runtime!=="available"||[...pendingSourceRequests.current.values()].some((request)=>request.imageId===image.imageId))return;const requestId=id("source");const eventId=realtimeRef.current?.send("sourceRequest",{requestId,imageId:image.imageId},{route:"owner",delivery:"reliable",dataClass:"collaborationEvent"});if(!eventId)return;const timer=window.setTimeout(()=>{finishSourceRequest({requestId});setNotice("Source request timed out");},30_000);pendingSourceRequests.current.set(requestId,{imageId:image.imageId,eventId,timer});setRequestingSourceIds((current)=>new Set(current).add(image.imageId));}
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
    if (workspaceOperationStorageMode(selected) === "newImage") {
      if (!processed) return;
      await saveProcessedCopy(selected, {
        blob: processed.blob,
        name: processed.name,
        operation: type === "other" ? "convert" : type === "brightness" ? "adjust" : type,
        parameters,
        width: processed.width,
        height: processed.height,
      } as ProcessedImageResult);
      return;
    }
    if (workspace.role === "collaborator") {
      const proposal: WorkspaceProposal = { proposalId: id("proposal"), workspaceId: workspace.workspaceId,
        imageId: selected.imageId, authorId: "local", baseCommitId: operation.baseCommitId,
        operations: [operation], state: "draft", createdAt: Date.now() };
      await saveProposal(proposal);
      setProposals((current) => [...current, proposal]);
      await submitProposal(proposal);
      // A Proposal is not the collaborator's current image. Until the Owner
      // commits it, both sides continue displaying the Owner's current state.
      await persistCollaborationActivity(workspace.workspaceId, "proposalSubmitted", selected.imageId, {
        proposalId: proposal.proposalId,
        operationId: operation.operationId,
        operationType: type,
        parameters,
        commitId: operation.baseCommitId,
        actorId: operation.authorId,
        status: "pending",
      });
      return;
    }
    const parameterDocument = setImageOperation(
      selected.parameterDocument || emptyImageParameterDocument(),
      {
        id: operation.operationId,
        userId: operation.authorId,
        time: operation.createdAt,
        type: protocolOperationType(type, parameters),
        params: { ...parameters, workspaceOperationType: type },
      },
    );
    const parameterCommit: WorkspaceCommit = {
      commitId: id("commit"), imageId: selected.imageId, authorId: "owner",
      parentCommitId: selected.currentCommitId, mergeParentCommitIds: [],
      operations: [operation], createdAt: Date.now(),
    };
    await saveCommit(parameterCommit);
    setCommits((current) => [...current, cachedCommit(parameterCommit)]);
    await updateImage(selected.imageId, {
      parameterDocument,
      currentCommitId: parameterCommit.commitId,
      state: "shared",
    });
    const currentContainer=collaborationContainers.current.get(selected.imageId);
    const rendered=currentContainer&&processed
      ? adoptCollaborationRender(currentContainer,parameterDocument,processed)
      : await syncCollaborationPreview({...selected,parameterDocument,currentCommitId:parameterCommit.commitId},parameterDocument);
    if(rendered)collaborationContainers.current.set(selected.imageId,rendered);
    realtimeRef.current?.send("commitCreated", { commit: parameterCommit, parameterDocument }, {
      delivery: "reliable", dataClass: "collaborationEvent",
    });
    await persistCollaborationActivity(workspace.workspaceId, "operationCommitted", selected.imageId, {
      commitId: parameterCommit.commitId,
      operationId: operation.operationId,
      operationType: type,
      parameters,
      actorId: operation.authorId,
      parameterDocument,
    });
    return;
  }

  async function proposalInput(proposal: WorkspaceProposal) {
    const image = images.find((item) => item.imageId === proposal.imageId);
    if (!image) throw new Error("Proposal image is unavailable");
    if (workspace?.role === "collaborator" || proposal.authorId === "local") {
      const container = collaborationContainers.current.get(proposal.imageId);
      const source = container?.sourceKind === "source"
        ? container.source
        : await readWorkspaceImageSource(image);
      if (!source) throw new Error("Source is not available for Proposal preview");
      return { ...image, source };
    }
    if (image.currentCommitId === proposal.baseCommitId) {
      const source = await readWorkspaceImageSource(image);
      if (!source) throw new Error("Proposal base version is unavailable");
      return { ...image, source };
    }
    const history = await listCommits(proposal.imageId);
    const base = history.find((commit) => commit.commitId === proposal.baseCommitId);
    const snapshot = base ? await readWorkspaceCommitSnapshot(base) : null;
    if (!base || !snapshot) throw new Error("Proposal base version is unavailable");
    return { ...image, source: snapshot, name: base.snapshotName || image.name,
      mimeType: base.snapshotMimeType || image.mimeType, width: base.snapshotWidth || image.width,
      height: base.snapshotHeight || image.height };
  }

  async function previewProposal(proposal: WorkspaceProposal) {
    try {
      const image = imagesRef.current.find((candidate) => candidate.imageId === proposal.imageId);
      if (!image) throw new Error("Proposal image is unavailable");
      const input = await proposalInput(proposal);
      const original = input.source;
      if (!original) throw new Error("Proposal base version is unavailable");
      const baseDocument = workspace?.role === "collaborator" || proposal.authorId === "local" || image.currentCommitId === proposal.baseCommitId
        ? image.parameterDocument || emptyImageParameterDocument()
        : emptyImageParameterDocument();
      const parameterDocument = proposal.operations.reduce((document, operation) => setImageOperation(document, {
        id: operation.operationId,
        userId: operation.authorId,
        time: operation.createdAt,
        type: protocolOperationType(operation.type, operation.parameters),
        params: { ...operation.parameters, workspaceOperationType: operation.type },
      }), baseDocument);
      const result = await renderWorkspaceParameterPreview(
        original,
        { width: input.width, height: input.height },
        parameterDocumentOperations({ ...input, parameterDocument }),
      );
      setProposalPreview({ proposalId: proposal.proposalId, imageId: proposal.imageId, original, result: result.blob });
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
      if (proposal) { await previewProposal(proposal); return; }
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
  }

  async function rollbackActivityParameterState() {
    if (workspace?.role !== "owner" || !selected || !activityPreview
      || activityPreview.activity.imageId !== selected.imageId
      || activityPreview.activity.eventId === currentCollaborationActivityId) return;
    const {parameterDocument} = activityPreview;
    const commitId = activityPreview.commitId;
    const targetCommit = commits.find((commit)=>commit.commitId===commitId&&commit.imageId===selected.imageId);
    if (!commitId || !targetCommit) {
      setNotice("The selected Activity no longer has a matching Commit");
      return;
    }
    await Promise.all([
      deleteCommitsAfter(selected.imageId,targetCommit.createdAt),
      deleteCollaborationActivitiesAfter(workspace.workspaceId,selected.imageId,activityPreview.activity.createdAt),
    ]);
    setCommits((current)=>current.filter((commit)=>commit.imageId!==selected.imageId||commit.createdAt<=targetCommit.createdAt));
    setActivities((current)=>current.filter((activity)=>activity.imageId!==selected.imageId||activity.createdAt<=activityPreview.activity.createdAt));
    await updateImage(selected.imageId, {currentCommitId:commitId,parameterDocument,state:"shared"});
    await syncCollaborationPreview({...selected,currentCommitId:commitId,parameterDocument,state:"shared"},parameterDocument);
    realtimeRef.current?.send("historyRolledBack", {
      imageId:selected.imageId,commitId,parameterDocument,
      targetCreatedAt:targetCommit.createdAt,
      activityCreatedAt:activityPreview.activity.createdAt,
    }, {delivery:"reliable",dataClass:"collaborationEvent"});
    setActivityPreview(null);
  }

  async function decideProposal(proposal:WorkspaceProposal,state:"approved"|"rejected"|"later",rejectReason?:string){
    const reason=state==="rejected"?(rejectReason?.trim()||"Rejected by Owner"):undefined;
    let approvedCommitId: string | undefined;
    if(state==="approved"){
      const image=images.find((item)=>item.imageId===proposal.imageId);if(!image)return;
      if(image.currentCommitId!==proposal.baseCommitId){setNotice("当前图片已更新。请先同步最新版本后再提交。");return;}
      const parameterDocument=proposal.operations.reduce((document,operation)=>setImageOperation(document,{id:operation.operationId,userId:operation.authorId,time:operation.createdAt,type:protocolOperationType(operation.type,operation.parameters),params:{...operation.parameters,workspaceOperationType:operation.type}}),image.parameterDocument||emptyImageParameterDocument());
      const commit:WorkspaceCommit={commitId:id("commit"),imageId:proposal.imageId,authorId:"owner",parentCommitId:image.currentCommitId,mergeParentCommitIds:[],operations:proposal.operations,createdAt:Date.now()};
      approvedCommitId = commit.commitId;
      await saveCommit(commit);setCommits((current)=>[...current,cachedCommit(commit)]);
      await updateImage(proposal.imageId,{parameterDocument,currentCommitId:commit.commitId,state:"shared"});
      await syncCollaborationPreview({...image,parameterDocument,currentCommitId:commit.commitId,state:"shared"},parameterDocument);
      realtimeRef.current?.send("commitCreated",{commit,parameterDocument},{delivery:"reliable",dataClass:"collaborationEvent"});
      await persistCollaborationActivity(workspace!.workspaceId,"proposalApproved",proposal.imageId,{proposalId:proposal.proposalId,commitId:commit.commitId,operations:proposal.operations.map(({operationId,type,parameters,authorId})=>({operationId,operationType:type,parameters,actorId:authorId})),parameterDocument,status:"approved"},"owner");
    }
    const next={...proposal,state,rejectReason:reason};await saveProposal(next);setProposals((current)=>current.map((item)=>item.proposalId===proposal.proposalId?next:item));realtimeRef.current?.send("proposalDecision",{proposalId:proposal.proposalId,state,reason,commitId:approvedCommitId,operationType:proposal.operations[0]?.type,operations:proposal.operations.map(({operationId,type,parameters,authorId})=>({operationId,operationType:type,parameters,actorId:authorId})),parameterDocument:state==="approved"?imagesRef.current.find((image)=>image.imageId===proposal.imageId)?.parameterDocument:undefined},{route:"user",targetUserId:proposal.authorId,delivery:"reliable"});
    if(state==="rejected")await updateImage(proposal.imageId,{state:"shared"});
    if(state==="rejected")await persistCollaborationActivity(workspace!.workspaceId,"proposalRejected",proposal.imageId,{proposalId:proposal.proposalId,reason,status:"rejected"},"owner");
    if(state==="later")await persistCollaborationActivity(workspace!.workspaceId,"proposalDeferred",proposal.imageId,{proposalId:proposal.proposalId,status:"pending"},"owner");
  }
  async function saveStyle(){if(!workspace||workspace.role!=="owner"||!isValidStyle(styleDraft))return;const style={...styleDraft,revision:workspace.style.revision+1};const next={...workspace,name:style.header.text.content,style,updatedAt:Date.now()};await saveWorkspace(next);setWorkspace(next);setStyleDraft(style);setSettingsOpen(false);realtimeRef.current?.send("styleUpdated",{style},{delivery:"reliable"});}
  function parameterDocumentAtCommit(image: WorkspaceImage, commit: WorkspaceCommit) {
    return commits
      .filter((item) => item.imageId === image.imageId && item.createdAt <= commit.createdAt)
      .sort((left,right)=>left.createdAt-right.createdAt)
      .flatMap((item)=>item.operations)
      .reduce((document,operation)=>setImageOperation(document,{
        id:operation.operationId,userId:operation.authorId,time:operation.createdAt,
        type:protocolOperationType(operation.type,operation.parameters),
        params:{...operation.parameters,workspaceOperationType:operation.type},
      }),emptyImageParameterDocument());
  }
  async function openRollbackTarget(commit: WorkspaceCommit) {
    if (!selected || commit.imageId !== selected.imageId) return;
    setRollbackTarget(commit);
    setRollbackPreview(null);
    try {
      const parameterDocument = parameterDocumentAtCommit(selected, commit);
      const rendered = await renderCollaborationPreviewSnapshot(selected, parameterDocument);
      if (!rendered?.blob.size) throw new Error("Rollback preview is unavailable");
      setRollbackPreview(rendered.blob);
    } catch (error) {
      setRollbackTarget(null);
      setNotice(error instanceof Error ? error.message : "Rollback preview is unavailable");
    }
  }
  function cancelRollbackTarget() {
    setRollbackTarget(null);
    setRollbackPreview(null);
  }
  async function rollbackCommit(commit: WorkspaceCommit) {
    if (workspace?.role !== "owner" || !selected || commit.imageId !== selected.imageId) return;
    const parameterDocument = parameterDocumentAtCommit(selected, commit);
    const targetActivity = selectedCollaborationActivities
      .filter((activity) => {
        const detail = activity.detail && typeof activity.detail === "object"
          ? activity.detail as Record<string, unknown>
          : null;
        return detail?.commitId === commit.commitId;
      })
      .at(-1);
    const activityCreatedAt = targetActivity?.createdAt ?? -1;
    await Promise.all([
      deleteCommitsAfter(selected.imageId,commit.createdAt),
      deleteCollaborationActivitiesAfter(workspace.workspaceId,selected.imageId,activityCreatedAt),
    ]);
    setCommits((current)=>current.filter((item)=>item.imageId!==selected.imageId||item.createdAt<=commit.createdAt));
    setActivities((current)=>current.filter((activity)=>activity.imageId!==selected.imageId||activity.createdAt<=activityCreatedAt));
    await updateImage(selected.imageId, { currentCommitId: commit.commitId, parameterDocument, state: "shared" });
    await syncCollaborationPreview({...selected,currentCommitId:commit.commitId,parameterDocument,state:"shared"},parameterDocument);
    realtimeRef.current?.send("historyRolledBack", {
      imageId: selected.imageId,
      commitId: commit.commitId,
      targetCreatedAt: commit.createdAt,
      activityCreatedAt,
      parameterDocument,
    }, { delivery: "reliable", dataClass: "collaborationEvent" });
    setRollbackTarget(null);
    setRollbackPreview(null);
  }

  async function saveCollaborativeImage() {
    if (!workspace || workspace.role !== "owner" || !selected?.shared || !selected.sourceCached) return;
    setCollaborationSaving(true);
    try {
      const container = await syncCollaborationContainer(selected, selected.parameterDocument || emptyImageParameterDocument());
      if (!container) throw new Error("Source data is unavailable");
      const result = {blob:container.rendered,name:container.name,mimeType:container.mimeType,width:container.width,height:container.height};
      if (collaborationSaveChoice === "copy") {
        await saveProcessedCopy(selected, { ...result, operation: "adjust", parameters: {} } as ProcessedImageResult);
        await persistCollaborationActivity(workspace.workspaceId,"collaborationSaved",selected.imageId,{mode:"copy",commitId:selected.currentCommitId},"owner");
      } else {
        const thumbnail = await generateShareThumbnail(result.blob, 320, 240);
        const preview = new Blob([thumbnail.slice().buffer as ArrayBuffer], { type: "image/webp" });
        const baseline: WorkspaceCommit = {
          commitId: id("commit"), imageId: selected.imageId, authorId: "owner",
          parentCommitId: selected.currentCommitId, mergeParentCommitIds: [], operations: [],
          snapshot: result.blob, snapshotName: result.name, snapshotMimeType: result.mimeType,
          snapshotWidth: result.width, snapshotHeight: result.height, createdAt: Date.now(),
        };
        await saveCommit(baseline);
        setCommits((current) => [...current, cachedCommit(baseline)]);
        await updateImage(selected.imageId, {
          source: result.blob, preview, name: result.name, mimeType: result.mimeType,
          size: result.blob.size, width: result.width, height: result.height,
          currentCommitId: baseline.commitId, parameterDocument: emptyImageParameterDocument(), state: "shared",
        });
        await publishPreview({ ...selected, ...result, size: result.blob.size, currentCommitId: baseline.commitId,
          parameterDocument: emptyImageParameterDocument() }, result.blob);
        realtimeRef.current?.send("commitCreated", { commit: cachedCommit(baseline), parameterDocument: emptyImageParameterDocument() },
          { delivery: "reliable", dataClass: "collaborationEvent" });
        const previous=collaborationContainers.current.get(selected.imageId);if(previous)disposeCollaborationImageContainer(previous);collaborationContainers.current.set(selected.imageId,createCollaborationImageContainer({imageId:selected.imageId,source:result.blob,sourceKind:"source",name:result.name,mimeType:result.mimeType,width:result.width,height:result.height,parameterDocument:emptyImageParameterDocument()}));
        await persistCollaborationActivity(workspace.workspaceId, "collaborationSaved", selected.imageId, { mode: "replace", commitId: baseline.commitId }, "owner");
      }
      setSaveCollaborationOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save collaborative image");
    } finally {
      setCollaborationSaving(false);
    }
  }
  async function rotateSelected(){if(!workspace||!selected)return;if(selected.shared){await createOperation("rotate",{degrees:90});releaseProcessingSource();return;}const source=await loadSource(selected);if(!source)return;const result=await rotateImage(source,selected.name,90);await createOperation("rotate",{degrees:90},result);releaseProcessingSource();}

  const editorSource=selected&&processingSource?.imageId===selected.imageId?processingSource.blob:null;
  const EMPTY_EDITOR_IMAGE_URL="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const previewUrl=React.useMemo(()=>editorSource?URL.createObjectURL(editorSource):null,[editorSource]);
  React.useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
  const editorImage = React.useMemo<RoomImage | null>(() => workspace && selected && processingSource && editorSource && previewUrl ? {
    id: selected.imageId, roomId: workspace.workspaceId, name: selected.name, type: selected.mimeType,
    size: selected.size, blob: editorSource, direction: workspace.role === "owner" ? "sent" : "received",
    rootImageId: selected.imageId, parentImageId: null, ownerId: workspace.role === "owner" ? "owner" : "remote",
    width: processingSource.width, height: processingSource.height, source: workspace.role === "owner" ? "local" : "received",
    operation: "original", version: 1, createdAt: selected.createdAt, updatedAt: selected.updatedAt,
    url: editorPreparing ? EMPTY_EDITOR_IMAGE_URL : previewUrl,
  } : null, [editorPreparing, editorSource, previewUrl, processingSource, selected, workspace]);
  const initialColorAdjustments = React.useMemo<RoomColorAdjustments>(() => {
    const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "color");
    if (!operation) return DEFAULT_COLOR_ADJUSTMENTS;
    const parameters = operation.params as Partial<RoomColorAdjustments>;
    const balance = parameters.balance;
    return {
      ...DEFAULT_COLOR_ADJUSTMENTS,
      ...parameters,
      balance: {
        shadows: {...DEFAULT_COLOR_ADJUSTMENTS.balance.shadows,...balance?.shadows},
        midtones: {...DEFAULT_COLOR_ADJUSTMENTS.balance.midtones,...balance?.midtones},
        highlights: {...DEFAULT_COLOR_ADJUSTMENTS.balance.highlights,...balance?.highlights},
      },
    };
  }, [selected?.parameterDocument]);
  const initialCrop = React.useMemo<NormalizedCrop | undefined>(() => {
    const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "crop");
    if (!operation) return undefined;
    const crop = {
      x:Number(operation.params.x),y:Number(operation.params.y),
      width:Number(operation.params.width),height:Number(operation.params.height),
    };
    return Object.values(crop).every(Number.isFinite)
      && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
      && crop.x + crop.width <= 1 && crop.y + crop.height <= 1 ? crop : undefined;
  }, [selected?.parameterDocument]);
  const initialResize = React.useMemo<{width:number;height:number}|undefined>(() => {
    const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "resize");
    if (!operation) return undefined;
    const size={width:Number(operation.params.width),height:Number(operation.params.height)};
    return Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0?size:undefined;
  }, [selected?.parameterDocument]);
  const initialReviewAnnotations = React.useMemo<ReviewAnnotation[]>(() => {
    const operation = selected?.parameterDocument?.operations.find((candidate) => candidate.type === "draw");
    return Array.isArray(operation?.params.annotations)
      ? operation.params.annotations as ReviewAnnotation[]
      : [];
  }, [selected?.parameterDocument]);
  const labels = React.useMemo(() => getShareRoomLabels(getLang()), []);
  const editorLoadingOverlay = editorPreparing ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/75 backdrop-blur-[1px]" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
        <FiLoader className="h-4 w-4 animate-spin text-[#2f65cf]" />
        <span>Preparing preview...</span>
      </div>
    </div>
  ) : null;
  async function saveProcessedResult(result: ProcessedImageResult) {
    if (!workspace || !selected) return;
    const operationType: WorkspaceOperation["type"] = result.operation === "adjust"
      ? "brightness"
      : result.operation === "compress"
        ? "compression"
        : result.operation === "convert"
          ? "other"
          : result.operation;
    if (selected.shared && ["brightness", "crop", "resize"].includes(operationType)) {
      setEditing(null);
      await createOperation(operationType, result.parameters || {}, {
        blob: result.blob,
        name: result.name,
        mimeType: result.blob.type || selected.mimeType,
        width: result.width,
        height: result.height,
      });
      releaseProcessingSource();
    } else {
      queueProcessedResult(selected, result);
    }
  }
  if(!workspace&&runtime==="unavailable")return <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center"><FiX className="mb-3 h-8 w-8 text-red-500"/><h1 className="text-lg font-semibold text-slate-900">Workspace unavailable</h1><p className="mt-2 max-w-md text-sm text-slate-600">{notice||"The share link is invalid or no longer active."}</p><a href="/workspace" className="mt-5 rounded-md bg-[#2f65cf] px-4 py-2 text-sm text-white">Open my workspace</a></main>;
  if(!workspace)return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><FiRefreshCw className="mr-2 animate-spin"/>Loading workspace</main>;
  if(reviewOpen&&editorImage)return <main className="flex h-screen min-h-0 min-w-0 overflow-hidden"><ReviewWorkspace roomId={workspace.workspaceId} image={editorImage} labels={labels} actorId={workspace.role} role={workspace.role==="owner"?"owner":"guest"} fullscreen={reviewFullscreen} collaborationEnabled={Boolean(selected?.shared)} parameterAction={selected?.shared?(workspace.role==="owner"?"apply":"proposal"):undefined} initialAnnotations={initialReviewAnnotations} onApplyParameters={async(parameters)=>{setReviewOpen(false);releaseProcessingSource();await createOperation("other",{review:true,...parameters});}} shareRecipients={[]} subscribeMessages={subscribeReviewMessages} onSendMessage={sendReviewMessage} onReviewStatusChange={handleReviewStatusChange} onReviewEditingChange={handleReviewEditingChange} onFullscreenChange={setReviewFullscreen} onGenerateImage={async(_source,result)=>{queueProcessedResult(selected!,{...result,operation:"adjust",parameters:{review:true}} as ProcessedImageResult);setReviewOpen(false);return{status:"saved",imageId:selected!.imageId};}} onResolveRejectedImage={async()=>undefined} onBack={()=>{setReviewOpen(false);releaseProcessingSource();}}/>{editorLoadingOverlay}</main>;
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
      <section className={`flex min-w-0 flex-col lg:min-h-0 ${maximizedWorkspaceImage?"overflow-hidden":"p-4 sm:p-6 lg:overflow-auto"}`}>
        {maximizedWorkspaceImage?<div className="flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden bg-white"><header className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 text-slate-800"><div className="min-w-0"><span className="block text-[10px] font-semibold uppercase text-slate-400">Image processing</span><strong className="block truncate text-sm">{maximizedWorkspaceImage.name}</strong></div><button type="button" onClick={()=>setMaximizedImageId(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf]" title="Return to gallery" aria-label="Return to gallery"><FiMinimize2/></button></header><div className="min-h-0 flex-1"><WorkspaceProcessingCanvas image={maximizedWorkspaceImage} role={workspace.role} renderedBlob={maximizedPreviewBlob}/></div></div>:<>
        <div className="mb-[18px] flex items-center justify-between gap-5">
          <div><div className="flex items-center gap-2"><h1 className="text-[21px] font-bold leading-tight text-[#192337]">Gallery</h1><button type="button" onClick={()=>setOperationLogOpen(true)} className="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-[#2f65cf]" title="Operation log"><FiTerminal/>{completeOperationLog.length?<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500"/>:null}</button></div><p className="mt-1 text-[13px] text-[#7b8494]">Images stay on this device until you explicitly share them.</p></div>
          {workspace.role==="owner"?<><button type="button" onClick={()=>inputRef.current?.click()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-[13px] font-bold text-white hover:bg-[#2457bd]"><FiUploadCloud/>Choose images</button><input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event)=>event.target.files&&void addFiles(event.target.files)}/></>:null}
        </div>
        <div className={`grid min-h-[360px] flex-1 overflow-hidden rounded-lg border-2 border-dashed bg-white/80 transition ${dragging?"border-[#2f65cf] bg-blue-50":"border-[#c9d0da]"} ${libraryCollapsed?"sm:grid-cols-[44px_minmax(0,1fr)]":"sm:grid-cols-[240px_minmax(0,1fr)]"}`} onDragEnter={(event)=>{if(workspace.role!=="owner")return;event.preventDefault();setDragging(true);}} onDragOver={(event)=>{if(workspace.role==="owner")event.preventDefault();}} onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}} onDrop={(event)=>{if(workspace.role!=="owner")return;event.preventDefault();setDragging(false);void addFiles(event.dataTransfer.files);}}>
          {libraryCollapsed?<aside className="hidden min-h-0 flex-col items-center border-r border-slate-200 bg-slate-50/80 pt-2 sm:flex"><button type="button" onClick={()=>setLibraryCollapsed(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title="Expand Origin library"><FiChevronRight/></button><button type="button" onClick={()=>workspace.role==="owner"&&inputRef.current?.click()} className="relative mt-2 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title="Origin library"><FiImage/>{libraryImages.length?<span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[#2f65cf] px-1 text-center text-[8px] text-white">{Math.min(libraryImages.length,99)}</span>:null}</button></aside>:<aside className="hidden min-h-0 min-w-0 flex-col border-r border-slate-200 bg-slate-50/80 sm:flex"><div className="flex items-start justify-between border-b border-slate-200 p-3"><div className="min-w-0"><h2 className="text-xs font-semibold text-slate-800">Origin · Library</h2><p className="mt-0.5 text-[10px] leading-4 text-slate-500">Choose an original, then add it to Working</p></div><button type="button" onClick={()=>setLibraryCollapsed(true)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-[#2f65cf]" title="Collapse Origin library"><FiChevronLeft/></button></div><div className="min-h-0 flex-1 overflow-y-auto p-2">{libraryImages.length?libraryImages.map((image)=><WorkspaceLibraryItem key={image.imageId} image={image} role={workspace.role} selected={selectedId===image.imageId} onSelect={()=>setSelectedId(image.imageId)} onAdd={()=>requestMoveImageToWorking(image)} onDelete={()=>requestDeleteImage(image)}/>):workspace.role==="owner"?<button type="button" onClick={()=>inputRef.current?.click()} className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-400 hover:bg-white/70 hover:text-[#2f65cf]"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50"><FiImage/></span><strong className="text-xs text-slate-700">Choose or drop originals</strong><span className="text-[10px]">PNG, JPEG, WebP or AVIF</span></button>:<div className="flex h-full min-h-40 items-center justify-center p-4 text-center text-xs text-slate-400">Origin images stay on the Owner device</div>}</div></aside>}
          <section className="flex min-h-0 min-w-0 flex-col" aria-label="Working and processing images">
            <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 px-4"><div><h2 className="text-xs font-semibold text-slate-800">Working · Processing</h2><p className="mt-0.5 text-[10px] text-slate-500">Process, doodle, and collaborate on selected images</p></div><span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">{workingImages.length}</span></div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {workingImages.length?<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-8 gap-y-4 p-4 sm:pr-8">{workingImagesSorted.map((image)=><WorkspaceGalleryCard key={image.imageId} image={image} role={workspace.role} selected={selectedId===image.imageId} onlinePeers={onlinePeers} requestingSource={requestingSourceIds.has(image.imageId)} renderedBlob={collaborationPreviewFor(image)} onSelect={()=>setSelectedId(image.imageId)} onPin={()=>void updateImage(image.imageId,{pinnedAt:image.pinnedAt?undefined:Date.now()})} onMoveToLibrary={()=>requestDeleteImage(image)} onRequestSource={()=>{setSelectedId(image.imageId);requestSource(image);}} onDownload={()=>void downloadImage(image)} onMaximize={()=>void maximizeCollaborativeImage(image)} onOperation={(operation)=>void openImageOperation(image,operation)}/>)}</div>:<div className="flex min-h-[300px] h-full w-full flex-col items-center justify-center px-6 text-center text-slate-400"><FiArrowRight className="mb-3 h-7 w-7"/><strong className="text-sm text-slate-600">Working is empty</strong><span className="mt-1 text-xs">Add an image from Origin to begin processing.</span></div>}
            </div>
          </section>
        </div>
        </>}
      </section>
      <aside className="border-t border-[#dfe3e8] bg-white lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
        {collaborationOpen?<>
          <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold text-[#26344c]"><FiUsers/><span>Collaboration</span></div><button type="button" onClick={()=>setCollaborationOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><FiX/></button></div></section>
          <section className="border-b border-[#e4e7eb] p-4"><div className="mb-3 text-[11px] font-bold uppercase text-[#778294]">Collaborators</div>{onlineCollaborators.length?onlineCollaborators.map((person)=><div key={person.clientId} className="flex items-center gap-2 py-1.5 text-sm"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{person.displayName.slice(0,2).toUpperCase()}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-slate-800">{person.displayName}</strong><span className="block truncate text-[10px] text-slate-400">{person.currentAction||"Viewing workspace"}</span></span><i className="h-2 w-2 rounded-full bg-emerald-500"/>{workspace.role==="owner"&&person.role==="collaborator"?<button type="button" onClick={()=>removeCollaborator(person)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove collaborator" aria-label={`Remove ${person.displayName}`}><FiX/></button>:null}</div>):<p className="text-xs text-slate-500">No collaborators connected</p>}</section>
          {proposals.length?<section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#778294]"><FiClock/>Pending proposals</div><div className="mt-2 grid gap-1.5">{proposals.slice().reverse().map((proposal)=><div key={proposal.proposalId} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs"><div className="flex items-center justify-between gap-2"><strong className="truncate">{proposal.operations.map((op)=>op.type).join(", ")}</strong><span className="text-[10px] text-slate-500">{proposal.state}</span></div>{workspace.role==="owner"&&["submitted","pending","later","conflict"].includes(proposal.state)?<div className="mt-2 flex flex-wrap gap-1"><button type="button" onClick={()=>void previewProposal(proposal)} className="rounded border bg-white px-2 py-1">Preview</button><button type="button" onClick={()=>void decideProposal(proposal,"approved")} className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">Approve</button><button type="button" onClick={()=>{setRejectingProposal(proposal);setProposalRejectReason("");}} className="rounded bg-red-50 px-2 py-1 text-red-700">Reject</button><button type="button" onClick={()=>void decideProposal(proposal,"later")} className="rounded bg-slate-200 px-2 py-1">Later</button></div>:workspace.role==="collaborator"&&proposal.state==="failed"?<button type="button" onClick={()=>void submitProposal(proposal)} disabled={runtime!=="available"} className="mt-2 rounded border bg-white px-2 py-1 disabled:opacity-40">Retry</button>:null}</div>)}</div></section>:null}
          <section className="border-b border-[#e4e7eb] p-3"><div className="flex gap-2">{["👍","❤️","👀","✅","❗"].map((emoji)=>{const count=reactionCounts[emoji]||0;return <button type="button" key={emoji} disabled={!onlinePeers} onClick={()=>react(emoji)} className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-slate-100 px-1 transition hover:bg-blue-50 disabled:opacity-30"><span>{emoji}</span>{count?<span className="text-[10px] font-bold tabular-nums text-slate-500">+{count}</span>:null}</button>;})}</div></section>
          <section className="flex min-h-[260px] flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-2 text-[11px] font-bold uppercase text-[#778294]">Activity</div><WorkspaceActivityList activities={selectedCollaborationActivities} proposals={proposals} role={workspace.role} originalCommit={selectedOriginalCommit} currentCommitId={selected?.currentCommitId} canRollback={workspace.role==="owner"&&selectedOriginalCommit?.commitId!==selected?.currentCommitId} onActivity={(activity)=>void previewCollaborationActivity(activity)} onOriginal={()=>selectedOriginalCommit&&void openRollbackTarget(selectedOriginalCommit)}/><div className="mb-2 mt-5 text-[11px] font-bold uppercase text-[#778294]">Messages</div>{messages.length?messages.map((item)=><div key={item.id} className="mb-3 text-xs"><strong>{item.actor}</strong><p className="mt-0.5 text-slate-600">{item.text}</p></div>):<p className="text-xs text-slate-400">No messages</p>}</div><div className="flex gap-2 border-t p-3"><input value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&sendMessage()} disabled={!onlinePeers} className="h-9 min-w-0 flex-1 rounded-md border px-3 text-xs" placeholder="Type a message"/><button type="button" onClick={sendMessage} disabled={!onlinePeers||!message.trim()} className="flex h-9 w-9 items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-30"><FiMessageCircle/></button></div></section>
        </>:<>
          <section className="border-b border-[#e4e7eb] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#26344c]"><FiImage/><span>Image information</span></div>
            {selected?<>
              <div className="mt-3 grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3"><div className="h-14 w-14 overflow-hidden rounded-md border bg-slate-100">{selected.shared&&collaborationPreviewFor(selected)?<BlobImageMedia blob={collaborationPreviewFor(selected)!} alt={selected.name} fit="contain"/>:<WorkspaceImageMedia image={selected} role={workspace.role} preferOriginal={workspace.role==="owner"&&selected.workspaceLocation==="working"}/>}</div><div className="min-w-0"><strong className="block truncate text-[13px]">{selected.name}</strong><span className="block text-[11px] text-slate-500">{selected.width} × {selected.height} · {selected.mimeType.replace("image/","").toUpperCase()}</span><span className="block text-[11px] text-slate-500">{bytes(selected.size)}</span></div></div>
              <dl className="mt-3 grid gap-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-500">Created</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Source</dt><dd>{selected.workspaceLocation==="library"?"Library":"Working"}</dd></div>{selected.shared?<div className="flex justify-between gap-3"><dt className="text-slate-500">Current Commit</dt><dd className="max-w-[160px] truncate">{selected.currentCommitId||"Initial"}</dd></div>:null}</dl>
              {!selectedIsLibrary&&!selected.shared&&workspace.role==="owner"?<div className="mt-3 flex gap-2"><button type="button" onClick={()=>void publishImage(selected)} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white"><FiShield/>Start collaboration</button><button type="button" onClick={()=>requestDeleteImage(selected)} className="flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-600" title="Delete image"><FiTrash2/></button></div>:null}
              {selected.shared&&workspace.role==="owner"?<button type="button" onClick={()=>void publishImage(selected)} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border text-xs font-bold text-slate-600"><FiShield/>Stop collaboration</button>:null}
              {selected.shared&&!selected.sourceCached&&workspace.role==="collaborator"?<button type="button" onClick={()=>requestSource(selected)} disabled={runtime!=="available"||requestingSourceIds.has(selected.imageId)} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white disabled:opacity-60">{requestingSourceIds.has(selected.imageId)?<><FiLoader className="animate-spin"/>Requesting source...</>:<><FiDownload/>Request source</>}</button>:null}
            </>:<div className="mt-4 flex flex-col items-center gap-2 py-5 text-center text-xs text-slate-400"><FiImage className="h-6 w-6"/><p>Select an image to inspect it.</p></div>}
          </section>
          {selected?.shared?<>
            <section className="border-b border-[#e4e7eb] p-4"><div className="text-[11px] font-bold uppercase text-[#778294]">Image processing</div><div className="mt-2 grid grid-cols-2 gap-2"><WorkspaceAction icon={<FiCrop/>} label="Crop" disabled={!selected.sourceCached} onClick={()=>void openImageOperation(selected,"crop")}/><WorkspaceAction icon={<FiSliders/>} label="Color" disabled={!selected.sourceCached} onClick={()=>void openImageOperation(selected,"adjust")}/><WorkspaceAction icon={<FiEye/>} label="Doodle" disabled={!selected.sourceCached} onClick={()=>void openImageOperation(selected,"review")}/><WorkspaceAction icon={<FiDownload/>} label="Save image" disabled={workspace.role!=="owner"||!selected.sourceCached} onClick={()=>setSaveCollaborationOpen(true)}/></div></section>
            <section className="border-b border-[#e4e7eb] p-4"><div className="text-[11px] font-bold uppercase text-[#778294]">Activity</div><div className="mt-2"><WorkspaceActivityList activities={selectedCollaborationActivities} proposals={proposals} role={workspace.role} originalCommit={selectedOriginalCommit} currentCommitId={selected.currentCommitId} canRollback={workspace.role==="owner"&&selectedOriginalCommit?.commitId!==selected.currentCommitId} onActivity={(activity)=>void previewCollaborationActivity(activity)} onOriginal={()=>selectedOriginalCommit&&void openRollbackTarget(selectedOriginalCommit)}/></div></section>
            <section className="border-b border-[#e4e7eb] p-4"><div className="text-[11px] font-bold uppercase text-[#778294]">Collaborators</div>{collaborators.filter((person)=>person.online).length?collaborators.filter((person)=>person.online).map((person)=><div key={person.clientId} className="mt-2 flex items-center gap-2 text-xs"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold">{person.displayName.slice(0,2).toUpperCase()}</span><span className="truncate">{person.displayName}</span></div>):<p className="mt-2 text-xs text-slate-400">No collaborators connected</p>}</section>
            {commits.some((commit)=>commit.imageId===selected.imageId)?<section className="p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiClock/><span>History</span></div><div className="mt-3 grid gap-2">{commits.filter((commit)=>commit.imageId===selected.imageId).slice().reverse().map((commit)=><div key={commit.commitId} className="flex items-center justify-between rounded-md border p-2 text-[11px]"><div className="min-w-0"><strong className="block truncate">{commit.commitId===selected.currentCommitId?"Current version":commit.commitId.startsWith("initial_")?"Initial version":commit.operations.map((operation)=>operation.type).join(", ")||"Version"}</strong><span className="text-slate-400">{new Date(commit.createdAt).toLocaleString()}</span></div>{workspace.role==="owner"&&commit.commitId!==selected.currentCommitId?<button type="button" onClick={()=>void openRollbackTarget(commit)} className="ml-2 rounded border px-2 py-1">Rollback</button>:null}</div>)}</div></section>:null}
          </>:null}
          {!selected?.shared?<>
            <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiHardDrive/><span>Workspace overview</span></div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{images.length}</strong><span className="text-[10px] text-slate-500">Images total</span></div><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{workingImages.length}</strong><span className="text-[10px] text-slate-500">In Working</span></div></div><div className="mt-3 flex gap-2 rounded-md bg-emerald-50 p-3 text-emerald-800"><FiShield className="mt-0.5 shrink-0"/><p className="text-[11px] leading-4">Image files and processing history are stored locally on this device.</p></div></section>
            <section className="p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiShare2/><span>Workspace share</span></div>{workspace.role==="owner"?<><p className="mt-3 text-xs leading-5 text-slate-500">Create a permanent link for collaborators. Creating a new link invalidates the previous one.</p>{workspace.shareToken?<button type="button" onClick={()=>void rotateShare()} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border text-xs"><FiRefreshCw/>Create new link</button>:<button type="button" onClick={()=>void createShare()} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white"><FiLink/>Create share link</button>}</>:<p className="mt-3 text-xs leading-5 text-slate-500">Joined with a permanent share link.</p>}</section>
          </>:null}
        </>}
      </aside>
    </div>
    <ImageCropDialog image={editing === "crop" ? editorImage : null} labels={labels} initialCrop={initialCrop} parameterAction={selected?.shared?(workspace.role==="owner"?"apply":"proposal"):undefined} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)} onApplyParameters={async(parameters)=>{setEditing(null);releaseProcessingSource();await createOperation("crop",parameters);}}/>
    <ImageResizeDialog image={editing === "resize" ? editorImage : null} labels={labels} initialSize={initialResize} parameterAction={selected?.shared?(workspace.role==="owner"?"apply":"proposal"):undefined} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)} onApplyParameters={async(parameters)=>{setEditing(null);releaseProcessingSource();await createOperation("resize",parameters);}}/>
    <ImageColorAdjustmentDialog image={editing === "adjust" ? editorImage : null} labels={labels} initialAdjustments={initialColorAdjustments} parameterAction={selected?.shared?(workspace.role==="owner"?"apply":"proposal"):undefined} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)} onApplyParameters={async(parameters)=>{setEditing(null);releaseProcessingSource();await createOperation("brightness",parameters as unknown as Record<string,unknown>);}}/>
    <ImageCompressionDialog image={editing === "compress" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);setCompressingToWorkingImageId(null);releaseProcessingSource();}} onSave={async(_source, result) => {if(compressingToWorkingImage){await saveProcessedCopy(compressingToWorkingImage,result);releaseProcessingSource();return;}await saveProcessedResult(result);}}/>
    <ImageConversionDialog image={editing === "convert" ? editorImage : null} labels={labels} onClose={() => {setEditing(null);releaseProcessingSource();}} onSave={(_source, result) => saveProcessedResult(result)}/>
    {editorLoadingOverlay}
    <CompressionSuggestionDialog open={Boolean(pendingWorkingImage)} weakNetwork={compressionSuggestionWeakNetwork} labels={labels} onCancel={()=>setPendingWorkingImageId(null)} onContinue={()=>{const image=pendingWorkingImage;setPendingWorkingImageId(null);if(image)void moveImageToWorking(image);}} onCompress={()=>{const image=pendingWorkingImage;setPendingWorkingImageId(null);if(image){setCompressingToWorkingImageId(image.imageId);void openImageOperation(image,"compress");}}}/>
    {pendingProcessedResult?<div className="fixed inset-0 z-[98] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&!processedResultSaving&&setPendingProcessedResult(null)}><section className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Save processed image"><header className="flex items-center justify-between border-b px-5 py-4"><div className="min-w-0"><h2 className="text-base font-semibold text-slate-900">Save processed image</h2><p className="mt-0.5 truncate text-xs text-slate-500">{pendingProcessedResult.result.name}</p></div><button type="button" disabled={processedResultSaving} onClick={()=>setPendingProcessedResult(null)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Cancel"><FiX/></button></header><div className="p-5"><div className="aspect-video overflow-hidden rounded-md border bg-slate-100"><BlobImageMedia blob={pendingProcessedResult.result.blob} alt={pendingProcessedResult.result.name}/></div><div className="mt-3 grid grid-cols-2 gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500"><span>{pendingProcessedResult.result.width} × {pendingProcessedResult.result.height}</span><span className="text-right">{bytes(pendingProcessedResult.result.blob.size)}</span></div><p className="mt-3 text-xs leading-5 text-slate-500">Choose where to keep the generated image. The source image will not be changed.</p></div><footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-4"><button type="button" disabled={processedResultSaving} onClick={()=>setPendingProcessedResult(null)} className="h-9 rounded-md border px-4 text-xs font-semibold text-slate-600 disabled:opacity-40">Cancel</button><button type="button" disabled={processedResultSaving} onClick={()=>void confirmProcessedResult("library")} className="flex h-9 items-center gap-2 rounded-md border border-[#2f65cf] px-4 text-xs font-semibold text-[#2f65cf] disabled:opacity-40"><FiHardDrive/>Save to Library</button><button type="button" disabled={processedResultSaving} onClick={()=>void confirmProcessedResult("working")} className="flex h-9 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white disabled:opacity-40"><FiArrowRight/>{processedResultSaving?"Saving...":"Save to Working"}</button></footer></section></div>:null}
    {leaveConfirmOpen?<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setLeaveConfirmOpen(false)}><div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Leave workspace"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-700"><FiUsers/></div><h2 className="mt-4 text-base font-semibold">Leave this workspace?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Leaving disconnects the current collaboration session. Opening Image Workspace from the home page returns to your own workspace.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setLeaveConfirmOpen(false)} className="h-9 rounded-md border px-4 text-sm">Cancel</button><a href="/workspace" className="flex h-9 items-center rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white">Leave workspace</a></div></div></div>:null}
    {removedFromWorkspace?<div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"><div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true" aria-label="Removed from workspace"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600"><FiX/></div><h2 className="mt-4 text-base font-semibold text-slate-900">Removed from workspace</h2><p className="mt-2 text-sm leading-6 text-slate-600">The Owner removed you from this workspace. Your collaboration connection has been closed.</p><div className="mt-5 flex justify-end"><a href="/workspace" className="flex h-9 items-center rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white">Open my workspace</a></div></div></div>:null}
    {proposalPreview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setProposalPreview(null)}><div className="w-full max-w-5xl rounded-md bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Proposal preview</h2><p className="text-xs text-slate-500">{proposalPreview.proposalId}</p></div><button onClick={()=>setProposalPreview(null)} className="flex h-9 w-9 items-center justify-center" aria-label="Close"><FiX/></button></div><div className="grid gap-3 sm:grid-cols-2"><figure><figcaption className="mb-1 text-xs font-semibold text-slate-500">Original</figcaption><div className="aspect-video overflow-hidden rounded-md bg-slate-100"><BlobImageMedia blob={proposalPreview.original} alt="Original image"/></div></figure><figure><figcaption className="mb-1 text-xs font-semibold text-slate-500">Parameter result</figcaption><div className="aspect-video overflow-hidden rounded-md bg-slate-100"><BlobImageMedia blob={proposalPreview.result} alt="Parameter result"/></div></figure></div>{workspace.role==="owner"?<footer className="mt-4 flex justify-end gap-2 border-t pt-4"><button type="button" onClick={()=>{const proposal=proposals.find((item)=>item.proposalId===proposalPreview.proposalId);setProposalPreview(null);if(proposal)void decideProposal(proposal,"rejected");}} className="h-9 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700">Reject</button><button type="button" onClick={()=>{const proposal=proposals.find((item)=>item.proposalId===proposalPreview.proposalId);setProposalPreview(null);if(proposal)void decideProposal(proposal,"approved");}} className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white">Approve</button></footer>:null}</div></div> : null}
    {activityPreview?<div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&void cancelActivityPreview()}><section className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Rollback Activity"><header className="flex items-center justify-between border-b px-5 py-4"><div className="min-w-0"><h2 className="text-base font-semibold text-slate-900">{workspace.role!=="owner"?"Activity preview":activityPreviewIsCurrent?"Current Activity step":"Rollback to this step?"}</h2><p className="mt-0.5 truncate text-xs text-slate-500">{readableActivityName(activityPreview.activity)} · {activityPreview.parameterDocument.operations.length} parameter actions</p></div><button type="button" onClick={()=>void cancelActivityPreview()} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Cancel"><FiX/></button></header><div className="p-5"><div className="aspect-video overflow-hidden rounded-md border bg-slate-100"><BlobImageMedia blob={activityPreview.preview} alt="Activity parameter preview" fit="contain"/></div><p className="mt-3 text-xs leading-5 text-slate-500">{workspace.role!=="owner"?"Only the Owner can roll back Activity history.":activityPreviewIsCurrent?"This is already the current parameter state.":"Confirming removes every parameter action and Activity after this step."}</p></div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={()=>void cancelActivityPreview()} className="h-9 rounded-md border px-4 text-sm">{workspace.role!=="owner"?"Close":"Cancel"}</button>{workspace.role==="owner"?<button type="button" disabled={activityPreviewIsCurrent} onClick={()=>void rollbackActivityParameterState()} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{activityPreviewIsCurrent?"Current step":"Confirm rollback"}</button>:null}</footer></section></div>:null}
    {deletingImage?<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&setDeletingImage(null)}><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-label="Delete image"><h2 className="text-lg font-semibold">Delete image</h2><p className="mt-2 truncate text-sm text-slate-500">{deletingImage.name}</p><div className="mt-4 grid gap-2"><label className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm"><input type="radio" checked={deleteChoice==="library"} onChange={()=>setDeleteChoice("library")}/><span><strong className="block">Return to Library</strong><span className="text-xs text-slate-500">Keep the original on this device.</span></span></label><label className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm"><input type="radio" checked={deleteChoice==="permanent"} onChange={()=>setDeleteChoice("permanent")}/><span><strong className="block">Delete permanently</strong><span className="text-xs text-slate-500">Remove the image and its local history.</span></span></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setDeletingImage(null)} className="h-9 rounded-md border px-4 text-sm">Cancel</button><button type="button" onClick={()=>void confirmDeleteImage()} className="h-9 rounded-md bg-red-600 px-4 text-sm font-semibold text-white">Confirm</button></div></div></div>:null}
    {rollbackTarget?<div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&void cancelRollbackTarget()}><section className="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={workspace.role==="owner"?"Confirm rollback":"Activity preview"}><header className="flex items-center justify-between border-b px-5 py-4"><div className="min-w-0"><h2 className="text-base font-semibold text-slate-900">{workspace.role==="owner"?"Confirm rollback?":"Activity preview"}</h2><p className="mt-0.5 truncate text-xs text-slate-500">Preview of the selected parameter queue</p></div><button type="button" onClick={()=>void cancelRollbackTarget()} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Close"><FiX/></button></header><div className="p-5"><div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-slate-100">{rollbackPreview?<BlobImageMedia blob={rollbackPreview} alt="Activity parameter preview" fit="contain"/>:<FiLoader className="h-6 w-6 animate-spin text-slate-400"/>}</div><p className="mt-3 text-xs leading-5 text-slate-500">{workspace.role==="owner"?"The parameter queue will return to this version. Every later Commit will be removed.":"Only the Owner can roll back Activity history."}</p></div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={()=>void cancelRollbackTarget()} className="h-9 rounded-md border px-4 text-sm">{workspace.role==="owner"?"Cancel":"Close"}</button>{workspace.role==="owner"?<button type="button" disabled={!rollbackPreview} onClick={()=>void rollbackCommit(rollbackTarget)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">Confirm rollback</button>:null}</footer></section></div>:null}
    {saveCollaborationOpen&&selected?.shared?<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event)=>event.target===event.currentTarget&&!collaborationSaving&&setSaveCollaborationOpen(false)}><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-label="Save image"><h2 className="text-lg font-semibold">Save image</h2><p className="mt-2 text-sm text-slate-500">Apply the collaborative parameter history to image pixels.</p><div className="mt-4 grid gap-2"><label className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm"><input type="radio" checked={collaborationSaveChoice==="replace"} onChange={()=>setCollaborationSaveChoice("replace")}/><span><strong className="block">Replace original</strong><span className="text-xs text-slate-500">Write the rendered result back to this collaborative image.</span></span></label><label className="flex cursor-pointer gap-3 rounded-md border p-3 text-sm"><input type="radio" checked={collaborationSaveChoice==="copy"} onChange={()=>setCollaborationSaveChoice("copy")}/><span><strong className="block">Save as new image</strong><span className="text-xs text-slate-500">Create a normal image in Working.</span></span></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={collaborationSaving} onClick={()=>setSaveCollaborationOpen(false)} className="h-9 rounded-md border px-4 text-sm disabled:opacity-40">Cancel</button><button type="button" disabled={collaborationSaving} onClick={()=>void saveCollaborativeImage()} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white disabled:opacity-40">{collaborationSaving?"Saving...":"Save"}</button></div></div></div>:null}
    {sourceRequestDialog ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Source data request</h2><p className="mt-2 text-sm text-slate-600">{String(sourceRequestDialog.requesterName||"Guest")} wants the original data for {images.find((image)=>image.imageId===sourceRequestDialog.imageId)?.name||"this image"}.</p><label className="mt-4 block text-sm">Reject reason (optional)<input value={sourceRejectReason} onChange={(event)=>setSourceRejectReason(event.target.value)} maxLength={240} className="mt-1 h-9 w-full rounded-md border px-3"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={()=>rejectSourceRequest(sourceRequestDialog)} className="h-9 rounded-md border border-red-200 px-4 text-sm text-red-700">Reject</button><button onClick={()=>void acceptSourceRequest(sourceRequestDialog)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-sm text-white">Accept</button></div></div></div>:null}
    {rejectingProposal ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"><h2 className="text-lg font-semibold">Reject proposal</h2><label className="mt-4 block text-sm">Reason<textarea value={proposalRejectReason} onChange={(event)=>setProposalRejectReason(event.target.value)} maxLength={500} rows={4} className="mt-1 w-full rounded-md border p-3"/></label><div className="mt-5 flex justify-end gap-2"><button onClick={()=>setRejectingProposal(null)} className="h-9 rounded-md border px-4 text-sm">Cancel</button><button onClick={()=>{const proposal=rejectingProposal;setRejectingProposal(null);void decideProposal(proposal,"rejected",proposalRejectReason);}} className="h-9 rounded-md bg-red-600 px-4 text-sm text-white">Reject</button></div></div></div>:null}
    <WorkspaceOperationLogDialog open={operationLogOpen} logs={completeOperationLog} onClose={()=>setOperationLogOpen(false)} onClear={async()=>{await clearOperationLogs(workspace.workspaceId);setOperationLogs([]);setActivities([]);}}/>
    {settingsOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}><div className="flex max-h-[calc(100vh-32px)] w-full max-w-[720px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-base font-semibold">Workspace settings</h2><p className="mt-0.5 text-xs text-slate-500">Workspace style editor</p></div><button type="button" onClick={()=>setSettingsOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><FiX/></button></header><div className="grid min-h-0 overflow-y-auto md:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]"><div className="flex min-w-0 flex-col gap-2.5 border-b bg-[#f6f7f9] p-[18px] md:border-b-0 md:border-r"><span className="text-[11px] font-bold text-slate-500">Style preview</span><div className="flex min-h-[94px] min-w-0 flex-col justify-center gap-1 overflow-hidden rounded-md border border-black/10 px-4 py-3" style={headerBackground(styleDraft)}><strong className="truncate" style={{fontFamily:styleDraft.header.text.fontFamily,fontSize:styleDraft.header.text.fontSize,fontWeight:styleDraft.header.text.fontWeight}}>{styleDraft.header.text.content||"Workspace"}</strong><span className="text-[10px] opacity-70">Image Workspace</span></div></div>{workspace.role==="owner"?<fieldset className="grid gap-4 p-[18px] sm:grid-cols-2"><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Header text<input value={styleDraft.header.text.content} maxLength={80} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,content:event.target.value}}}))} className="h-9 rounded-md border bg-white px-3 text-sm font-normal text-slate-800"/></label><div className="grid gap-1.5 sm:col-span-2"><span className="text-[11px] font-bold text-slate-500">Background</span><div className="grid grid-cols-2 rounded-md bg-slate-100 p-1 text-xs"><button type="button" onClick={()=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"solid",color:"#ffffff"},text:{...value.header.text,color:"#273247"}}}))} className={`h-8 rounded ${styleDraft.header.background.type==="solid"?"bg-white font-semibold shadow-sm":"text-slate-500"}`}>Solid</button><button type="button" onClick={()=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"gradient",from:"#17324d",to:"#2f7d66",direction:"right"},text:{...value.header.text,color:"#ffffff"}}}))} className={`h-8 rounded ${styleDraft.header.background.type==="gradient"?"bg-white font-semibold shadow-sm":"text-slate-500"}`}>Gradient</button></div></div>{styleDraft.header.background.type==="solid"?<ColorControl label="Background color" value={styleDraft.header.background.color} onChange={(color)=>setStyleDraft((value)=>({...value,header:{...value.header,background:{type:"solid",color}}}))}/>:<><ColorControl label="Gradient from" value={styleDraft.header.background.from} onChange={(from)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,from}}}:value)}/><ColorControl label="Gradient to" value={styleDraft.header.background.to} onChange={(to)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,to}}}:value)}/><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Gradient direction<select value={styleDraft.header.background.direction} onChange={(event)=>setStyleDraft((value)=>value.header.background.type==="gradient"?{...value,header:{...value.header,background:{...value.header.background,direction:event.target.value as "right"|"down"|"downRight"}}}:value)} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="right">Right</option><option value="down">Down</option><option value="downRight">Down right</option></select></label></>}<ColorControl label="Text color" value={styleDraft.header.text.color} onChange={(color)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,color}}}))}/><label className="grid gap-1.5 text-[11px] font-bold text-slate-500">Font family<select value={styleDraft.header.text.fontFamily} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontFamily:event.target.value as WorkspaceStyle["header"]["text"]["fontFamily"]}}}))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option>Inter</option><option>System</option><option>Serif</option><option>Monospace</option></select></label><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Font size<div className="flex h-9 items-center gap-3"><input type="range" min={12} max={32} value={styleDraft.header.text.fontSize} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontSize:Number(event.target.value)}}}))} className="min-w-0 flex-1 accent-[#2f65cf]"/><output className="w-12 text-right text-xs font-normal text-slate-600">{styleDraft.header.text.fontSize} px</output></div></label><label className="grid gap-1.5 text-[11px] font-bold text-slate-500 sm:col-span-2">Font weight<select value={styleDraft.header.text.fontWeight} onChange={(event)=>setStyleDraft((value)=>({...value,header:{...value.header,text:{...value.header.text,fontWeight:Number(event.target.value) as 400|500|600|700}}}))} className="h-9 rounded-md border bg-white px-2 text-sm font-normal text-slate-800"><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option></select></label></fieldset>:<dl className="grid content-start gap-3 p-[18px] text-sm"><div className="flex justify-between gap-4"><dt className="text-slate-500">Workspace name</dt><dd className="truncate">{workspace.name}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Status</dt><dd>{statusLabel[runtime]}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-500">Workspace ID</dt><dd className="max-w-[220px] truncate">{workspace.workspaceId}</dd></div></dl>}</div><footer className="flex items-center gap-2 border-t px-5 py-3">{workspace.role==="owner"?<><button type="button" onClick={()=>setStyleDraft(defaultWorkspaceStyle())} className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs"><FiRefreshCw/>Reset style</button><span className="flex-1"/><button type="button" onClick={()=>{setStyleDraft(workspace.style);setSettingsOpen(false);}} className="h-9 rounded-md border px-4 text-xs">Cancel</button><button type="button" onClick={()=>void saveStyle()} disabled={!isValidStyle(styleDraft)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white disabled:opacity-40">Save</button></>:<><span className="flex-1"/><button type="button" onClick={()=>setSettingsOpen(false)} className="h-9 rounded-md bg-[#2f65cf] px-4 text-xs font-semibold text-white">Close</button></>}</footer></div></div> : null}
  </main>;
}

type WorkspaceCardOperation = "crop" | "resize" | "adjust" | "compress" | "convert" | "review";

function WorkspaceGalleryCard({image,role,selected,onlinePeers,requestingSource,renderedBlob,onSelect,onPin,onMoveToLibrary,onRequestSource,onDownload,onMaximize,onOperation}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];selected:boolean;onlinePeers:number;requestingSource:boolean;renderedBlob?:Blob;onSelect():void;onPin():void;onMoveToLibrary():void;onRequestSource():void;onDownload():void;onMaximize():void;onOperation(operation:WorkspaceCardOperation):void}) {
  const [menuOpen,setMenuOpen]=React.useState(false);
  const menuButtonRef=React.useRef<HTMLButtonElement>(null);
  const hasSource=Boolean(image.sourceCached);
  return <article className={`relative min-w-0 rounded-md border bg-white transition ${selected?"border-[#2f65cf] shadow-[0_0_0_2px_#2f65cf]":"border-slate-200 hover:border-slate-300"}`}>
    <div className="relative aspect-[5/3] overflow-hidden rounded-t-[5px] bg-slate-100" onClick={onSelect}>
      {renderedBlob
        ? <BlobImageMedia blob={renderedBlob} alt={image.name} fit="cover"/>
        : <WorkspaceImageMedia image={image} role={role} fit="cover" controls preferOriginal={role==="owner"&&!image.shared}/>}
      <button type="button" onClick={(event)=>{event.stopPropagation();onPin();}} className="absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title={image.pinnedAt?"Unpin image":"Pin image"} aria-pressed={Boolean(image.pinnedAt)}>{image.pinnedAt?<TbPinnedFilled className="h-3.5 w-3.5"/>:<TbPinned className="h-3.5 w-3.5"/>}</button>
      {image.shared?<button type="button" onClick={(event)=>{event.stopPropagation();onMaximize();}} className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title="Maximize image" aria-label="Maximize image"><FiMaximize2 className="h-3.5 w-3.5"/></button>:null}
      {role==="owner"&&!image.shared?<button type="button" onClick={(event)=>{event.stopPropagation();onMoveToLibrary();}} className="absolute right-11 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:bg-red-50 hover:text-red-600" title="Delete image"><FiTrash2 className="h-3.5 w-3.5"/></button>:null}
      {hasSource&&!image.shared?<button ref={menuButtonRef} type="button" onClick={(event)=>{event.stopPropagation();setMenuOpen((value)=>!value);}} className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#2f65cf]" title="Image actions" aria-expanded={menuOpen}><FiMoreHorizontal className="h-4 w-4"/></button>:null}
      {menuOpen?<WorkspaceImageActionMenu anchor={menuButtonRef} onClose={()=>setMenuOpen(false)} onOperation={(operation)=>{setMenuOpen(false);onOperation(operation);}}/>:null}
    </div>
    <button type="button" onClick={onSelect} className="block w-full px-3 pt-3 text-left"><div className="flex min-w-0 items-center justify-between gap-2"><strong className="truncate text-sm font-semibold text-slate-800">{image.name}</strong>{image.shared?<span className="inline-flex h-5 shrink-0 items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700">{collaborationStatusLabel()}</span>:null}</div></button>
    <div className="flex min-h-12 items-center justify-between gap-2 px-3 pb-3 pt-1 text-xs text-slate-500"><span className="min-w-0"><span className="block">{bytes(image.size)}</span><span className="block text-[10px] text-slate-400">{image.width} × {image.height}</span></span><span className="flex shrink-0 items-center gap-1.5">{role!=="owner"&&!hasSource?<button type="button" onClick={onRequestSource} disabled={!onlinePeers||requestingSource} className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2f65cf] text-white disabled:opacity-60" title={requestingSource?"Requesting source data":"Request source data"} aria-label={requestingSource?"Requesting source data":"Request source data"}>{requestingSource?<FiLoader className="h-3.5 w-3.5 animate-spin"/>:<FiBookmark className="h-3.5 w-3.5"/>}</button>:null}{hasSource?<button type="button" onClick={onDownload} className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" title="Download"><FiDownload className="h-3.5 w-3.5"/></button>:<button type="button" disabled className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-300" title="Source data unavailable"><FiDownload className="h-3.5 w-3.5"/></button>}</span></div>
  </article>;
}

function WorkspaceImageActionMenu({anchor,onClose,onOperation}:{anchor:React.RefObject<HTMLButtonElement|null>;onClose():void;onOperation(operation:WorkspaceCardOperation):void}) {
  const [position,setPosition]=React.useState<{left:number;top:number}|null>(null);
  React.useLayoutEffect(()=>{
    const update=()=>{
      const rect=anchor.current?.getBoundingClientRect();
      if(!rect)return;
      const width=144,height=208,gap=8,padding=8;
      const preferredLeft=rect.right+gap;
      const left=preferredLeft+width<=window.innerWidth-padding
        ? preferredLeft
        : Math.max(padding,rect.left-width-gap);
      const top=Math.max(padding,Math.min(rect.top,window.innerHeight-height-padding));
      setPosition({left,top});
    };
    update();
    window.addEventListener("resize",update);
    window.addEventListener("scroll",update,true);
    return()=>{window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);};
  },[anchor]);
  return createPortal(<>
    <button type="button" className="fixed inset-0 z-[70] cursor-default" aria-label="Close image actions" onClick={onClose}/>
    <div className="fixed z-[71] grid w-36 gap-0.5 rounded-md border bg-white p-1 shadow-xl" role="menu" style={{left:position?.left??0,top:position?.top??0,visibility:position?"visible":"hidden"}}>
      {([['convert','Convert',<FiRefreshCw key="convert"/>],['compress','Compress',<FiMinimize2 key="compress"/>],['crop','Crop',<FiCrop key="crop"/>],['resize','Resize',<FiMaximize2 key="resize"/>],['adjust','Adjust',<FiSliders key="adjust"/>],['review','Doodle',<FiEye key="review"/>]] as Array<[WorkspaceCardOperation,string,React.ReactNode]>).map(([operation,label,icon])=><button type="button" role="menuitem" key={operation} onClick={()=>onOperation(operation)} className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-[#2f65cf]"><span>{icon}</span><span>{label}</span></button>)}
    </div>
  </>,document.body);
}

function WorkspaceLibraryItem({image,role,selected,onSelect,onAdd,onDelete}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];selected:boolean;onSelect():void;onAdd():void;onDelete():void}) {
  return <article className={`mb-2 grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-white p-1.5 ${selected?"border-[#2f65cf] shadow-[0_0_0_1px_#2f65cf]":"border-slate-200"}`}><button type="button" onClick={onSelect} className="contents text-left"><span className="block h-11 w-[52px] overflow-hidden rounded bg-slate-100"><WorkspaceImageMedia image={image} role={role}/></span><span className="min-w-0 text-left"><strong className="block truncate text-[11px] font-semibold text-slate-700">{image.name}</strong><span className="mt-0.5 block text-[10px] text-slate-400">{bytes(image.size)}</span></span></button><span className="flex flex-col gap-1"><button type="button" onClick={onAdd} className="flex h-7 w-7 items-center justify-center rounded text-[#2f65cf] hover:bg-blue-50" title="Add to Working"><FiArrowRight className="h-3.5 w-3.5"/></button><button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete image"><FiTrash2 className="h-3.5 w-3.5"/></button></span></article>;
}

function activityOperationName(activity: WorkspaceActivity) {
  const detail = activity.detail && typeof activity.detail === "object"
    ? activity.detail as Record<string, unknown>
    : {};
  const direct = detail.operationType;
  if (typeof direct === "string") return direct;
  const operations = Array.isArray(detail.operations) ? detail.operations : [];
  const first = operations[0];
  if (first && typeof first === "object") {
    const value = first as Record<string, unknown>;
    if (typeof value.operationType === "string") return value.operationType;
    if (typeof value.type === "string") return value.type;
  }
  return null;
}

function readableActivityName(activity: WorkspaceActivity) {
  const readable = (value: string) => value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
  const operation = activityOperationName(activity);
  const suffix: Record<string, string> = {
    operationCommitted: "applied",
    proposalSubmitted: "proposal submitted",
    proposalApproved: "proposal approved",
    proposalRejected: "proposal rejected",
    proposalDeferred: "proposal deferred",
    historyRolledBack: "history rolled back",
    collaborationSaved: "image saved",
  };
  return operation
    ? `${readable(operation)} · ${suffix[activity.kind] || readable(activity.kind)}`
    : suffix[activity.kind] ? readable(suffix[activity.kind]) : readable(activity.kind);
}

function proposalIdForActivity(activity: WorkspaceActivity) {
  if (!activity.detail || typeof activity.detail !== "object") return null;
  const proposalId = (activity.detail as Record<string, unknown>).proposalId;
  return typeof proposalId === "string" ? proposalId : null;
}

function ProposalStatusIcon({state}:{state:WorkspaceProposal["state"]}) {
  const properties: Record<WorkspaceProposal["state"], {label:string;className:string;icon:React.ReactNode}> = {
    draft: { label: "Draft", className: "text-slate-400", icon: <FiMoreHorizontal/> },
    submitted: { label: "Submitted", className: "text-blue-500", icon: <FiUploadCloud/> },
    pending: { label: "Pending review", className: "text-amber-500", icon: <FiClock/> },
    approved: { label: "Approved", className: "text-emerald-600", icon: <FiCheck/> },
    rejected: { label: "Rejected", className: "text-red-500", icon: <FiX/> },
    later: { label: "Review later", className: "text-slate-500", icon: <FiClock/> },
    failed: { label: "Send failed", className: "text-red-500", icon: <FiX/> },
    conflict: { label: "Version conflict", className: "text-amber-600", icon: <FiRefreshCw/> },
  };
  const property = properties[state];
  return <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${property.className}`} title={property.label} aria-label={property.label}>{property.icon}</span>;
}

function WorkspaceActivityList({activities,proposals,role,originalCommit,currentCommitId,canRollback,onActivity,onOriginal}:{activities:WorkspaceActivity[];proposals:WorkspaceProposal[];role:WorkspaceIdentity["role"];originalCommit?:WorkspaceCommit;currentCommitId?:string|null;canRollback:boolean;onActivity(activity:WorkspaceActivity):void;onOriginal():void}) {
  if (!activities.length) return <p className="text-xs text-slate-400">No activity yet</p>;
  const approvedCommitIds = new Set(
    activities
      .filter((activity) => activity.kind === "proposalApproved")
      .map((activity) => {
        const detail = activity.detail && typeof activity.detail === "object"
          ? activity.detail as Record<string, unknown>
          : null;
        return typeof detail?.commitId === "string" ? detail.commitId : null;
      })
      .filter((commitId): commitId is string => Boolean(commitId)),
  );
  const approvedOperationIds = new Set(
    proposals
      .filter((proposal) => proposal.state === "approved")
      .flatMap((proposal) => proposal.operations.map((operation) => operation.operationId)),
  );
  const visibleActivities = activities
    .filter((activity) => {
      if (role !== "collaborator" || activity.kind !== "operationCommitted") return true;
      const detail = activity.detail && typeof activity.detail === "object"
        ? activity.detail as Record<string, unknown>
        : null;
      return (typeof detail?.commitId !== "string" || !approvedCommitIds.has(detail.commitId))
        && (typeof detail?.operationId !== "string" || !approvedOperationIds.has(detail.operationId));
    })
    .reduce<WorkspaceActivity[]>((result, activity) => {
      const proposalId = proposalIdForActivity(activity);
      if (!proposalId || !activity.kind.startsWith("proposal")) {
        result.push(activity);
        return result;
      }
      const duplicateIndex = result.findIndex((candidate) =>
        candidate.kind.startsWith("proposal") && proposalIdForActivity(candidate) === proposalId);
      if (duplicateIndex >= 0) result[duplicateIndex] = activity;
      else result.push(activity);
      return result;
    }, []);
  const rawCurrentEventId=currentActivityEventId(activities,currentCommitId);
  let currentEventId=currentActivityEventId(visibleActivities,currentCommitId);
  if (!currentEventId && rawCurrentEventId) {
    const rawCurrent = activities.find((activity) => activity.eventId === rawCurrentEventId);
    const operationId = rawCurrent?.detail && typeof rawCurrent.detail === "object"
      ? (rawCurrent.detail as Record<string, unknown>).operationId
      : null;
    if (typeof operationId === "string") {
      currentEventId = visibleActivities.find((activity) => {
        if (activity.kind !== "proposalApproved") return false;
        const detail = activity.detail && typeof activity.detail === "object"
          ? activity.detail as Record<string, unknown>
          : null;
        const operations = Array.isArray(detail?.operations) ? detail.operations : [];
        const directMatch = operations.some((operation) => operation && typeof operation === "object"
          && (operation as Record<string, unknown>).operationId === operationId);
        if (directMatch) return true;
        const proposalId = typeof detail?.proposalId === "string" ? detail.proposalId : null;
        return Boolean(proposalId && proposals.find((proposal) => proposal.proposalId === proposalId)
          ?.operations.some((operation) => operation.operationId === operationId));
      })?.eventId || null;
    }
  }
  const originalIsCurrent=Boolean(originalCommit&&originalCommit.commitId===currentCommitId);
  const proposalsById = new Map(proposals.map((proposal) => [proposal.proposalId, proposal]));
  return <div className="grid gap-1">
    {visibleActivities.slice(-10).reverse().map((activity)=>{const current=activity.eventId===currentEventId;const proposalId=proposalIdForActivity(activity);const proposal=proposalId?proposalsById.get(proposalId):undefined;const ownProposal=role==="collaborator"&&activity.kind==="proposalSubmitted"&&activity.actorId==="local";const operationLabel=proposal&&activity.kind.startsWith("proposal")&&!activityOperationName(activity)?proposal.operations[0]:undefined;const operationName=operationLabel?.type.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,(character)=>character.toUpperCase());const displayName=operationName?`${operationName} · ${activity.kind==="proposalApproved"?"Proposal approved":activity.kind==="proposalRejected"?"Proposal rejected":activity.kind==="proposalDeferred"?"Proposal deferred":"Proposal submitted"}`:readableActivityName(activity);return <button type="button" key={activity.eventId} disabled={current} onClick={()=>onActivity(activity)} aria-current={current?"step":undefined} className={`flex h-9 min-w-0 items-center gap-2 border-l-2 px-2 text-left text-[11px] ${current?"cursor-default border-[#2f65cf] bg-blue-50":"border-slate-200 hover:border-[#2f65cf] hover:bg-slate-50"}`}><strong className={`min-w-0 flex-1 truncate font-semibold ${current?"text-[#2457bd]":"text-slate-700"}`}>{displayName}</strong>{ownProposal?<span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-600">You</span>:null}{proposal?<ProposalStatusIcon state={proposal.state}/>:null}{current?<span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#2457bd]">Current</span>:<time className="shrink-0 text-[10px] text-slate-400">{new Date(activity.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time>}</button>;})}
    {originalCommit?<button type="button" onClick={onOriginal} disabled={originalIsCurrent} aria-current={originalIsCurrent?"step":undefined} className={`flex h-9 min-w-0 items-center gap-2 border-l-2 px-2 text-left text-[11px] ${originalIsCurrent?"border-[#2f65cf] bg-blue-50":"border-slate-300 hover:border-[#2f65cf] hover:bg-slate-50"} disabled:cursor-default`}><strong className={`min-w-0 flex-1 truncate font-semibold ${originalIsCurrent?"text-[#2457bd]":"text-slate-600"}`}>Original image</strong><span className={`shrink-0 text-[10px] ${originalIsCurrent?"font-bold uppercase text-[#2457bd]":"text-slate-400"}`}>{originalIsCurrent?"Current":canRollback?"Rollback":"Preview"}</span></button>:null}
  </div>;
}

function WorkspaceAction({icon,label,disabled,onClick}:{icon:React.ReactNode;label:string;disabled:boolean;onClick():void}) {
  return <button type="button" onClick={onClick} disabled={disabled} title={label} className="flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-[#dfe3e8] bg-white text-[10px] text-[#526078] hover:border-[#9bb8ec] hover:bg-[#f2f6fd] hover:text-[#2457bd] disabled:cursor-not-allowed disabled:opacity-35"><span className="text-[15px]">{icon}</span><span>{label}</span></button>;
}

function ColorControl({label,value,onChange}:{label:string;value:string;onChange(value:string):void}) {
  return <label className="grid gap-1.5 text-[11px] font-bold text-slate-500"><span>{label}</span><span className="flex h-9 items-center gap-2 rounded-md border bg-white px-2"><input type="color" value={value} onChange={(event)=>onChange(event.target.value)} aria-label={label} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"/><code className="text-[11px] font-normal uppercase text-slate-600">{value}</code></span></label>;
}

function WorkspaceProcessingCanvas({image,role,renderedBlob}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];renderedBlob?:Blob}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{pointerId:number;x:number;y:number;offsetX:number;offsetY:number}|null>(null);
  const [cachedBlob,setCachedBlob] = React.useState<Blob>();
  const [viewport,setViewport] = React.useState({width:0,height:0});
  const [imageSize,setImageSize] = React.useState({width:0,height:0});
  const [zoom,setZoom] = React.useState(1);
  const [offset,setOffset] = React.useState({x:0,y:0});
  const displayBlob = renderedBlob || cachedBlob;
  const displayUrl = useBlobUrl(displayBlob);

  React.useEffect(()=>{
    let active=true;
    setCachedBlob(undefined);
    if(renderedBlob)return()=>{active=false;};
    void (async()=>{
      const blob=image.sourceCached
        ? await readWorkspaceImageSource(image)
        : image.previewCached
          ? await readWorkspaceImagePreview(image)
          : null;
      if(active&&blob)setCachedBlob(blob);
    })();
    return()=>{active=false;};
  },[image.imageId,image.previewCached,image.previewRevision,image.sourceCached,renderedBlob]);

  React.useEffect(()=>{
    setZoom(1);
    setOffset({x:0,y:0});
  },[image.imageId]);

  React.useEffect(()=>{
    const host=hostRef.current;
    if(!host)return;
    const update=()=>setViewport((current)=>{
      const next={width:host.clientWidth,height:host.clientHeight};
      return current.width===next.width&&current.height===next.height?current:next;
    });
    update();
    const observer=new ResizeObserver(update);
    observer.observe(host);
    return()=>observer.disconnect();
  },[]);

  const resetView=()=>{setZoom(1);setOffset({x:0,y:0});};
  const scaleView=(factor:number)=>setZoom((current)=>Math.min(4,Math.max(0.25,current*factor)));
  const fitRatio=imageSize.width&&imageSize.height
    ? Math.min(Math.max(0,viewport.width-64)/imageSize.width,Math.max(0,viewport.height-64)/imageSize.height,1)
    : 0;
  const surfaceSize={width:imageSize.width*fitRatio,height:imageSize.height*fitRatio};

  return <div ref={hostRef} className="relative h-full w-full touch-none overflow-hidden bg-[#dfe5ec] [background-image:linear-gradient(45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(-45deg,rgba(255,255,255,.28)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(255,255,255,.28)_75%),linear-gradient(-45deg,transparent_75%,rgba(255,255,255,.28)_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px] cursor-grab active:cursor-grabbing" onWheel={(event)=>{event.preventDefault();const delta=Math.max(-80,Math.min(80,event.deltaY));scaleView(Math.exp(-delta*0.0025));}} onDoubleClick={resetView} onPointerDown={(event)=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,offsetX:offset.x,offsetY:offset.y};}} onPointerMove={(event)=>{const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;setOffset({x:drag.offsetX+event.clientX-drag.x,y:drag.offsetY+event.clientY-drag.y});}} onPointerUp={(event)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);dragRef.current=null;}} onPointerCancel={()=>{dragRef.current=null;}}>
    {displayUrl?<div className="absolute inset-0 flex items-center justify-center will-change-transform" style={{transform:`translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`}}><div className="relative overflow-hidden bg-white shadow-2xl" style={{width:surfaceSize.width,height:surfaceSize.height,visibility:fitRatio?"visible":"hidden"}}><img src={displayUrl} alt={image.name} draggable={false} onLoad={(event)=>{const next={width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight};setImageSize((current)=>current.width===next.width&&current.height===next.height?current:next);}} className="block h-full w-full select-none object-contain"/></div></div>:<div className="absolute inset-0"><WorkspaceImageMedia image={image} role={role} fit="contain" controls/></div>}
    <div className="absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 text-slate-600 shadow-sm backdrop-blur" onPointerDown={(event)=>event.stopPropagation()} onDoubleClick={(event)=>event.stopPropagation()}>
      <button type="button" onClick={()=>scaleView(1/1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title="Zoom out" aria-label="Zoom out"><FiZoomOut/></button>
      <button type="button" onClick={resetView} className="flex h-7 min-w-12 items-center justify-center rounded px-1 text-[10px] font-semibold tabular-nums hover:bg-slate-100 hover:text-[#2f65cf]" title="Fit image to canvas">{Math.round(zoom*100)}%</button>
      <button type="button" onClick={()=>scaleView(1.2)} className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 hover:text-[#2f65cf]" title="Zoom in" aria-label="Zoom in"><FiZoomIn/></button>
    </div>
  </div>;
}

function WorkspaceImageMedia({image,role,fit="cover",controls=false,preferOriginal=false}:{image:WorkspaceImage;role:WorkspaceIdentity["role"];fit?:"cover"|"contain";controls?:boolean;preferOriginal?:boolean}) {
  const [showPreview,setShowPreview]=React.useState(false);
  const [preview,setPreview]=React.useState<Blob>();
  const [original,setOriginal]=React.useState<Blob>();
  React.useEffect(()=>{let active=true;setPreview(undefined);if(preferOriginal)return()=>{active=false;};void (async()=>{try{let value=image.previewCached?await readWorkspaceImagePreview(image):null;if(!value&&image.sourceCached){const source=await readWorkspaceImageSource(image);if(source){const thumbnail=await generateShareThumbnail(source,320,240);value=new Blob([thumbnail.slice().buffer as ArrayBuffer],{type:"image/webp"});await saveWorkspaceImage({...image,preview:value,previewCached:true});}}if(active&&value)setPreview(value);}catch{/* Keep the placeholder when this browser cannot decode the received source. */}})();return()=>{active=false;};},[image.imageId,image.previewCached,image.previewRevision,image.sourceCached,preferOriginal]);
  React.useEffect(()=>{let active=true;setOriginal(undefined);if(preferOriginal&&image.sourceCached)void readWorkspaceImageSource(image).then((value)=>{if(active&&value)setOriginal(value);});return()=>{active=false;};},[image.imageId,image.sourceCached,preferOriginal]);
  const previewUrl=useBlobUrl(preview);
  const originalUrl=useBlobUrl(original);
  React.useEffect(()=>setShowPreview(false),[image.imageId,image.previewRevision,preview]);
  const stopPreview=React.useCallback(()=>setShowPreview(false),[]);
  return <div className="relative h-full w-full overflow-hidden" style={{background:image.placeholder?.dominantColor}}>
    {role==="owner"&&preferOriginal?(originalUrl?<img src={originalUrl} alt={image.name} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:<div className="flex h-full items-center justify-center text-slate-300"><FiRefreshCw className="h-5 w-5 animate-spin"/></div>):role==="owner"&&previewUrl?<img src={previewUrl} alt={image.name} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:image.placeholder?<RoomImageMedia alt={image.name} placeholder={image.placeholder}/>:previewUrl?<img src={previewUrl} alt={image.name} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:<div className="flex h-full items-center justify-center text-slate-400"><FiImage className="h-8 w-8"/></div>}
    {role!=="owner"&&showPreview&&previewUrl?<img src={previewUrl} alt="" className={`pointer-events-none absolute inset-0 z-[5] h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`} aria-hidden="true"/>:null}
    {role!=="owner"&&controls&&previewUrl?<button type="button" className="absolute bottom-2 left-2 z-10 flex h-7 w-7 touch-none items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-[#2f65cf]" aria-label="Hold to preview" title="Hold to preview" onClick={(event)=>event.stopPropagation()} onContextMenu={(event)=>event.preventDefault()} onPointerDown={(event)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);setShowPreview(true);}} onPointerUp={(event)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);stopPreview();}} onPointerCancel={stopPreview} onKeyDown={(event)=>{if(event.key===" "||event.key==="Enter"){event.preventDefault();setShowPreview(true);}}} onKeyUp={(event)=>{if(event.key===" "||event.key==="Enter")stopPreview();}} onBlur={stopPreview}><FiImage className="h-3.5 w-3.5" aria-hidden="true"/></button>:null}
  </div>;
}

function useBlobUrl(blob?:Blob){const[url,setUrl]=React.useState("");React.useEffect(()=>{if(!blob){setUrl("");return;}const next=URL.createObjectURL(blob);setUrl(next);return()=>URL.revokeObjectURL(next);},[blob]);return url;}

function BlobImageMedia({blob,alt,fit="cover"}:{blob:Blob;alt:string;fit?:"cover"|"contain"}){const url=useBlobUrl(blob);return url?<img src={url} alt={alt} className={`h-full w-full ${fit==="contain"?"object-contain":"object-cover"}`}/>:null;}
