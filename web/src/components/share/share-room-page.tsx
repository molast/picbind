"use client";

import React from "react";
import CreatedRoomDialog from "./created-room-dialog";
import FloatingEmojiLayer from "./floating-emoji-layer";
import ExitRoomDialog from "./exit-room-dialog";
import GalleryWorkspace from "./workspace/gallery-workspace";
import { canReviewRoomImage } from "./workspace/gallery-image-card";
import ReviewWorkspace from "./workspace/review-workspace";
import ImageSourceDialog from "./workspace/image-source-dialog";
import CompressedImagePickerDialog from "./workspace/compressed-image-picker-dialog";
import CompressionSuggestionDialog from "./workspace/compression-suggestion-dialog";
import RoomImagePreviewDialog from "@/components/share/room-image-preview-dialog";
import RoomHeader from "./room-header";
import RoomSidebar from "./room-sidebar";
import TemporaryRoomDock from "./temporary-room-dock";
import HomeCompressLanding from "@/components/home/home-compress-landing";
import { formatBytes } from "./share-room-formatters";
import { getShareRoomLabels } from "./share-room-labels";
import type {
  ActivityItem,
  ConnectionState,
  FloatingEmoji,
  MessageTransportMode,
  RoomDockNotification,
  RoomImage,
} from "./share-room-types";
import { useShareRoomConnection } from "./use-share-room-connection";
import { getLang, type Lang } from "@/locales";
import {
  clearOwnedShareRoom,
  consumeCreatedShareRoomPrompt,
} from "@/utils/share-room";
import {
  closeRealtimeRoom,
  kickRealtimeRoomMember,
  leaveRealtimeRoom,
  prepareRealtimeImageTransfer,
  confirmRealtimeR2Upload,
  markRealtimeR2Shared,
  type RoomRole,
  type RoomMemberPresence,
} from "@/utils/realtime-room";
import {
  IMAGE_CHUNK_SIZE,
  WEAK_NETWORK_CHUNK_SIZE,
  createImageTransferMeta,
  sendImageDelete,
  sendImageCancel,
  sendImagePlaceholder,
  sendImageFile,
  sendR2ImageAvailable,
  type TransferProgress,
} from "@/utils/realtime-image-transfer";
import {
  deleteRoomImage,
  listRoomImages,
  storeRoomImage,
  type CachedRoomImage,
} from "@/utils/realtime-image-store";
import {
  createPeerMessageId,
  sendPeerMessage,
} from "@/utils/realtime-peer-messages";
import { generateSharePlaceholder } from "@/utils/share-placeholder";
import { uploadFileToR2 } from "@/utils/realtime-r2-transfer";
import {
  type RealtimeMessageChannel,
} from "@/utils/weak-network-socket";
import { queueFilesForCompression } from "@/utils/image-file-store";
import {
  clearRoomPageState,
  loadRoomPageState,
  saveRoomPageState,
} from "@/utils/realtime-room-page-store";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

function readRoomId() {
  const roomIdFromQuery = new URLSearchParams(window.location.search).get(
    "roomId",
  );
  if (roomIdFromQuery !== null) {
    return roomIdFromQuery;
  }
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[0] === "share" ? segments[1] || "" : "";
}

type ShareRoomPageProps = {
  embedded?: boolean;
  minimized?: boolean;
  onMinimize?(): void;
  onRestore?(): void;
};

