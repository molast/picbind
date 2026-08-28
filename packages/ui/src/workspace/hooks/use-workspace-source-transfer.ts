import React from "react";
import { REALTIME_LIMITS } from "@picbind/shared";
import { SourceTransferRegistry } from "../source-transfer";
import { readWorkspaceImageSource, saveWorkspaceImage } from "../repository";
import type { CollaborationImageContainer } from "../collaboration-image-container";
import type { WorkspaceImage } from "../types";

export function useWorkspaceSourceTransfer({ images, imagesRef, collaborationContainers, sourceRequestDialog, sourceRejectReason, setImages, setNewVersions, setSourceRequestDialog, setSourceRejectReason, setNotice, finishSourceRequest, syncCollaborationPreview, releaseCollaborationContainer, sendRealtime, sendRealtimeBinary, digestBlob, }: {
  images: WorkspaceImage[];
  imagesRef: React.MutableRefObject<WorkspaceImage[]>;
  collaborationContainers: React.MutableRefObject<Map<string, CollaborationImageContainer>>;
  sourceRequestDialog: Record<string, unknown> | null;
  sourceRejectReason: string;
  setImages: React.Dispatch<React.SetStateAction<WorkspaceImage[]>>;
  setNewVersions: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSourceRequestDialog: React.Dispatch<React.SetStateAction<any>>;
  setSourceRejectReason: React.Dispatch<React.SetStateAction<string>>;
  setNotice: (message: string) => void;
  finishSourceRequest: (value: { requestId?: string; eventId?: string; imageId?: string }) => void;
  syncCollaborationPreview: (image: WorkspaceImage, document: any, source?: Blob) => Promise<unknown>;
  releaseCollaborationContainer: (imageId: string) => void;
  sendRealtime: (type: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => void;
  sendRealtimeBinary: (type: string, payload: Record<string, unknown>, bytes: ArrayBuffer, options?: Record<string, unknown>) => void;
  digestBlob: (blob: Blob) => Promise<string>;
}) {
  const transfers = React.useRef(new SourceTransferRegistry());
  const receiveSource = React.useCallback(async (value: Record<string, unknown>) => {
    const requestId = String(value.requestId || "");
    if (value.type === "sourceStart") {
      const started = transfers.current.start({ requestId, imageId: String(value.imageId || ""), mimeType: String(value.mimeType || ""),
        totalChunks: Number(value.totalChunks), totalBytes: Number(value.totalBytes), sha256: String(value.sha256 || ""),
        currentCommitId: typeof value.currentCommitId === "string" ? value.currentCommitId : null });
      if (!started) {
        finishSourceRequest({ requestId });
        setNotice("Received source metadata is invalid");
      } else if (transfers.current.isCompletionPending(requestId)) {
        await receiveSource({ ...value, type: "sourceComplete" });
      }
      return;
    }
    if (value.type === "sourceChunk") {
      const chunk = value.bytes instanceof ArrayBuffer ? value.bytes : ArrayBuffer.isView(value.bytes) ? value.bytes : Array.isArray(value.bytes) ? new Uint8Array(value.bytes.map(Number)) : null;
      if (chunk && !transfers.current.push(requestId, Number(value.index), chunk)) {
        transfers.current.cancel(requestId);
        finishSourceRequest({ requestId });
        setNotice("Received source data exceeded its transfer limits");
        return;
      }
      if (transfers.current.isCompletionPending(requestId)) await receiveSource({ ...value, type: "sourceComplete" });
      return;
    }
    const completed = await transfers.current.complete(requestId);
    if (!completed) {
      if (!transfers.current.has(requestId)) { finishSourceRequest({ requestId }); setNotice("Received source data is incomplete or invalid"); }
      return;
    }
    const image = imagesRef.current.find((candidate) => candidate.imageId === completed.imageId);
    if (!image) return;
    const persisted: WorkspaceImage = { ...image, source: completed.source, sourceCached: true, size: completed.source.size,
      currentCommitId: completed.currentCommitId ?? image.currentCommitId, state: "working", updatedAt: Date.now() };
    await saveWorkspaceImage(persisted);
    const cached = { ...persisted, source: undefined };
    imagesRef.current = imagesRef.current.map((candidate) => candidate.imageId === completed.imageId ? cached : candidate);
    setImages(imagesRef.current);
    finishSourceRequest({ requestId, imageId: completed.imageId });
    setNewVersions((current) => { const next = { ...current }; delete next[completed.imageId]; return next; });
    if (persisted.shared) {
      releaseCollaborationContainer(completed.imageId);
      await syncCollaborationPreview(cached, cached.parameterDocument, completed.source);
    }
  }, [finishSourceRequest, imagesRef, releaseCollaborationContainer, setImages, setNewVersions, setNotice, syncCollaborationPreview]);

  const acceptSourceRequest = React.useCallback(async (value: Record<string, unknown>) => {
    const image = images.find((item) => item.imageId === value.imageId);
    if (!image?.sourceCached || !image.shared) { setSourceRequestDialog(null); return; }
    const source = await readWorkspaceImageSource(image);
    if (!source) { setSourceRequestDialog(null); return; }
    const data = new Uint8Array(await source.arrayBuffer());
    const chunkSize = REALTIME_LIMITS.sourceChunkBytes;
    const total = Math.ceil(data.length / chunkSize);
    const sha256 = await digestBlob(source);
    const targetUserId = String(value.senderId);
    const options = { route: "user", targetUserId, delivery: "reliable", dataClass: "sourceOrCommit" };
    sendRealtime("sourceStart", { requestId: value.requestId, imageId: image.imageId, mimeType: image.mimeType, totalChunks: total,
      totalBytes: data.length, sha256, currentCommitId: image.currentCommitId }, options);
    for (let index = 0; index < total; index++) sendRealtimeBinary("sourceChunk", { requestId: value.requestId, index }, data.slice(index * chunkSize, (index + 1) * chunkSize).buffer as ArrayBuffer, { ...options, delivery: "bulk" });
    sendRealtime("sourceComplete", { requestId: value.requestId }, options);
    setSourceRequestDialog(null); setSourceRejectReason("");
  }, [digestBlob, images, sendRealtime, sendRealtimeBinary, setSourceRejectReason, setSourceRequestDialog]);

  const rejectSourceRequest = React.useCallback((value: Record<string, unknown>) => {
    const reason = sourceRejectReason.trim() || "Rejected by Owner";
    sendRealtime("sourceRejected", { requestId: value.requestId, imageId: value.imageId, reason }, { route: "user", targetUserId: String(value.senderId), delivery: "reliable", dataClass: "collaborationEvent" });
    setSourceRequestDialog(null); setSourceRejectReason("");
  }, [sendRealtime, setSourceRejectReason, setSourceRequestDialog, sourceRejectReason]);

  return { sourceTransfers: transfers, receiveSource, acceptSourceRequest, rejectSourceRequest };
}