export default function ShareRoomPage({
  embedded = false,
  minimized,
  onMinimize,
  onRestore,
}: ShareRoomPageProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const activityListRef = React.useRef<HTMLDivElement | null>(null);
  const emojiScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const emojiSequenceRef = React.useRef(0);
  const outgoingChannelRef = React.useRef<RTCDataChannel | null>(null);
  const controlChannelRef = React.useRef<RealtimeMessageChannel | null>(null);
  const instructionChannelRef = React.useRef<RealtimeMessageChannel | null>(null);
  const transferChunkSizeRef = React.useRef(IMAGE_CHUNK_SIZE);
  const maxImageTransferSizeRef = React.useRef(0);
  const weakNetworkTransferRef = React.useRef(false);
  const sessionIdRef = React.useRef<string | null>(null);
  const objectUrlsRef = React.useRef(new Set<string>());
  const imageIdsRef = React.useRef(new Set<string>());
  const deletedImageIdsRef = React.useRef(new Set<string>());
  const imageReadyWaitersRef = React.useRef(
    new Map<string, { resolve(): void; timeoutId: number }>(),
  );
  const imagesRef = React.useRef<RoomImage[]>([]);
  const roomExitHandledRef = React.useRef(false);
  const minimizedRef = React.useRef(false);
  const exitRequestSourceRef = React.useRef<"button" | "history" | null>(null);
  const transferAbortControllersRef = React.useRef(
    new Map<string, AbortController>(),
  );
  const [lang, setLang] = React.useState<Lang>("en");
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");
  const [isShareDialogOpen, setIsShareDialogOpen] = React.useState(false);
  const [role, setRole] = React.useState<RoomRole | null>(null);
  const [connection, setConnection] =
    React.useState<ConnectionState>("waiting");
  const [connectionError, setConnectionError] = React.useState<string | null>(
    null,
  );
  const [networkLatencyMs, setNetworkLatencyMs] = React.useState<number | null>(
    null,
  );
  const [messageTransportMode, setMessageTransportMode] =
    React.useState<MessageTransportMode>("p2p");
  const [packetLossRate, setPacketLossRate] = React.useState<number | null>(null);
  const [maxImageTransferSize, setMaxImageTransferSize] = React.useState<
    number | null
  >(null);
  const [members, setMembers] = React.useState<RoomMemberPresence[]>([]);
  const [activities, setActivities] = React.useState<ActivityItem[]>([]);
  const [images, setImages] = React.useState<RoomImage[]>([]);
  const [previewImageId, setPreviewImageId] = React.useState<string | null>(null);
  const [reviewImageId, setReviewImageId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [isWeakNetwork, setIsWeakNetwork] = React.useState(false);
  const [isSourceDialogOpen, setIsSourceDialogOpen] = React.useState(false);
  const [isCompressedPickerOpen, setIsCompressedPickerOpen] = React.useState(false);
  const [pendingLocalFiles, setPendingLocalFiles] = React.useState<File[] | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [pressedEmoji, setPressedEmoji] = React.useState<string | null>(null);
  const [textMessage, setTextMessage] = React.useState("");
  const [floatingEmojis, setFloatingEmojis] = React.useState<FloatingEmoji[]>([]);
  const [isRoomActionPending, setIsRoomActionPending] = React.useState(false);
  const [isInternallyMinimized, setIsInternallyMinimized] = React.useState(false);
  const [dockNotifications, setDockNotifications] = React.useState<
    RoomDockNotification[]
  >([]);
  const [isExitDialogOpen, setIsExitDialogOpen] = React.useState(false);
  const [isPageStateLoaded, setIsPageStateLoaded] = React.useState(false);
  const [kickingClientId, setKickingClientId] = React.useState<string | null>(
    null,
  );

  const waitUntilImageReady = React.useCallback(
    (id: string) =>
      new Promise<void>((resolve) => {
        const waiters = imageReadyWaitersRef.current;
        const timeoutId = window.setTimeout(() => {
          waiters.delete(id);
          resolve();
        }, 750);
        waiters.set(id, {
          timeoutId,
          resolve: () => {
            window.clearTimeout(timeoutId);
            waiters.delete(id);
            resolve();
          },
        });
      }),
    [],
  );

  const handleWeakNetworkChange = React.useCallback((weakNetwork: boolean) => {
    weakNetworkTransferRef.current = weakNetwork;
    setIsWeakNetwork(weakNetwork);
    transferChunkSizeRef.current = weakNetwork
      ? WEAK_NETWORK_CHUNK_SIZE
      : IMAGE_CHUNK_SIZE;
  }, []);

  const labels = React.useMemo(() => getShareRoomLabels(lang), [lang]);
  const isMinimized = minimized ?? isInternallyMinimized;

  React.useEffect(() => {
    minimizedRef.current = isMinimized;
  }, [isMinimized]);

  const minimizeRoom = React.useCallback(() => {
    minimizedRef.current = true;
    setDockNotifications([]);
    if (onMinimize) {
      onMinimize();
    } else {
      setIsInternallyMinimized(true);
    }
  }, [onMinimize]);

  const restoreRoom = React.useCallback(() => {
    minimizedRef.current = false;
    setDockNotifications([]);
    if (onRestore) {
      onRestore();
    } else {
      setIsInternallyMinimized(false);
    }
  }, [onRestore]);

  const handleIncomingNotification = React.useCallback(
    (notification: RoomDockNotification) => {
      if (!minimizedRef.current) return;
      setDockNotifications((current) => {
        if (current.some((item) => item.id === notification.id)) return current;
        return [...current, notification].slice(-99);
      });
    },
    [],
  );
  const handleForcedNavigation = React.useCallback(() => {
    roomExitHandledRef.current = true;
  }, []);
  const imageWorkspaceLabels = React.useMemo(
    () => getShareRoomLabels(lang, maxImageTransferSize),
    [lang, maxImageTransferSize],
  );

  const validRoomId = Boolean(roomId && ROOM_ID_PATTERN.test(roomId));
  const previewImages = images.filter(
    (image) =>
      !image.previewOnly &&
      !image.placeholderOnly &&
      (image.direction === "sent" ||
        image.transferStatus === "sent" ||
        image.transferStatus === "received"),
  );
  const previewImage =
    previewImages.find((image) => image.id === previewImageId) || null;
  const reviewImage =
    images.find(
      (image) => image.id === reviewImageId && canReviewRoomImage(image),
    ) || null;

  const upsertActivity = React.useCallback((activity: ActivityItem) => {
    setActivities((current) => {
      const index = current.findIndex((item) => item.id === activity.id);
      if (index === -1) {
        return [...current, activity].slice(-60);
      }
      const next = [...current];
      next[index] = { ...next[index], ...activity };
      return next;
    });
  }, []);

  const showFloatingEmoji = React.useCallback((id: string, emoji: string) => {
    const sequence = emojiSequenceRef.current++;
    const direction = sequence % 2 === 0 ? 1 : -1;
    const startX = ((sequence % 5) - 2) * 24;
    const firstBend = direction * (74 + (sequence % 3) * 16);
    const secondBend = direction * -(42 + (sequence % 4) * 13);
    const endX = direction * (18 + (sequence % 3) * 12);
    const path = `path("M 0 0 C ${firstBend} -120 ${secondBend} -310 ${endX} -520")`;
    const item = {
      id,
      emoji,
      startX,
      path,
      duration: 3200 + (sequence % 3) * 180,
    };
    setFloatingEmojis((current) => [...current, item].slice(-60));
    window.setTimeout(() => {
      setFloatingEmojis((current) =>
        current.filter((item) => item.id !== id),
      );
    }, item.duration + 150);
  }, []);

  React.useEffect(() => {
    const list = activityListRef.current;
    if (!list) return;
    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activities]);

  React.useEffect(() => {
    const scroller = emojiScrollerRef.current;
    if (!scroller) return;
    const handleWheel = (event: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
      const nextScrollLeft = Math.max(
        0,
        Math.min(maxScrollLeft, scroller.scrollLeft + delta),
      );
      if (nextScrollLeft !== scroller.scrollLeft) {
        scroller.scrollLeft = nextScrollLeft;
        event.preventDefault();
      }
    };
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, []);

  const addRoomImage = React.useCallback((image: CachedRoomImage) => {
    const normalized: CachedRoomImage = {
      ...image,
      transferStatus:
        image.transferStatus ||
        (image.direction === "sent" ? "sent" : "received"),
      progress:
        image.progress ??
        (image.direction === "sent" || image.direction === "received" ? 1 : 0),
    };
    const url = URL.createObjectURL(image.blob);
    objectUrlsRef.current.add(url);
    const nextImage = { ...normalized, url };
    const existingIndex = imagesRef.current.findIndex(
      (current) => current.id === image.id,
    );
    let next: RoomImage[];
    if (existingIndex === -1) {
      imageIdsRef.current.add(image.id);
      next = [...imagesRef.current, nextImage];
    } else {
      const existing = imagesRef.current[existingIndex];
      URL.revokeObjectURL(existing.url);
      objectUrlsRef.current.delete(existing.url);
      next = [...imagesRef.current];
      next[existingIndex] = nextImage;
    }
    imagesRef.current = next;
    setImages(next);
  }, []);

  const updateRoomImage = React.useCallback(
    (
      id: string,
      patch: Partial<Omit<RoomImage, "id" | "url">>,
      persist = false,
    ) => {
      const index = imagesRef.current.findIndex((image) => image.id === id);
      if (index === -1) {
        return;
      }
      const next = [...imagesRef.current];
      next[index] = { ...next[index], ...patch };
      imagesRef.current = next;
      setImages(next);
      if (persist) {
        const { url: _url, ...cached } = next[index];
        void storeRoomImage(cached).catch((error) => {
          console.warn("Failed to persist image transfer state", error);
        });
      }
    },
    [],
  );

  const removeRoomImage = React.useCallback((id: string) => {
    const image = imagesRef.current.find((current) => current.id === id);
    if (!image) return;
    URL.revokeObjectURL(image.url);
    objectUrlsRef.current.delete(image.url);
    imageIdsRef.current.delete(id);
    const next = imagesRef.current.filter((current) => current.id !== id);
    imagesRef.current = next;
    setImages(next);
    setPreviewImageId((current) => (current === id ? null : current));
    setReviewImageId((current) => (current === id ? null : current));
  }, []);

  React.useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    const imageIds = imageIdsRef.current;
    const deletedImageIds = deletedImageIdsRef.current;
    const transferAbortControllers = transferAbortControllersRef.current;
    setLang(getLang());
    setRoomId(readRoomId());
    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      imageIds.clear();
      deletedImageIds.clear();
      transferAbortControllers.forEach((controller) => controller.abort());
      transferAbortControllers.clear();
      imagesRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    if (
      !roomId ||
      !ROOM_ID_PATTERN.test(roomId) ||
      !consumeCreatedShareRoomPrompt(roomId)
    ) {
      return;
    }
    setShareUrl(window.location.href);
    setIsShareDialogOpen(true);
  }, [roomId]);

  React.useEffect(() => {
    if (!isShareDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsShareDialogOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isShareDialogOpen]);

  React.useEffect(() => {
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) return;
    const state = window.history.state as {
      picbindRoomId?: string;
      picbindRoomEntry?: "base" | "guard";
    } | null;
    if (
      state?.picbindRoomId === roomId &&
      state.picbindRoomEntry === "guard"
    ) {
      return;
    }
    const roomState = {
      ...window.history.state,
      picbindRoomId: roomId,
      picbindRoomEntry: "base" as const,
    };
    window.history.replaceState(roomState, "", window.location.href);
    window.history.pushState(
      { ...roomState, picbindRoomEntry: "guard" },
      "",
      window.location.href,
    );
  }, [roomId]);

  React.useEffect(() => {
    if (!roomId || !role) return;
    const handleHistoryBack = () => {
      if (roomExitHandledRef.current) return;
      const roomState = {
        ...window.history.state,
        picbindRoomId: roomId,
        picbindRoomEntry: "guard" as const,
      };
      window.history.pushState(roomState, "", window.location.href);
      restoreRoom();
      exitRequestSourceRef.current = "history";
      setIsExitDialogOpen(true);
    };
    window.addEventListener("popstate", handleHistoryBack);
    return () => window.removeEventListener("popstate", handleHistoryBack);
  }, [restoreRoom, role, roomId]);

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (roomExitHandledRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  React.useEffect(() => {
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) return;
    setIsPageStateLoaded(false);
    const cached = loadRoomPageState(roomId);
    setActivities(cached?.activities || []);
    setTextMessage(cached?.textMessage || "");
    setReviewImageId(cached?.reviewImageId || null);
    setIsPageStateLoaded(true);
  }, [roomId]);

  React.useEffect(() => {
    if (!roomId || !isPageStateLoaded) return;
    saveRoomPageState(roomId, {
      activities,
      textMessage,
      reviewImageId,
    });
  }, [activities, isPageStateLoaded, reviewImageId, roomId, textMessage]);

  React.useEffect(() => {
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
      return;
    }
    let disposed = false;
    void listRoomImages(roomId)
      .then((cachedImages) => {
        if (!disposed) {
          cachedImages.forEach((cachedImage) => {
            const interrupted =
              cachedImage.transferStatus === "sending" ||
              cachedImage.transferStatus === "receiving" ||
              cachedImage.transferStatus === "awaiting-receipt";
            const restoredImage = interrupted
              ? {
                  ...cachedImage,
                  transferStatus: "failed" as const,
                  progress: 0,
                }
              : cachedImage;
            addRoomImage(restoredImage);
            if (interrupted) {
              void storeRoomImage(restoredImage);
              upsertActivity({
                id: `transfer-${cachedImage.id}`,
                kind: "error",
                title: cachedImage.name,
                detail: labels.transferInterrupted,
                progress: 0,
                createdAt: Date.now(),
              });
            }
          });
        }
      })
      .catch((error) => {
        console.warn("Failed to load cached room images", error);
      });
    return () => {
      disposed = true;
    };
  }, [addRoomImage, labels.transferInterrupted, roomId, upsertActivity]);

  useShareRoomConnection({
    roomId,
    labels,
    controlChannelRef,
    instructionChannelRef,
    outgoingChannelRef,
    transferChunkSizeRef,
    maxImageTransferSizeRef,
    sessionIdRef,
    deletedImageIdsRef,
    imagesRef,
    imageReadyWaitersRef,
    addRoomImage,
    updateRoomImage,
    removeRoomImage,
    upsertActivity,
    showFloatingEmoji,
    onIncomingNotification: handleIncomingNotification,
    onForcedNavigation: handleForcedNavigation,
    onWeakNetworkChange: handleWeakNetworkChange,
    onMessageTransportChange: setMessageTransportMode,
    setPacketLossRate,
    setActivities,
    setConnection,
    setConnectionError,
    setMembers,
    setNetworkLatencyMs,
    setMaxImageTransferSize,
    setRole,
  });

  const updateSendingActivity = React.useCallback(
    (progress: TransferProgress) => {
      updateRoomImage(progress.id, {
        transferStatus: "sending",
        progress: progress.progress,
      });
      upsertActivity({
        id: `transfer-${progress.id}`,
        kind: "sending",
        title: progress.name,
        detail: `${labels.sending} · ${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.size)}`,
        progress: progress.progress,
        createdAt: Date.now(),
      });
    },
    [labels.sending, updateRoomImage, upsertActivity],
  );

  const addFilesToGallery = async (fileList: FileList | File[]) => {
    const channel = instructionChannelRef.current;
    if (connection !== "connected" || channel?.readyState !== "open") {
      upsertActivity({
        id: `error-${Date.now()}`,
        kind: "error",
        title: labels.waiting,
        detail: labels.guestEmpty,
        createdAt: Date.now(),
      });
      return;
    }

    const files = Array.from(fileList);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          upsertActivity({
            id: `error-${Date.now()}-${file.name}`,
            kind: "error",
            title: file.name,
            detail: labels.imageOnly,
            createdAt: Date.now(),
          });
          continue;
        }
        if (file.size > maxImageTransferSizeRef.current) {
          upsertActivity({
            id: `error-${Date.now()}-${file.name}`,
            kind: "error",
            title: file.name,
            detail: imageWorkspaceLabels.tooLarge,
            createdAt: Date.now(),
          });
          continue;
        }

        const meta = createImageTransferMeta(
          file,
          undefined,
          transferChunkSizeRef.current,
        );
        const image: CachedRoomImage = {
          id: meta.id,
          roomId: roomId!,
          name: meta.name,
          type: meta.type,
          size: meta.size,
          blob: file,
          direction: "sent",
          transferStatus: "waiting",
          progress: 0,
          previewOnly: false,
          placeholderOnly: false,
          createdAt: Date.now(),
        };
        addRoomImage(image);
        const initialPersist = storeRoomImage(image).catch((error) => {
          console.warn("Failed to cache pending image", error);
        });
        try {
          const placeholder = await generateSharePlaceholder(file);
          if (
            deletedImageIdsRef.current.has(meta.id) ||
            !imagesRef.current.some((current) => current.id === meta.id)
          ) {
            continue;
          }
          updateRoomImage(meta.id, { placeholder });
          const activeChannel = instructionChannelRef.current;
          if (activeChannel?.readyState !== "open") {
            throw new Error("Image instruction channel is not open");
          }
          sendImagePlaceholder(activeChannel, meta, placeholder);
          await initialPersist;
          if (
            !deletedImageIdsRef.current.has(meta.id) &&
            imagesRef.current.some((current) => current.id === meta.id)
          ) {
            updateRoomImage(meta.id, { placeholder }, true);
          }
        } catch (error) {
          if (!deletedImageIdsRef.current.has(meta.id)) {
            updateRoomImage(meta.id, { transferStatus: "failed" });
            await initialPersist;
            if (imagesRef.current.some((current) => current.id === meta.id)) {
              updateRoomImage(meta.id, { transferStatus: "failed" }, true);
            }
            upsertActivity({
              id: `error-${Date.now()}-${file.name}`,
              kind: "error",
              title: file.name,
              detail:
                error instanceof Error ? error.message : labels.previewFailed,
              createdAt: Date.now(),
            });
          }
        }
      }
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleLocalFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const suggestionThreshold = isWeakNetwork ? 300 * 1024 : 1024 * 1024;
    if (files.some((file) => file.size > suggestionThreshold)) {
      if (inputRef.current) inputRef.current.value = "";
      setPendingLocalFiles(files);
      return;
    }
    void addFilesToGallery(files);
  };

  const goCompressImages = async (files: File[] = []) => {
    if (files.length) await queueFilesForCompression(files);
    if (role === "owner") await handleTemporaryLeave();
    else requestExitRoom();
  };

  const handleSendImage = async (image: RoomImage) => {
    const controlChannel = instructionChannelRef.current;
    const fileChannel = outgoingChannelRef.current;
    if (
      image.direction !== "sent" ||
      image.previewOnly ||
      image.placeholderOnly ||
      !image.placeholder ||
      image.transferStatus === "sending" ||
      isSending ||
      connection !== "connected" ||
      controlChannel?.readyState !== "open"
    ) {
      return;
    }

    const abortController = new AbortController();
    transferAbortControllersRef.current.set(image.id, abortController);
    setIsSending(true);
    updateRoomImage(
      image.id,
      { transferStatus: "sending", progress: 0 },
      true,
    );
    try {
      const file = new File([image.blob], image.name, { type: image.type });
      const transferImage = {
        id: image.id,
        name: image.name,
        type: image.type,
        size: image.size,
      };
      const preparation = await prepareRealtimeImageTransfer(
        roomId!,
        sessionIdRef.current!,
        transferImage,
        networkLatencyMs,
        weakNetworkTransferRef.current,
      );
      updateRoomImage(image.id, { transferMode: preparation.mode }, true);
      abortController.signal.throwIfAborted();
      let meta: ReturnType<typeof createImageTransferMeta>;
      if (preparation.mode === "r2") {
        meta = createImageTransferMeta(
          file,
          image.id,
          transferChunkSizeRef.current,
        );
        await uploadFileToR2(
          preparation.uploadUrl,
          file,
          (progress) => {
            updateSendingActivity({
              ...meta,
              transferredBytes: progress.transferredBytes,
              progress: progress.progress,
            });
          },
          abortController.signal,
        );
        abortController.signal.throwIfAborted();
        const uploaded = await confirmRealtimeR2Upload(
          roomId!,
          sessionIdRef.current!,
          transferImage,
          preparation.objectKey,
        );
        abortController.signal.throwIfAborted();
        await markRealtimeR2Shared(
          roomId!,
          sessionIdRef.current!,
          preparation.objectKey,
        );
        abortController.signal.throwIfAborted();
        sendR2ImageAvailable(
          controlChannel,
          meta,
          preparation.objectKey,
          uploaded.expiresAt,
        );
      } else {
        if (fileChannel?.readyState !== "open") {
          throw new Error("File DataChannel is not open");
        }
        meta = await sendImageFile(
          controlChannel,
          fileChannel,
          file,
          updateSendingActivity,
          image.id,
          transferChunkSizeRef.current,
          waitUntilImageReady,
          abortController.signal,
        );
      }
      updateRoomImage(
        image.id,
        { transferStatus: "awaiting-receipt", progress: 1 },
        true,
      );
      upsertActivity({
        id: `transfer-${meta.id}`,
        kind: "sending",
        title: meta.name,
        detail: `${labels.awaitingReceipt} · ${formatBytes(meta.size)}`,
        progress: 1,
        createdAt: Date.now(),
      });
    } catch (error) {
      const cancelled =
        abortController.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      updateRoomImage(
        image.id,
        { transferStatus: cancelled ? "cancelled" : "failed", progress: 0 },
        true,
      );
      upsertActivity({
        id: `transfer-${image.id}`,
        kind: cancelled ? "cancelled" : "error",
        title: image.name,
        detail: cancelled
          ? labels.transferCancelled
          : error instanceof Error
            ? error.message
            : labels.transferFailed,
        progress: 0,
        createdAt: Date.now(),
      });
    } finally {
      transferAbortControllersRef.current.delete(image.id);
      setIsSending(false);
    }
  };

  const handleCancelTransfer = (image: RoomImage) => {
    transferAbortControllersRef.current.get(image.id)?.abort();
    const channel = instructionChannelRef.current;
    if (channel?.readyState === "open") sendImageCancel(channel, image.id);
  };

  const handleDeleteImage = async (image: RoomImage) => {
    const status = image.transferStatus || "waiting";
    const channel = instructionChannelRef.current;
    if (
      image.direction !== "sent" ||
      (status !== "waiting" && status !== "failed" && status !== "cancelled") ||
      connection !== "connected" ||
      channel?.readyState !== "open"
    ) {
      return;
    }
    sendImageDelete(channel, image.id);
    deletedImageIdsRef.current.add(image.id);
    removeRoomImage(image.id);
    try {
      await deleteRoomImage(image.id);
    } catch (error) {
      console.warn("Failed to delete local pending image", error);
    }
  };

  const handleKickMember = async (targetClientId: string) => {
    const sessionId = sessionIdRef.current;
    if (
      !roomId ||
      role !== "owner" ||
      !sessionId ||
      kickingClientId
    ) {
      return;
    }
    setKickingClientId(targetClientId);
    try {
      await kickRealtimeRoomMember(roomId, sessionId, targetClientId);
      setMembers((current) =>
        current.filter((member) => member.clientId !== targetClientId),
      );
    } catch (error) {
      upsertActivity({
        id: `error-kick-${Date.now()}`,
        kind: "error",
        title: labels.kickMember,
        detail: error instanceof Error ? error.message : labels.failed,
        createdAt: Date.now(),
      });
    } finally {
      setKickingClientId(null);
    }
  };

  const handleTemporaryLeave = () => {
    if (!roomId || !role || isRoomActionPending) return;
    minimizeRoom();
  };

  const requestExitRoom = () => {
    if (!roomId || !role || !sessionIdRef.current || isRoomActionPending) return;
    exitRequestSourceRef.current = "button";
    setIsExitDialogOpen(true);
  };

  const confirmExitRoom = async () => {
    const sessionId = sessionIdRef.current;
    if (!roomId || !role || !sessionId || isRoomActionPending) return;
    setIsRoomActionPending(true);
    try {
      if (role === "owner") {
        await closeRealtimeRoom(roomId, sessionId);
        clearOwnedShareRoom(roomId);
      } else {
        await leaveRealtimeRoom(roomId, sessionId);
      }
      clearRoomPageState(roomId);
      roomExitHandledRef.current = true;
      setIsExitDialogOpen(false);
      if (embedded || exitRequestSourceRef.current === "history") {
        window.history.go(-2);
      } else {
        window.location.assign("/");
      }
    } catch (error) {
      setIsRoomActionPending(false);
      setIsExitDialogOpen(false);
      upsertActivity({
        id: `error-${Date.now()}`,
        kind: "error",
        title: role === "owner" ? labels.closeRoom : labels.back,
        detail: error instanceof Error ? error.message : labels.failed,
        createdAt: Date.now(),
      });
    }
  };

  const handleEmoji = (emoji: string) => {
    if (connection !== "connected") {
      return;
    }
    const id = createPeerMessageId();
    const sent = sendPeerMessage(controlChannelRef.current, {
      type: "EMOJI",
      payload: { id, emoji, sentAt: Date.now() },
    });
    if (!sent) {
      return;
    }
    setPressedEmoji(emoji);
    showFloatingEmoji(`local-${id}`, emoji);
    window.setTimeout(() => {
      setPressedEmoji((current) => (current === emoji ? null : current));
    }, 280);
  };

  const handleTextMessage = () => {
    const text = textMessage.trim().slice(0, 200);
    if (!text || connection !== "connected") return;
    const id = createPeerMessageId();
    if (
      !sendPeerMessage(controlChannelRef.current, {
        type: "TEXT",
        payload: { id, text, sentAt: Date.now() },
      })
    ) {
      return;
    }
    setTextMessage("");
    upsertActivity({
      id: `message-${id}`,
      kind: "message",
      title: text,
      detail: labels.messageSending,
      createdAt: Date.now(),
    });
  };

  const handleReviewImage = (imageId: string) => {
    const image = imagesRef.current.find((current) => current.id === imageId);
    if (!image || !canReviewRoomImage(image)) return;
    setPreviewImageId(null);
    setReviewImageId(imageId);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleClearActivities = () => {
    setActivities([]);
    if (roomId) {
      saveRoomPageState(roomId, {
        activities: [],
        textMessage,
        reviewImageId,
      });
    }
  };

  if (roomId !== null && !validRoomId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <p className="rounded-md bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {labels.invalid}
        </p>
      </main>
    );
  }

  return (
    <>
      {!embedded && isMinimized ? (
        <HomeCompressLanding
          initialLang={lang}
          hasActiveRoom
          onRestoreActiveRoom={restoreRoom}
        />
      ) : null}
      <main
        className={`${isMinimized ? "hidden" : "block"} h-screen overflow-hidden bg-[#eef2f7] text-slate-800`}
      >
      <div className="grid h-full grid-rows-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col">
          <RoomHeader
            role={role}
            roomId={roomId}
            copied={copied}
            actionPending={isRoomActionPending}
            labels={labels}
            onCopy={handleCopy}
            onTemporaryLeave={handleTemporaryLeave}
            onExitRoom={requestExitRoom}
          />
          {reviewImage ? (
            <ReviewWorkspace
              image={reviewImage}
              labels={labels}
              onBack={() => setReviewImageId(null)}
            />
          ) : (
            <GalleryWorkspace
              inputRef={inputRef}
              images={images}
              connection={connection}
              isSending={isSending}
              isDragging={isDragging}
              labels={imageWorkspaceLabels}
              onChooseImages={() => setIsSourceDialogOpen(true)}
              onFiles={handleLocalFiles}
              onDraggingChange={setIsDragging}
              onPreview={setPreviewImageId}
              onReview={handleReviewImage}
              onSend={handleSendImage}
              onCancelTransfer={handleCancelTransfer}
              onDelete={handleDeleteImage}
            />
          )}
        </section>
        <RoomSidebar
          activityListRef={activityListRef}
          emojiScrollerRef={emojiScrollerRef}
          connection={connection}
          connectionError={connectionError}
          networkLatencyMs={networkLatencyMs}
          packetLossRate={packetLossRate}
          messageTransportMode={messageTransportMode}
          roomId={roomId}
          role={role}
          members={members}
          activities={activities}
          kickingClientId={kickingClientId}
          textMessage={textMessage}
          pressedEmoji={pressedEmoji}
          labels={labels}
          onKick={handleKickMember}
          onTextChange={setTextMessage}
          onTextSubmit={handleTextMessage}
          onEmoji={handleEmoji}
          onClearActivities={handleClearActivities}
        />
      </div>
      <CreatedRoomDialog
        open={isShareDialogOpen}
        roomId={roomId}
        shareUrl={shareUrl}
        copied={copied}
        labels={labels}
        onClose={() => setIsShareDialogOpen(false)}
        onCopy={handleCopy}
      />
      <ExitRoomDialog
        open={isExitDialogOpen}
        pending={isRoomActionPending}
        labels={labels}
        onCancel={() => {
          exitRequestSourceRef.current = null;
          setIsExitDialogOpen(false);
        }}
        onConfirm={confirmExitRoom}
      />
      <ImageSourceDialog
        open={isSourceDialogOpen}
        labels={labels}
        onClose={() => setIsSourceDialogOpen(false)}
        onLocal={() => {
          setIsSourceDialogOpen(false);
          window.requestAnimationFrame(() => inputRef.current?.click());
        }}
        onCompressed={() => {
          setIsSourceDialogOpen(false);
          setIsCompressedPickerOpen(true);
        }}
      />
      <CompressedImagePickerDialog
        open={isCompressedPickerOpen}
        labels={labels}
        onClose={() => setIsCompressedPickerOpen(false)}
        onCompress={() => goCompressImages()}
        onSelect={(files) => {
          setIsCompressedPickerOpen(false);
          void addFilesToGallery(files);
        }}
      />
      <CompressionSuggestionDialog
        open={Boolean(pendingLocalFiles)}
        weakNetwork={isWeakNetwork}
        labels={labels}
        onCancel={() => setPendingLocalFiles(null)}
        onContinue={() => {
          const files = pendingLocalFiles || [];
          setPendingLocalFiles(null);
          void addFilesToGallery(files);
        }}
        onCompress={() => {
          const files = pendingLocalFiles || [];
          setPendingLocalFiles(null);
          return goCompressImages(files);
        }}
      />
      {previewImage ? (
        <RoomImagePreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreviewImageId(null);
          }}
          images={previewImages.map((image) => ({
            id: image.id,
            src: image.url,
            name: image.name,
          }))}
          activeId={previewImage.id}
          onActiveChange={setPreviewImageId}
        />
      ) : null}
      <FloatingEmojiLayer items={floatingEmojis} />
      </main>
      {isMinimized && roomId ? (
        <TemporaryRoomDock
          lang={lang}
          roomId={roomId}
          connection={connection}
          notifications={dockNotifications}
          onRestore={restoreRoom}
        />
      ) : null}
    </>
  );
}
