"use client";

import React from "react";
import { getRoomSdkConfig, getRoomShareUrl } from "../../config";
import CreatedRoomDialog from "./created-room-dialog";
import FloatingEmojiLayer from "./floating-emoji-layer";
import ExitRoomDialog from "./exit-room-dialog";
import GalleryWorkspace from "./workspace/gallery-workspace";
import type {
  ProcessedImageAction,
  ProcessedImageActionOutcome,
  ProcessedImageActionStage,
  ProcessedImageResult,
} from "./workspace/image-result-dialog";
import { canReviewRoomImage } from "./workspace/gallery-image-card";
import ReviewWorkspace from "./workspace/review-workspace";
import FullscreenSidebarRail from "./workspace/fullscreen-sidebar-rail";
import ImageSourceDialog from "./workspace/image-source-dialog";
import CompressedImagePickerDialog from "./workspace/compressed-image-picker-dialog";
import CompressionSuggestionDialog from "./workspace/compression-suggestion-dialog";
import RoomImagePreviewDialog from "./room-image-preview-dialog";
import RoomHeader from "./room-header";
import MessagingServiceDialog from "./messaging-service-dialog";
import WeixinChatDialog, { type WeixinChatItem } from "./weixin-chat-dialog";
import WorkerVersionWarning from "./worker-version-warning";
import RoomSidebar from "./room-sidebar";
import TemporaryRoomDock from "./temporary-room-dock";
import { formatBytes } from "./share-room-formatters";
import { getShareRoomLabels } from "./share-room-labels";
import type {
  ActivityItem,
  ConnectionState,
  FloatingEmoji,
  ImageReactionSignal,
  MessageTransportMode,
  RoomDockNotification,
  RoomImage,
} from "./share-room-types";
import { useShareRoomConnection } from "./use-share-room-connection";
import { getLang, type Lang } from "../../locales";
import {
  clearOwnedShareRoom,
  consumeCreatedShareRoomPrompt,
  getShareRoomClientId,
} from "../../utils/share-room";
import {
  closeRealtimeRoom,
  kickRealtimeRoomMember,
  leaveRealtimeRoom,
  prepareRealtimeImageTransfer,
  confirmRealtimeR2Upload,
  markRealtimeR2Shared,
  type RoomRole,
  type RoomMemberPresence,
} from "../../utils/realtime-room";
import {
  IMAGE_CHUNK_SIZE,
  WEAK_NETWORK_CHUNK_SIZE,
  createImageTransferMeta,
  sendImageDelete,
  sendImageCancel,
  sendImagePlaceholder,
  sendImagePlaceholderPending,
  sendImagePlaceholderAck,
  sendImageFile,
  sendR2ImageAvailable,
  type TransferProgress,
} from "../../utils/realtime-image-transfer";
import {
  deleteRoomImage,
  listRoomImageMetadata,
  loadRoomImage,
  storeRoomImage,
  type CachedRoomImage,
  type RoomImageSummary,
} from "../../utils/realtime-image-store";
import {
  createPeerMessageId,
  sendPeerMessage,
} from "../../utils/realtime-peer-messages";
import { generateSharePlaceholder } from "../../utils/share-placeholder";
import { initWasm } from "../../utils/wasm-runtime";
import { identifyImage } from "../../utils/image-object";
import {
  sendImageWorkspaceMessage,
  type ImageReactionBatch,
  type ImageShareRequest,
  type ImageShareResponse,
  type ImageWanted,
} from "../../utils/image-workspace-messages";
import ImageShareRequestDialog from "./workspace/image-share-request-dialog";
import ShareRecipientDialog, {
  getShareRecipientLabel,
  type ShareRecipient,
} from "./workspace/share-recipient-dialog";
import { useRoomTabNotifications } from "./use-room-tab-notifications";
import type { MessagingProviderSnapshot } from "../../messaging";
import type {
  ReviewImageExport,
  ReviewImageExportOutcome,
  ReviewImageExportStage,
} from "../../utils/review-image-export";
import {
  clearOperationLogs,
  listOperationLogs,
  upsertOperationLog,
} from "../../database/repositories/operation-log-repository";
import {
  deleteImageDeliveries,
  listImageDeliveries,
  upsertImageDelivery,
  type ImageDelivery,
  type ImageDeliveryStatus,
} from "../../database/repositories/image-delivery-repository";
import {
  listMessagingImageMetadata,
  readMessagingImage,
  storeMessagingImage,
} from "../../database/repositories/messaging-image-repository";
import { uploadFileToR2 } from "../../utils/realtime-r2-transfer";
import {
  type RealtimeMessageChannel,
} from "../../utils/weak-network-socket";
import { queueFilesForCompression } from "../../utils/image-file-store";
import {
  clearRoomPageState,
  loadRoomPageState,
  saveRoomPageState,
} from "../../utils/realtime-room-page-store";
import {
  sendReviewCollaborationMessage,
  type ReviewCollaborationMessage,
} from "../../utils/review-collaboration";
import {
  deleteReviewHistory,
} from "../../utils/realtime-review-history-store";

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
  const placeholderAckDimensionsRef = React.useRef(new Map<string, string>());
  const imagesRef = React.useRef<RoomImage[]>([]);
  const roomImageLoadsRef = React.useRef(new Set<string>());
  const roomIdRef = React.useRef<string | null>(null);
  const roomExitHandledRef = React.useRef(false);
  const minimizedRef = React.useRef(false);
  const exitRequestSourceRef = React.useRef<"button" | "history" | null>(null);
  const transferAbortControllersRef = React.useRef(
    new Map<string, AbortController>(),
  );
  const outgoingShareRequestsRef = React.useRef(new Map<string, string>());
  const outgoingShareRecipientsRef = React.useRef(new Map<string, ShareRecipient>());
  const outgoingShareDeliveryIdsRef = React.useRef(new Map<string, string>());
  const pendingShareImagesRef = React.useRef(new Map<string, CachedRoomImage>());
  const seenShareRequestsRef = React.useRef(new Set<string>());
  const imageLikeQueueRef = React.useRef(new Map<string, number>());
  const imageLikeFlushTimerRef = React.useRef<number | null>(null);
  const messagingStatusRef = React.useRef(new Map<string, string>());
  const messagingRoomExitStoppedRef = React.useRef(false);
  const flushImageLikeQueueRef = React.useRef<() => void>(() => undefined);
  const [lang, setLang] = React.useState<Lang>("en");
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");
  const [isShareDialogOpen, setIsShareDialogOpen] = React.useState(false);
  const [isMessagingServiceOpen, setIsMessagingServiceOpen] = React.useState(false);
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
  const [operationLogs, setOperationLogs] = React.useState<ActivityItem[]>([]);
  const [imageDeliveries, setImageDeliveries] = React.useState<ImageDelivery[]>([]);
  const imageDeliveriesRef = React.useRef<ImageDelivery[]>([]);
  imageDeliveriesRef.current = imageDeliveries;
  const [recipientDialogImageId, setRecipientDialogImageId] = React.useState<string | null>(null);
  const activeDeliveryIdsRef = React.useRef(new Map<string, string>());
  const [topTip, setTopTip] = React.useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const topTipTimerRef = React.useRef<number | null>(null);
  const [images, setImages] = React.useState<RoomImage[]>([]);
  const [previewImageId, setPreviewImageId] = React.useState<string | null>(null);
  const [reviewImageId, setReviewImageId] = React.useState<string | null>(null);
  const [reviewWorkspaceFullscreen, setReviewWorkspaceFullscreen] =
    React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [isWeakNetwork, setIsWeakNetwork] = React.useState(false);
  const [isSourceDialogOpen, setIsSourceDialogOpen] = React.useState(false);
  const [isCompressedPickerOpen, setIsCompressedPickerOpen] = React.useState(false);
  const [pendingOutboxImage, setPendingOutboxImage] = React.useState<RoomImage | null>(null);
  const [compressionRequest, setCompressionRequest] = React.useState<RoomImage | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [pressedEmoji, setPressedEmoji] = React.useState<string | null>(null);
  const [textMessage, setTextMessage] = React.useState("");
  const [selectedMessageTargetId, setSelectedMessageTargetId] =
    React.useState<string | null>(null);
  const [isShareRecipientDialogOpen, setIsShareRecipientDialogOpen] =
    React.useState(false);
  const shareRecipientResolverRef = React.useRef<
    ((recipient: ShareRecipient | null) => void) | null
  >(null);
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
  const [incomingShareRequest, setIncomingShareRequest] =
    React.useState<ImageShareRequest | null>(null);
  const incomingShareRequestRef = React.useRef<ImageShareRequest | null>(null);
  const [incomingShareThumbnail, setIncomingShareThumbnail] = React.useState<Blob | null>(null);
  const [acceptedShareImage, setAcceptedShareImage] =
    React.useState<{ image: RoomImage; recipient: ShareRecipient } | null>(null);
  const [imageReactionSignals, setImageReactionSignals] = React.useState<
    Record<string, ImageReactionSignal>
  >({});
  const messagingService = React.useMemo(
    () => getRoomSdkConfig().messagingService,
    [],
  );
  const [messagingProviders, setMessagingProviders] = React.useState<
    MessagingProviderSnapshot[]
  >(() => messagingService?.getProviders() || []);
  const [messagingChatProviderId, setMessagingChatProviderId] =
    React.useState<string | null>(null);
  const [messagingChatMessages, setMessagingChatMessages] = React.useState<
    WeixinChatItem[]
  >([]);
  const [messagingUnreadCounts, setMessagingUnreadCounts] = React.useState<
    Record<string, number>
  >({});
  const messagingChatProviderIdRef = React.useRef<string | null>(null);
  const messagingImageLoadsRef = React.useRef(new Set<string>());
  const [isMessagingChatSending, setIsMessagingChatSending] = React.useState(false);
  const appendMessagingChatMessage = React.useCallback((message: WeixinChatItem) => {
    setMessagingChatMessages((current) => {
      const all = [...current, message];
      const removed = all.slice(0, Math.max(0, all.length - 300));
      removed.forEach((item) => {
        if (!item.url) return;
        URL.revokeObjectURL(item.url);
        objectUrlsRef.current.delete(item.url);
      });
      return all.slice(-300);
    });
  }, []);

  React.useEffect(() => {
    messagingChatProviderIdRef.current = messagingChatProviderId;
  }, [messagingChatProviderId]);

  React.useEffect(() => {
    setMessagingUnreadCounts({});
    messagingImageLoadsRef.current.clear();
    messagingChatProviderIdRef.current = null;
    setMessagingChatProviderId(null);
    setMessagingChatMessages((current) => {
      current.forEach((item) => {
        if (!item.url) return;
        URL.revokeObjectURL(item.url);
        objectUrlsRef.current.delete(item.url);
      });
      return [];
    });
    if (!roomId) return;
    let cancelled = false;
    void listMessagingImageMetadata(roomId)
      .then((images) => {
        if (cancelled) return;
        const cachedItems = images.map((image): WeixinChatItem => {
          return {
            id: image.messageId,
            providerId: image.providerId,
            direction: image.direction,
            type: "image",
            fileName: image.fileName,
            mimeType: image.mimeType,
            size: image.size,
            createdAt: image.createdAt,
            status: "sent",
          };
        });
        setMessagingChatMessages((current) => {
          const existing = new Set(
            current.map((item) => `${item.providerId}:${item.id}`),
          );
          const restored = cachedItems.filter((item) => {
            if (!existing.has(`${item.providerId}:${item.id}`)) return true;
            if (item.url) {
              URL.revokeObjectURL(item.url);
              objectUrlsRef.current.delete(item.url);
            }
            return false;
          });
          return [...restored, ...current]
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(-300);
        });
      })
      .catch((error) => {
        console.warn("Failed to restore cached Weixin images", error);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);
  const loadMessagingImage = React.useCallback((item: WeixinChatItem) => {
    if (!roomId || item.type !== "image" || item.blob) return;
    const key = `${item.providerId}:${item.id}`;
    if (messagingImageLoadsRef.current.has(key)) return;
    messagingImageLoadsRef.current.add(key);
    void readMessagingImage(roomId, item.providerId, item.id)
      .then((image) => {
        if (!image) return;
        const url = URL.createObjectURL(image.blob);
        objectUrlsRef.current.add(url);
        setMessagingChatMessages((current) => current.map((message) => {
          if (`${message.providerId}:${message.id}` !== key) return message;
          if (message.url) {
            URL.revokeObjectURL(message.url);
            objectUrlsRef.current.delete(message.url);
          }
          return { ...message, blob: image.blob, url, size: image.size };
        }));
      })
      .catch((error) => {
        console.warn("Failed to load cached Weixin image", error);
      })
      .finally(() => messagingImageLoadsRef.current.delete(key));
  }, [roomId]);
  roomIdRef.current = roomId;
  const reviewMessageSequenceRef = React.useRef(0);
  const pendingReviewMessagesRef = React.useRef<
    Array<{ sequence: number; message: ReviewCollaborationMessage }>
  >([]);
  const reviewMessageListenersRef = React.useRef(
    new Set<
      (message: { sequence: number; message: ReviewCollaborationMessage }) => void
    >(),
  );

  const handleReviewMessage = React.useCallback(
    (message: ReviewCollaborationMessage) => {
      const event = {
        sequence: reviewMessageSequenceRef.current++,
        message,
      };
      if (reviewMessageListenersRef.current.size) {
        reviewMessageListenersRef.current.forEach((listener) => listener(event));
      } else if (message.type === "REVIEW_PRESENCE") {
        pendingReviewMessagesRef.current = [
          ...pendingReviewMessagesRef.current.filter(
            (pending) =>
              pending.message.type !== "REVIEW_PRESENCE" ||
              pending.message.imageId !== message.imageId ||
              pending.message.actorId !== message.actorId,
          ),
          event,
        ].slice(-200);
      }
    },
    [],
  );

  const sendReviewMessage = React.useCallback(
    (message: ReviewCollaborationMessage) =>
      sendReviewCollaborationMessage(instructionChannelRef.current, message),
    [],
  );

  const subscribeReviewMessages = React.useCallback(
    (
      listener: (event: {
        sequence: number;
        message: ReviewCollaborationMessage;
      }) => void,
    ) => {
      reviewMessageListenersRef.current.add(listener);
      const pending = pendingReviewMessagesRef.current;
      pendingReviewMessagesRef.current = [];
      pending.forEach(listener);
      return () => reviewMessageListenersRef.current.delete(listener);
    },
    [],
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
  const notifyInactiveTab = useRoomTabNotifications();

  React.useEffect(() => {
    if (!messagingService) {
      setMessagingProviders([]);
      return;
    }
    const refresh = () => setMessagingProviders(messagingService.getProviders());
    refresh();
    const unsubscribe = messagingService.subscribeStatus(refresh);
    return unsubscribe;
  }, [messagingService]);

  const stopMessagingForRoomExit = React.useCallback(async () => {
    if (!messagingService || messagingRoomExitStoppedRef.current) return;
    messagingRoomExitStoppedRef.current = true;
    try {
      await messagingService.stopProvider("weixin-ilink");
    } catch (error) {
      messagingRoomExitStoppedRef.current = false;
      console.warn("Failed to stop Weixin messaging after leaving the room", error);
    }
  }, [messagingService]);

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
      if (notification.kind === "text" || notification.kind === "emoji") {
        notifyInactiveTab(notification.label);
      }
      if (!minimizedRef.current) return;
      setDockNotifications((current) => {
        if (current.some((item) => item.id === notification.id)) return current;
        return [...current, notification].slice(-99);
      });
    },
    [notifyInactiveTab],
  );
  const handleForcedNavigation = React.useCallback(() => {
    if (roomExitHandledRef.current) return false;
    roomExitHandledRef.current = true;
    return true;
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

  React.useEffect(() => {
    if (!reviewImage) setReviewWorkspaceFullscreen(false);
  }, [reviewImage]);

  const upsertActivity = React.useCallback((activity: ActivityItem) => {
    const update = (current: ActivityItem[], limit: number) => {
      const index = current.findIndex((item) => item.id === activity.id);
      if (index === -1) {
        return [...current, activity].slice(-limit);
      }
      const next = [...current];
      next[index] = { ...next[index], ...activity };
      return next;
    };
    if (activity.id.startsWith("message-")) {
      setActivities((current) => update(current, 60));
      return;
    }
    setOperationLogs((current) => update(current, 500));
    const currentRoomId = roomIdRef.current;
    if (currentRoomId) {
      void upsertOperationLog(currentRoomId, activity).catch((error) => {
        console.warn("Failed to persist room operation log", error);
      });
    }
  }, []);

  const saveImageDelivery = React.useCallback((delivery: ImageDelivery) => {
    const current = imageDeliveriesRef.current;
    const index = current.findIndex((item) => item.id === delivery.id);
    const next = index === -1 ? [...current, delivery] : [...current];
    if (index !== -1) {
      next[index] = delivery;
    }
    imageDeliveriesRef.current = next;
    setImageDeliveries(next);
    void upsertImageDelivery(delivery).catch((error) => {
      console.warn("Failed to persist image delivery", error);
    });
  }, []);

  const patchImageDelivery = React.useCallback((
    deliveryId: string,
    patch: Partial<Pick<ImageDelivery, "status" | "transport" | "error" | "updatedAt" | "deliveredAt">>,
  ) => {
    const delivery = imageDeliveriesRef.current.find((item) => item.id === deliveryId);
    if (!delivery) return;
    const nextDelivery = { ...delivery, ...patch, updatedAt: patch.updatedAt || Date.now() };
    const next = imageDeliveriesRef.current.map((item) => item.id === deliveryId ? nextDelivery : item);
    imageDeliveriesRef.current = next;
    setImageDeliveries(next);
    void upsertImageDelivery(nextDelivery).catch((error) => {
      console.warn("Failed to update image delivery", error);
    });
  }, []);

  const clearImageDeliveries = React.useCallback((targetRoomId: string, imageId: string) => {
    const remaining = imageDeliveriesRef.current.filter(
      (delivery) => delivery.imageId !== imageId,
    );
    imageDeliveriesRef.current = remaining;
    setImageDeliveries(remaining);
    return deleteImageDeliveries(targetRoomId, imageId);
  }, []);

  const latestImageDelivery = React.useCallback(
    (imageId: string, recipientId: string) => imageDeliveriesRef.current
      .filter((delivery) => delivery.imageId === imageId && delivery.recipientId === recipientId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0],
    [],
  );

  const beginImageDelivery = React.useCallback((
    image: RoomImage | CachedRoomImage,
    recipient: ShareRecipient,
    status: Extract<ImageDeliveryStatus, "pending" | "sending"> = "sending",
  ) => {
    if (!roomId) return null;
    const previous = latestImageDelivery(image.id, recipient.id);
    if (previous?.status === "sending") return null;
    if (previous?.status === "pending") {
      if (status === "pending") return null;
      const promoted = { ...previous, status: "sending" as const, updatedAt: Date.now() };
      saveImageDelivery(promoted);
      return promoted;
    }
    const createdAt = Date.now();
    const delivery: ImageDelivery = {
      id: crypto.randomUUID().replace(/-/g, ""),
      roomId,
      imageId: image.id,
      recipientId: recipient.id,
      recipientType: recipient.kind,
      recipientLabel: getShareRecipientLabel(recipient, labels),
      status,
      transport: recipient.kind === "messaging" ? "messaging" : undefined,
      retryCount: previous ? previous.retryCount + 1 : 0,
      createdAt,
      updatedAt: createdAt,
    };
    saveImageDelivery(delivery);
    return delivery;
  }, [labels, latestImageDelivery, roomId, saveImageDelivery]);

  const showTopTip = React.useCallback((message: string, tone: "success" | "error") => {
    setTopTip({ message, tone });
    if (topTipTimerRef.current !== null) {
      window.clearTimeout(topTipTimerRef.current);
    }
    topTipTimerRef.current = window.setTimeout(() => {
      topTipTimerRef.current = null;
      setTopTip(null);
    }, 3000);
  }, []);
  const showSuccessTip = React.useCallback(
    (message: string) => showTopTip(message, "success"),
    [showTopTip],
  );
  const showErrorTip = React.useCallback(
    (message: string) => showTopTip(message, "error"),
    [showTopTip],
  );

  React.useEffect(() => () => {
    if (topTipTimerRef.current !== null) {
      window.clearTimeout(topTipTimerRef.current);
    }
  }, []);

  const handleTransferSuccess = React.useCallback(
    (
      direction: "sent" | "received",
      name: string,
      imageId: string,
      receiptDeliveryId?: string,
    ) => {
      if (direction === "sent") {
        const deliveryId = receiptDeliveryId || activeDeliveryIdsRef.current.get(imageId);
        const delivery = deliveryId
          ? imageDeliveriesRef.current.find((item) => item.id === deliveryId)
          : undefined;
        if (deliveryId) {
          patchImageDelivery(deliveryId, {
            status: "delivered",
            deliveredAt: Date.now(),
          });
          activeDeliveryIdsRef.current.delete(imageId);
        }
        if (delivery) {
          const image = imagesRef.current.find((item) => item.id === imageId);
          const transport = image?.transferMode === "r2" ? labels.r2Mode : labels.p2pMode;
          upsertActivity({
            id: `transfer-${imageId}`,
            kind: "complete",
            title: name,
            detail: `${labels.complete} · ${delivery.recipientLabel} · ${transport}`,
            progress: 1,
            createdAt: Date.now(),
          });
        }
      }
      showSuccessTip(
        direction === "sent"
          ? labels.imageSentTip(name)
          : labels.imageReceivedTip(name),
      );
    },
    [labels, patchImageDelivery, showSuccessTip, upsertActivity],
  );

  React.useEffect(() => {
    const previous = messagingStatusRef.current;
    messagingProviders.forEach((provider) => {
      if (
        provider.status === "connected" &&
        previous.get(provider.id) !== "connected"
      ) {
        upsertActivity({
          id: `messaging-connected-${provider.id}-${Date.now()}`,
          kind: "connection",
          title: labels.messagingConnectionLogTitle,
          detail: `${provider.displayName} · ${labels.messagingConnectionLogDetail}`,
          createdAt: Date.now(),
        });
      }
    });
    messagingStatusRef.current = new Map(
      messagingProviders.map((provider) => [provider.id, provider.status]),
    );
  }, [labels.messagingConnectionLogDetail, labels.messagingConnectionLogTitle, messagingProviders, upsertActivity]);

  React.useEffect(() => {
    const currentClientId = roomId ? getShareRoomClientId(roomId) : null;
    const targets = [
      ...members
        .filter(
          (member) =>
            member.status === "online" && member.clientId !== currentClientId,
        )
        .map((member) => `room:${member.clientId}`),
    ];
    setSelectedMessageTargetId((current) => {
      if (current && targets.includes(current)) return current;
      return targets.length === 1 ? targets[0] : null;
    });
  }, [members, roomId]);

  React.useEffect(() => {
    if (!messagingService || !roomId) return;
    let active = true;
    const unsubscribe = messagingService.subscribe((message) => {
      const provider = messagingService
        .getProviders()
        .find((candidate) => candidate.channel === message.channel);
      const providerId = provider?.id || message.channel;
      const title = message.payload.text || message.payload.fileName || labels.messagingImage;
      if (message.type === "text") {
        upsertActivity({
          id: `message-${provider?.id || message.channel}-${message.id}`,
          kind: "message",
          title,
          detail: `${labels.messageReceived} · ${provider?.displayName || message.channel}`,
          createdAt: message.timestamp || Date.now(),
        });
      } else {
        upsertActivity({
          id: `messaging-received-${provider?.id || message.channel}-${message.id}`,
          kind: "receiving",
          title,
          detail: provider?.displayName || message.channel,
          createdAt: message.timestamp || Date.now(),
        });
      }
      const chatItem: WeixinChatItem = {
        id: message.id,
        providerId,
        direction: "incoming",
        type: message.type === "image" ? "image" : "text",
        text: message.payload.text,
        fileName: message.payload.fileName,
        mimeType: message.payload.mimeType,
        size: message.payload.size,
        createdAt: message.timestamp || Date.now(),
        status: "sent",
      };
      if (messagingChatProviderIdRef.current !== providerId) {
        setMessagingUnreadCounts((current) => ({
          ...current,
          [providerId]: Math.min(999, (current[providerId] || 0) + 1),
        }));
      }
      appendMessagingChatMessage(chatItem);
      const downloadReference = message.payload.downloadUrl || message.payload.fileId;
      if (message.type === "image" && downloadReference && provider) {
        void messagingService.download(
          provider.id,
          downloadReference,
          message.payload.fileId,
        ).then(async (blob) => {
          await storeMessagingImage({
            roomId,
            providerId,
            messageId: message.id,
            fileName: message.payload.fileName || labels.messagingImage,
            mimeType: blob.type || message.payload.mimeType || "image/jpeg",
            size: blob.size,
            createdAt: message.timestamp || Date.now(),
            direction: "incoming",
            blob,
          }).catch((error) => {
            console.warn("Failed to cache Weixin image", error);
          });
          if (!active) return;
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.add(url);
          setMessagingChatMessages((current) => current.map((item) =>
            item.id === message.id ? { ...item, blob, url, size: blob.size, mimeType: blob.type || item.mimeType } : item,
          ));
        }).catch((error) => {
          console.warn("Failed to download Weixin image", error);
          if (!active) return;
          setMessagingChatMessages((current) => current.map((item) =>
            item.id === message.id ? { ...item, status: "error" } : item,
          ));
        });
      }
      notifyInactiveTab(title);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [appendMessagingChatMessage, labels.messageReceived, labels.messagingImage, messagingService, notifyInactiveTab, roomId, upsertActivity]);

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
    const blob = image.blob instanceof Blob
      ? image.blob
      : image.placeholderOnly
        ? new Blob([], { type: image.type })
        : null;
    if (!blob) {
      console.warn("Ignored room image with invalid binary payload", image.id);
      return;
    }
    const thumbnail = image.thumbnail instanceof Blob
      ? image.thumbnail
      : undefined;
    const normalized: CachedRoomImage = {
      ...image,
      blob,
      thumbnail,
      transferStatus:
        image.transferStatus ||
        (image.direction === "sent" ? "sent" : "received"),
      progress:
        image.progress ??
        (image.direction === "sent" || image.direction === "received" ? 1 : 0),
    };
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    const thumbnailUrl = thumbnail
      ? URL.createObjectURL(thumbnail)
      : undefined;
    if (thumbnailUrl) objectUrlsRef.current.add(thumbnailUrl);
    const nextImage = { ...normalized, url, thumbnailUrl };
    const existingIndex = imagesRef.current.findIndex(
      (current) => current.id === image.id,
    );
    let next: RoomImage[];
    if (existingIndex === -1) {
      imageIdsRef.current.add(image.id);
      next = [nextImage, ...imagesRef.current];
    } else {
      const existing = imagesRef.current[existingIndex];
      URL.revokeObjectURL(existing.url);
      objectUrlsRef.current.delete(existing.url);
      if (existing.thumbnailUrl) {
        URL.revokeObjectURL(existing.thumbnailUrl);
        objectUrlsRef.current.delete(existing.thumbnailUrl);
      }
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
      const current = next[index];
      let thumbnailUrl = current.thumbnailUrl;
      if ("thumbnail" in patch) {
        if (thumbnailUrl) {
          URL.revokeObjectURL(thumbnailUrl);
          objectUrlsRef.current.delete(thumbnailUrl);
        }
        thumbnailUrl = patch.thumbnail
          ? URL.createObjectURL(patch.thumbnail)
          : undefined;
        if (thumbnailUrl) objectUrlsRef.current.add(thumbnailUrl);
      }
      const locationChanged =
        patch.workspaceLocation !== undefined &&
        patch.workspaceLocation !== current.workspaceLocation;
      const updated = {
        ...current,
        ...patch,
        ...(locationChanged && patch.updatedAt === undefined
          ? { updatedAt: Date.now() }
          : {}),
        thumbnailUrl,
      };
      if (locationChanged) {
        next.splice(index, 1);
        next.unshift(updated);
      } else {
        next[index] = updated;
      }
      imagesRef.current = next;
      setImages(next);
      if (persist) {
        const { url: _url, thumbnailUrl: _thumbnailUrl, ...cached } = updated;
        void storeRoomImage(cached).catch((error) => {
          console.warn("Failed to persist image transfer state", error);
        });
      }
    },
    [],
  );
  const hydrateRoomImage = React.useCallback((image: RoomImage) => {
    if (!roomId || !image.previewOnly || roomImageLoadsRef.current.has(image.id)) return;
    roomImageLoadsRef.current.add(image.id);
    void loadRoomImage(roomId, image.id)
      .then((loaded) => {
        if (!loaded) return;
        updateRoomImage(image.id, {
          blob: loaded.blob,
          thumbnail: loaded.thumbnail,
          previewOnly: false,
        }, true);
      })
      .catch((error) => {
        console.warn("Failed to hydrate cached room image", error);
      })
      .finally(() => roomImageLoadsRef.current.delete(image.id));
  }, [roomId, updateRoomImage]);

  const handleReviewStatusChange = React.useCallback(
    (
      imageId: string,
      status: "in-review" | "approved" | undefined,
      anchorCount: number,
    ) => {
      updateRoomImage(
        imageId,
        { reviewStatus: status, reviewAnchorCount: anchorCount },
        true,
      );
    },
    [updateRoomImage],
  );

  const handleReviewEditingChange = React.useCallback(
    (imageId: string, operationCount: number) => {
      updateRoomImage(imageId, { reviewOperationCount: operationCount }, true);
    },
    [updateRoomImage],
  );

  const removeRoomImage = React.useCallback((id: string) => {
    const image = imagesRef.current.find((current) => current.id === id);
    if (!image) return;
    URL.revokeObjectURL(image.url);
    objectUrlsRef.current.delete(image.url);
    if (image.thumbnailUrl) {
      URL.revokeObjectURL(image.thumbnailUrl);
      objectUrlsRef.current.delete(image.thumbnailUrl);
    }
    imageIdsRef.current.delete(id);
    imageLikeQueueRef.current.delete(id);
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
    const placeholderAckDimensions = placeholderAckDimensionsRef.current;
    const transferAbortControllers = transferAbortControllersRef.current;
    void initWasm().catch(() => undefined);
    setLang(getLang());
    setRoomId(readRoomId());
    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      imageIds.clear();
      deletedImageIds.clear();
      placeholderAckDimensions.clear();
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
    setShareUrl(getRoomShareUrl(roomId));
    setIsShareDialogOpen(true);
  }, [roomId]);

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
    setActivities(
      (cached?.activities || []).filter((item) => item.id.startsWith("message-")),
    );
    setTextMessage(cached?.textMessage || "");
    setReviewImageId(cached?.reviewImageId || null);
    setIsPageStateLoaded(true);
  }, [roomId]);

  React.useEffect(() => {
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
      setOperationLogs([]);
      return;
    }
    let disposed = false;
    setOperationLogs([]);
    void listOperationLogs(roomId)
      .then((stored) => {
        if (disposed) return;
        setOperationLogs((current) => {
          const merged = new Map(stored.map((item) => [item.id, item]));
          current.forEach((item) => merged.set(item.id, item));
          return [...merged.values()]
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(-500);
        });
      })
      .catch((error) => {
        console.warn("Failed to load room operation logs", error);
      });
    return () => {
      disposed = true;
    };
  }, [roomId]);

  React.useEffect(() => {
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
      imageDeliveriesRef.current = [];
      setImageDeliveries([]);
      return;
    }
    let disposed = false;
    imageDeliveriesRef.current = [];
    setImageDeliveries([]);
    void listImageDeliveries(roomId)
      .then((stored) => {
        if (!disposed) {
          const restored = stored.map((delivery) =>
            delivery.status === "sending" || delivery.status === "pending"
              ? { ...delivery, status: "failed" as const, error: labels.transferInterrupted, updatedAt: Date.now() }
              : delivery,
          );
          imageDeliveriesRef.current = restored;
          setImageDeliveries(restored);
          restored.forEach((delivery, index) => {
            if (delivery !== stored[index]) {
              void upsertImageDelivery(delivery).catch(() => undefined);
            }
          });
        }
      })
      .catch((error) => {
        console.warn("Failed to load image deliveries", error);
      });
    return () => {
      disposed = true;
    };
  }, [labels.transferInterrupted, roomId]);

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
    void (async () => {
      const cachedImages: RoomImageSummary[] = [];
      const pageSize = 100;
      while (!disposed) {
        const page = await listRoomImageMetadata(roomId, pageSize, cachedImages.length);
        cachedImages.push(...page);
        if (page.length < pageSize) break;
      }
      return cachedImages.sort(
        (a, b) => (a.updatedAt ?? a.createdAt) - (b.updatedAt ?? b.createdAt),
      );
    })()
      .then((cachedImages) => {
        if (!disposed) {
          cachedImages.forEach((cachedImage) => {
            const interrupted =
              cachedImage.transferStatus === "sending" ||
              cachedImage.transferStatus === "receiving" ||
              cachedImage.transferStatus === "awaiting-receipt";
            const restoredImage: CachedRoomImage = interrupted
              ? {
                  ...cachedImage,
                  blob: new Blob([], { type: cachedImage.type }),
                  previewOnly: cachedImage.byteSize > 0,
                  transferStatus: "failed" as const,
                  progress: 0,
                }
              : {
                  ...cachedImage,
                  blob: new Blob([], { type: cachedImage.type }),
                  previewOnly: cachedImage.byteSize > 0,
                };
            addRoomImage(restoredImage);
            if (
              restoredImage.direction === "sent" &&
              restoredImage.workspaceLocation !== "library" &&
              !restoredImage.placeholder &&
              !restoredImage.placeholderOnly &&
              !restoredImage.previewOnly
            ) {
              void generateSharePlaceholder(restoredImage.blob)
                .then((placeholder) => {
                  if (!disposed) {
                    updateRoomImage(restoredImage.id, { placeholder }, true);
                  }
                })
                .catch((error) => {
                  console.warn("Failed to restore image placeholder", error);
                });
            }
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
  }, [addRoomImage, labels.transferInterrupted, roomId, updateRoomImage, upsertActivity]);

  const handleImageShareRequest = React.useCallback((message: ImageShareRequest) => {
    if (seenShareRequestsRef.current.has(message.payload.requestId)) return;
    seenShareRequestsRef.current.add(message.payload.requestId);
    incomingShareRequestRef.current = message;
    setIncomingShareThumbnail(null);
    setIncomingShareRequest(message);
  }, []);

  const handlePendingShareThumbnail = React.useCallback((imageId: string, thumbnail: Blob) => {
    if (incomingShareRequestRef.current?.payload.image.imageId === imageId) {
      setIncomingShareThumbnail(thumbnail);
    }
  }, []);

  const handleImageShareResponse = React.useCallback(
    (message: ImageShareResponse) => {
      const imageId = outgoingShareRequestsRef.current.get(message.payload.requestId);
      const recipient = outgoingShareRecipientsRef.current.get(message.payload.requestId);
      const deliveryId = outgoingShareDeliveryIdsRef.current.get(message.payload.requestId);
      if (!imageId || imageId !== message.payload.imageId) return;
      outgoingShareRequestsRef.current.delete(message.payload.requestId);
      outgoingShareRecipientsRef.current.delete(message.payload.requestId);
      outgoingShareDeliveryIdsRef.current.delete(message.payload.requestId);
      const visibleImage = imagesRef.current.find((candidate) => candidate.id === imageId);
      const pendingImage = pendingShareImagesRef.current.get(imageId);
      const image = visibleImage || pendingImage;
      if (message.payload.decision === "accept" && image) {
        const accepted = { ...image, shareStatus: "accepted" as const };
        if (pendingImage) {
          pendingShareImagesRef.current.delete(imageId);
          addRoomImage(accepted);
          void storeRoomImage(accepted).catch((error) => {
            console.warn("Failed to persist accepted shared image", error);
          });
        } else {
          updateRoomImage(imageId, { shareStatus: "accepted" }, true);
        }
        const acceptedVisibleImage = imagesRef.current.find(
          (candidate) => candidate.id === imageId,
        );
        if (acceptedVisibleImage && recipient) {
          setAcceptedShareImage({ image: acceptedVisibleImage, recipient });
        }
      } else {
        if (deliveryId) {
          patchImageDelivery(deliveryId, {
            status: "cancelled",
            error: labels.peerRejectedReceive,
          });
        }
        if (pendingImage) {
          pendingShareImagesRef.current.set(imageId, {
            ...pendingImage,
            shareStatus: "rejected",
          });
        } else {
          updateRoomImage(imageId, { shareStatus: "rejected" }, true);
        }
        upsertActivity({
          id: `share-${message.payload.requestId}`,
          kind: "cancelled",
          title: image?.name || labels.imageShare,
          detail: labels.peerRejectedReceive,
          createdAt: Date.now(),
        });
      }
    },
    [addRoomImage, labels.peerRejectedReceive, patchImageDelivery, updateRoomImage, upsertActivity],
  );

  const handleImageReactionBatch = React.useCallback(
    (message: ImageReactionBatch) => {
      message.payload.events.forEach(({ imageId, count }) => {
        const image = imagesRef.current.find((candidate) => candidate.id === imageId);
        if (!image) return;
        updateRoomImage(
          imageId,
          { likeCount: (image.likeCount || 0) + count },
          true,
        );
        setImageReactionSignals((current) => ({
          ...current,
          [imageId]: {
            sequence: (current[imageId]?.sequence || 0) + 1,
            count,
          },
        }));
      });
    },
    [updateRoomImage],
  );

  const handleImageWanted = React.useCallback(
    (message: ImageWanted) => {
      const image = imagesRef.current.find(
        (candidate) => candidate.id === message.payload.imageId,
      );
      if (!image || image.direction !== "sent") return;
      updateRoomImage(image.id, { wantedByPeer: message.payload.wanted }, true);
    },
    [updateRoomImage],
  );

  React.useEffect(() => {
    if (connection === "connected") return;
    for (const [requestId, imageId] of outgoingShareRequestsRef.current) {
      const deliveryId = outgoingShareDeliveryIdsRef.current.get(requestId);
      const visibleImage = imagesRef.current.find((candidate) => candidate.id === imageId);
      const pendingImage = pendingShareImagesRef.current.get(imageId);
      const image = visibleImage || pendingImage;
      if (pendingImage) {
        pendingShareImagesRef.current.set(imageId, {
          ...pendingImage,
          shareStatus: "failed",
        });
      } else {
        updateRoomImage(imageId, { shareStatus: "failed" }, true);
      }
      upsertActivity({
        id: `share-${requestId}`,
        kind: "error",
        title: image?.name || labels.imageShare,
        detail: labels.peerOfflineShareCancelled,
        createdAt: Date.now(),
      });
      if (deliveryId) {
        patchImageDelivery(deliveryId, {
          status: "failed",
          error: labels.peerOfflineShareCancelled,
        });
      }
    }
    outgoingShareRequestsRef.current.clear();
    outgoingShareRecipientsRef.current.clear();
    outgoingShareDeliveryIdsRef.current.clear();
    setIncomingShareRequest(null);
  }, [connection, labels.peerOfflineShareCancelled, patchImageDelivery, updateRoomImage, upsertActivity]);

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
    pendingShareImagesRef,
    imageReadyWaitersRef,
    addRoomImage,
    updateRoomImage,
    removeRoomImage,
    upsertActivity,
    onTransferSuccess: handleTransferSuccess,
    showFloatingEmoji,
    onIncomingNotification: handleIncomingNotification,
    onForcedNavigation: handleForcedNavigation,
    onWeakNetworkChange: handleWeakNetworkChange,
    onMessageTransportChange: setMessageTransportMode,
    onReviewMessage: handleReviewMessage,
    onImageShareRequest: handleImageShareRequest,
    onImageShareResponse: handleImageShareResponse,
    onImageReactionBatch: handleImageReactionBatch,
    onImageWanted: handleImageWanted,
    onPendingShareThumbnail: handlePendingShareThumbnail,
    setPacketLossRate,
    setActivities,
    setConnection,
    setConnectionError,
    setMembers,
    setNetworkLatencyMs,
    setMaxImageTransferSize,
    setRole,
  });

  const flushImageLikeQueue = React.useCallback(() => {
    imageLikeFlushTimerRef.current = null;
    const queue = imageLikeQueueRef.current;
    const channel = instructionChannelRef.current;
    if (channel?.readyState === "open") {
      const entries = [...queue.entries()];
      for (let offset = 0; offset < entries.length; offset += 12) {
        const batch = entries.slice(offset, offset + 12).map(([imageId, count]) => ({
          imageId,
          count: Math.min(count, 100),
        }));
        try {
          if (!sendImageWorkspaceMessage(channel, {
            type: "IMAGE_REACTION_BATCH",
            payload: { events: batch },
          })) break;
          batch.forEach(({ imageId, count }) => {
            const remaining = (queue.get(imageId) || 0) - count;
            if (remaining > 0) queue.set(imageId, remaining);
            else queue.delete(imageId);
          });
        } catch (error) {
          console.warn("Failed to send image reaction batch", error);
          break;
        }
      }
    }
    if (queue.size > 0 && imageLikeFlushTimerRef.current === null) {
      imageLikeFlushTimerRef.current = window.setTimeout(
        () => flushImageLikeQueueRef.current(),
        2000,
      );
    }
  }, []);
  flushImageLikeQueueRef.current = flushImageLikeQueue;

  const handleLikeImage = React.useCallback(
    (image: RoomImage) => {
      const current = imagesRef.current.find((candidate) => candidate.id === image.id);
      if (!current || current.direction !== "received") return;
      updateRoomImage(
        image.id,
        { likeCount: (current.likeCount || 0) + 1 },
        true,
      );
      imageLikeQueueRef.current.set(
        image.id,
        (imageLikeQueueRef.current.get(image.id) || 0) + 1,
      );
      if (imageLikeFlushTimerRef.current === null) {
        imageLikeFlushTimerRef.current = window.setTimeout(
          () => flushImageLikeQueueRef.current(),
          2000,
        );
      }
    },
    [updateRoomImage],
  );

  const handleWantImage = React.useCallback(
    (image: RoomImage) => {
      if (
        image.direction !== "received" ||
        !image.placeholderOnly
      ) {
        return;
      }
      const sent = sendImageWorkspaceMessage(instructionChannelRef.current, {
        type: "IMAGE_WANTED",
        payload: { imageId: image.id, wanted: !image.wantedByMe },
      });
      if (sent) updateRoomImage(image.id, { wantedByMe: !image.wantedByMe }, true);
    },
    [updateRoomImage],
  );

  React.useEffect(
    () => () => {
      if (imageLikeFlushTimerRef.current !== null) {
        window.clearTimeout(imageLikeFlushTimerRef.current);
        imageLikeFlushTimerRef.current = null;
      }
    },
    [],
  );

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

  const handlePlaceholderMeasured = React.useCallback(
    (imageId: string, width: number, height: number) => {
      const key = `${Math.round(width)}x${Math.round(height)}`;
      if (placeholderAckDimensionsRef.current.get(imageId) === key) return;
      const channel = instructionChannelRef.current;
      if (!channel || !sendImagePlaceholderAck(channel, imageId, width, height)) {
        return;
      }
      placeholderAckDimensionsRef.current.set(imageId, key);
    },
    [connection],
  );

  React.useEffect(() => {
    if (connection !== "connected") {
      placeholderAckDimensionsRef.current.clear();
    }
  }, [connection]);

  const addFilesToGallery = async (fileList: FileList | File[]) => {
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
        if (
          maxImageTransferSizeRef.current > 0 &&
          file.size > maxImageTransferSizeRef.current
        ) {
          upsertActivity({
            id: `error-${Date.now()}-${file.name}`,
            kind: "error",
            title: file.name,
            detail: imageWorkspaceLabels.tooLarge,
            createdAt: Date.now(),
          });
          continue;
        }

        const identity = await identifyImage(file);
        const createdAt = Date.now();
        const workspace = {
          rootImageId: identity.imageId,
          parentImageId: null,
          ownerId: getShareRoomClientId(roomId!),
          width: identity.width,
          height: identity.height,
          source: "local" as const,
          operation: "original" as const,
          version: 1,
          shareStatus: "local" as const,
          workspaceLocation: "library" as const,
          outboxOrigin: "library" as const,
          createdAt,
          updatedAt: createdAt,
        };
        const meta = createImageTransferMeta(
          file,
          identity.imageId,
          transferChunkSizeRef.current,
          workspace,
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
          ...workspace,
          createdAt,
          updatedAt: createdAt,
        };
        addRoomImage(image);
        void storeRoomImage(image).catch((error) => {
          console.warn("Failed to cache pending image", error);
        });
      }
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const moveImageToOutbox = async (image: RoomImage) => {
    const channel = instructionChannelRef.current;
    const file = new File([image.blob], image.name, { type: image.type });
    const queuedAt = Date.now();
    const queuedImage = {
      rootImageId: image.rootImageId,
      parentImageId: image.parentImageId,
      ownerId: image.ownerId,
      width: image.width,
      height: image.height,
      source: image.source,
      operation: image.operation,
      version: image.version,
      shareStatus: image.shareStatus,
      workspaceLocation: "outbox" as const,
      outboxOrigin: "library" as const,
      createdAt: image.createdAt,
      updatedAt: queuedAt,
      likeCount: image.likeCount ?? 0,
    };
    const meta = createImageTransferMeta(
      file,
      image.id,
      transferChunkSizeRef.current,
      queuedImage,
    );
    updateRoomImage(
      image.id,
      {
        workspaceLocation: "outbox",
        outboxOrigin: "library",
        transferStatus: "waiting",
        progress: 0,
        updatedAt: queuedAt,
      },
      true,
    );
    try {
      const placeholder = image.placeholder || (await generateSharePlaceholder(image.blob));
      updateRoomImage(image.id, { placeholder }, true);
      const activeChannel = instructionChannelRef.current;
      if (connection === "connected" && activeChannel?.readyState === "open") {
        sendImagePlaceholderPending(activeChannel, meta);
        sendImagePlaceholder(activeChannel, meta, placeholder);
      }
    } catch (error) {
      const activeChannel = instructionChannelRef.current;
      if (activeChannel?.readyState === "open") {
        sendImageDelete(activeChannel, image.id);
      }
      updateRoomImage(image.id, { workspaceLocation: "library", transferStatus: "failed" }, true);
      throw error;
    }
  };

  const handleMoveToOutbox = async (image: RoomImage) => {
    if (image.size > (isWeakNetwork ? 300 * 1024 : 1024 * 1024)) {
      setPendingOutboxImage(image);
      return;
    }
    await moveImageToOutbox(image);
  };

  const handleMoveToLibrary = async (image: RoomImage) => {
    const channel = instructionChannelRef.current;
    if (channel?.readyState === "open") sendImageDelete(channel, image.id);
    updateRoomImage(
      image.id,
      {
        workspaceLocation: "library",
        transferStatus: "waiting",
        shareStatus: "local",
        progress: 0,
        transferMode: undefined,
        reviewStatus: undefined,
        reviewAnchorCount: 0,
        reviewOperationCount: 0,
        updatedAt: Date.now(),
      },
      true,
    );
    await deleteReviewHistory(image.roomId, image.id);
  };

  const handleToggleImagePin = (image: RoomImage) => {
    updateRoomImage(
      image.id,
      { pinnedAt: image.pinnedAt ? null : Date.now() },
      true,
    );
  };

  const handleArchiveToLibrary = async (image: RoomImage) => {
    const archivedAt = Date.now();
    if (image.direction === "sent") {
      updateRoomImage(
        image.id,
        {
          workspaceLocation: "library",
          outboxOrigin: "library",
          shareStatus: "local",
          transferStatus: "waiting",
          progress: 0,
          transferMode: undefined,
          reviewStatus: undefined,
          reviewAnchorCount: 0,
          reviewOperationCount: 0,
          updatedAt: archivedAt,
        },
        true,
      );
      await deleteReviewHistory(image.roomId, image.id);
      return;
    }

    const id = crypto.randomUUID().replace(/-/g, "");
    const archived: CachedRoomImage = {
      id,
      rootImageId: id,
      parentImageId: null,
      ownerId: getShareRoomClientId(roomId!),
      width: image.width,
      height: image.height,
      source: image.source,
      operation: image.operation,
      version: 1,
      shareStatus: "local",
      workspaceLocation: "library",
      outboxOrigin: "library",
      roomId: image.roomId,
      name: image.name,
      type: image.type,
      size: image.size,
      blob: image.blob,
      thumbnail: image.thumbnail,
      direction: "sent",
      transferStatus: "waiting",
      progress: 0,
      previewOnly: false,
      placeholderOnly: false,
      placeholder: image.placeholder,
      likeCount: image.likeCount ?? 0,
      createdAt: archivedAt,
      updatedAt: archivedAt,
    };
    await storeRoomImage(archived);
    addRoomImage(archived);
    deletedImageIdsRef.current.add(image.id);
    removeRoomImage(image.id);
    await deleteRoomImage(image.roomId, image.id).catch((error) => {
      console.warn("Failed to remove received image after archiving", error);
    });
    await Promise.all([
      deleteReviewHistory(image.roomId, image.id),
      clearImageDeliveries(image.roomId, image.id),
    ]);
  };

  const handleDeleteLocalImage = async (image: RoomImage) => {
    if (image.direction !== "sent" || image.workspaceLocation !== "library") return;
    deletedImageIdsRef.current.add(image.id);
    removeRoomImage(image.id);
    await Promise.all([
      deleteRoomImage(image.roomId, image.id),
      deleteReviewHistory(image.roomId, image.id),
      clearImageDeliveries(image.roomId, image.id),
    ]);
  };

  const createStandaloneProcessedImage = async (
    result: ProcessedImageResult,
    workspaceLocation: "library" | "outbox",
    insert = true,
  ) => {
    const id = crypto.randomUUID().replace(/-/g, "");
    const createdAt = Date.now();
    const placeholder = workspaceLocation === "outbox"
      ? await generateSharePlaceholder(result.blob)
      : undefined;
    const image: CachedRoomImage = {
      id,
      rootImageId: id,
      parentImageId: null,
      ownerId: getShareRoomClientId(roomId!),
      width: result.width,
      height: result.height,
      source: result.operation === "compress" ? "compressed" : "local",
      operation: result.operation,
      version: 1,
      shareStatus: "local",
      workspaceLocation,
      outboxOrigin: workspaceLocation === "outbox" ? "direct" : "library",
      updatedAt: createdAt,
      roomId: roomId!,
      name: result.name,
      type: result.blob.type,
      size: result.blob.size,
      blob: result.blob,
      direction: "sent",
      transferStatus: "waiting",
      progress: 0,
      previewOnly: false,
      placeholderOnly: false,
      placeholder,
      createdAt,
    };
    if (insert) {
      await storeRoomImage(image);
      addRoomImage(image);
    }
    return image;
  };

  const waitForProcessedImageShare = async (
    imageId: string,
    report: (stage: ProcessedImageActionStage) => void,
  ) => {
    const deadline = Date.now() + 10 * 60_000;
    let reported: ProcessedImageActionStage | null = null;
    while (Date.now() < deadline) {
      const current = imagesRef.current.find((image) => image.id === imageId)
        || pendingShareImagesRef.current.get(imageId);
      if (!current) throw new Error(labels.sharedImageRemoved);
      if (current.shareStatus === "rejected") throw new Error(labels.peerRejectedImage);
      if (current.shareStatus === "failed" || current.transferStatus === "failed") throw new Error(labels.imageShareFailed);
      if (current.transferStatus === "cancelled") throw new Error(labels.imageShareCancelled);
      if (current.transferStatus === "sent" || current.shareStatus === "available") {
        report("complete");
        return;
      }
      const nextStage: ProcessedImageActionStage =
        current.shareStatus === "accepted" ||
        current.shareStatus === "transferring" ||
        current.transferStatus === "sending" ||
        current.transferStatus === "awaiting-receipt"
          ? "transferring"
          : "waiting";
      if (nextStage !== reported) {
        reported = nextStage;
        report(nextStage);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    throw new Error(labels.peerAcceptanceTimeout);
  };

  const handleProcessedImageResult = async (
    _source: RoomImage,
    result: ProcessedImageResult,
    action: ProcessedImageAction,
    report: (stage: ProcessedImageActionStage) => void,
    recipient?: ShareRecipient,
  ): Promise<ProcessedImageActionOutcome> => {
    report("preparing");
    const shouldSuggestCompression =
      action === "share" &&
      result.operation !== "compress" &&
      result.blob.size > (isWeakNetwork ? 300 * 1024 : 1024 * 1024);
    const insertImmediately = action === "store" || shouldSuggestCompression;
    const stored = await createStandaloneProcessedImage(
      result,
      action === "store" || shouldSuggestCompression ? "library" : "outbox",
      insertImmediately,
    );
    const image = insertImmediately
      ? imagesRef.current.find((candidate) => candidate.id === stored.id)
      : stored;
    if (!image) throw new Error(labels.imageNotAdded);
    if (action === "store") {
      report("complete");
      return { status: "stored", imageId: image.id };
    }
    if (shouldSuggestCompression) {
      const visibleImage = imagesRef.current.find(
        (candidate) => candidate.id === stored.id,
      );
      if (!visibleImage) throw new Error(labels.imageNotAdded);
      setPendingOutboxImage(visibleImage);
      report("complete");
      return { status: "stored", imageId: image.id };
    }
    report("waiting");
    try {
      const requested = await handleRequestImageShare(image, true, recipient);
      if (!requested) throw new Error(labels.receiveRequestFailed);
      if (requested === "room") {
        await waitForProcessedImageShare(image.id, report);
      } else {
        report("complete");
      }
      return { status: "shared", imageId: image.id };
    } catch (error) {
      const current = imagesRef.current.find((candidate) => candidate.id === image.id)
        || pendingShareImagesRef.current.get(image.id);
      if (current?.shareStatus === "rejected") {
        return { status: "rejected", imageId: image.id };
      }
      pendingShareImagesRef.current.delete(image.id);
      throw error;
    }
  };

  const handleCompressedImageToOutbox = async (
    _source: RoomImage,
    result: ProcessedImageResult,
  ) => {
    await createStandaloneProcessedImage(result, "outbox");
  };

  const handleResolveRejectedProcessedImage = async (
    imageId: string,
    save: boolean,
  ) => {
    const visibleImage = imagesRef.current.find((candidate) => candidate.id === imageId);
    const pendingImage = pendingShareImagesRef.current.get(imageId);
    const image = visibleImage || pendingImage;
    if (!image) throw new Error(labels.imageMissing);
    if (save) {
      if (pendingImage) {
        const stored = {
          ...pendingImage,
          workspaceLocation: "library" as const,
          outboxOrigin: "library" as const,
          shareStatus: "local" as const,
          transferStatus: "waiting" as const,
          progress: 0,
          updatedAt: Date.now(),
        };
        pendingShareImagesRef.current.delete(imageId);
        await storeRoomImage(stored);
        addRoomImage(stored);
      } else {
        updateRoomImage(
          imageId,
          {
            workspaceLocation: "library",
            outboxOrigin: "library",
            shareStatus: "local",
            transferStatus: "waiting",
            progress: 0,
            updatedAt: Date.now(),
          },
          true,
        );
      }
      return;
    }
    if (pendingImage) {
      pendingShareImagesRef.current.delete(imageId);
      return;
    }
    deletedImageIdsRef.current.add(imageId);
    removeRoomImage(imageId);
    await deleteRoomImage(image.roomId, imageId);
  };

  const handleCreateReviewImage = async (
    _source: RoomImage,
    result: ReviewImageExport,
    share: boolean,
    report: (stage: ReviewImageExportStage) => void,
    recipient?: ShareRecipient,
  ): Promise<ReviewImageExportOutcome> => {
    if (!(result.blob instanceof Blob)) {
      throw new Error(labels.invalidGeneratedImage);
    }
    report("preparing");
    const identity = await identifyImage(result.blob);
    const id = crypto.randomUUID().replace(/-/g, "");
    const createdAt = Date.now();
    const placeholder = share
      ? await generateSharePlaceholder(result.blob)
      : undefined;
    const stored: CachedRoomImage = {
      id,
      rootImageId: id,
      parentImageId: null,
      ownerId: getShareRoomClientId(roomId!),
      width: identity.width,
      height: identity.height,
      source: "review-export",
      operation: "review-export",
      version: 1,
      shareStatus: "local",
      workspaceLocation: share ? "outbox" : "library",
      outboxOrigin: share ? "direct" : "library",
      updatedAt: createdAt,
      roomId: roomId!,
      name: result.name,
      type: result.blob.type,
      size: result.blob.size,
      blob: result.blob,
      direction: "sent",
      transferStatus: "waiting",
      progress: 0,
      previewOnly: false,
      placeholderOnly: false,
      placeholder,
      createdAt,
    };
    if (!share) {
      await storeRoomImage(stored);
      addRoomImage(stored);
    }
    upsertActivity({
      id: `review-export-${stored.id}`,
      kind: "complete",
      title: stored.name,
      detail: labels.generatedImageLog(formatBytes(stored.size)),
      createdAt: Date.now(),
    });

    if (!share) {
      report("complete");
      setReviewWorkspaceFullscreen(false);
      setReviewImageId(null);
      return { status: "saved", imageId: stored.id };
    }

    report("waiting");
    try {
      const requested = await handleRequestImageShare(stored, true, recipient);
      if (!requested) throw new Error(labels.receiveRequestFailed);
      if (requested === "room") {
        await waitForProcessedImageShare(stored.id, report);
      } else {
        report("complete");
      }
      setReviewWorkspaceFullscreen(false);
      setReviewImageId(null);
      return { status: "shared", imageId: stored.id };
    } catch (error) {
      const current = imagesRef.current.find((image) => image.id === stored.id)
        || pendingShareImagesRef.current.get(stored.id);
      if (current?.shareStatus === "rejected") {
        return { status: "rejected", imageId: stored.id };
      }
      pendingShareImagesRef.current.delete(stored.id);
      throw error;
    }
  };

  const handleResolveRejectedReviewImage = async (
    imageId: string,
    save: boolean,
  ) => {
    const visibleImage = imagesRef.current.find((candidate) => candidate.id === imageId);
    const pendingImage = pendingShareImagesRef.current.get(imageId);
    const image = visibleImage || pendingImage;
    if (!image) throw new Error(labels.imageMissing);

    if (save) {
      if (pendingImage) {
        const saved = {
          ...pendingImage,
          workspaceLocation: "library" as const,
          outboxOrigin: "library" as const,
          shareStatus: "local" as const,
          transferStatus: "waiting" as const,
          progress: 0,
          updatedAt: Date.now(),
        };
        pendingShareImagesRef.current.delete(imageId);
        await storeRoomImage(saved);
        addRoomImage(saved);
      } else {
        updateRoomImage(
          imageId,
          {
            workspaceLocation: "library",
            outboxOrigin: "library",
            shareStatus: "local",
            transferStatus: "waiting",
            progress: 0,
            updatedAt: Date.now(),
          },
          true,
        );
      }
    } else {
      if (pendingImage) {
        pendingShareImagesRef.current.delete(imageId);
        setReviewWorkspaceFullscreen(false);
        setReviewImageId(null);
        return;
      }
      deletedImageIdsRef.current.add(imageId);
      removeRoomImage(imageId);
      await deleteRoomImage(image.roomId, imageId);
    }

    setReviewWorkspaceFullscreen(false);
    setReviewImageId(null);
  };

  const handleLocalFiles = (fileList: FileList | File[]) => {
    void addFilesToGallery(fileList);
  };

  const onlineShareRecipients = React.useMemo(() => {
    const currentClientId = roomId ? getShareRoomClientId(roomId) : null;
    return members.filter(
      (member) =>
        member.status === "online" && member.clientId !== currentClientId,
    );
  }, [members, roomId]);

  const shareRecipients = React.useMemo<ShareRecipient[]>(() => [
    ...onlineShareRecipients.map((member) => ({
      kind: "room" as const,
      id: `room:${member.clientId}`,
      member,
    })),
    ...messagingProviders
      .filter((provider) =>
        provider.status === "connected" && Boolean(provider.recipientId),
      )
      .map((provider) => ({
        kind: "messaging" as const,
        id: `messaging:${provider.id}`,
        provider,
      })),
  ], [messagingProviders, onlineShareRecipients]);

  const closeShareRecipientDialog = React.useCallback(() => {
    setIsShareRecipientDialogOpen(false);
    setRecipientDialogImageId(null);
    shareRecipientResolverRef.current?.(null);
    shareRecipientResolverRef.current = null;
  }, []);

  const selectShareRecipient = React.useCallback(
    (recipient: ShareRecipient) => {
      setSelectedMessageTargetId(recipient.id);
      setIsShareRecipientDialogOpen(false);
      setRecipientDialogImageId(null);
      shareRecipientResolverRef.current?.(recipient);
      shareRecipientResolverRef.current = null;
    },
    [],
  );

  const ensureShareRecipient = React.useCallback((image: RoomImage | CachedRoomImage) => {
    if (shareRecipients.length === 0) return Promise.resolve(null);
    if (shareRecipients.length === 1) {
      const recipient = shareRecipients[0];
      const delivery = latestImageDelivery(image.id, recipient.id);
      if (delivery?.status !== "delivered" && delivery?.status !== "sending" && delivery?.status !== "pending") {
        setSelectedMessageTargetId(recipient.id);
        return Promise.resolve(recipient);
      }
    }
    shareRecipientResolverRef.current?.(null);
    setRecipientDialogImageId(image.id);
    setIsShareRecipientDialogOpen(true);
    return new Promise<ShareRecipient | null>((resolve) => {
      shareRecipientResolverRef.current = resolve;
    });
  }, [latestImageDelivery, shareRecipients]);

  React.useEffect(
    () => () => {
      shareRecipientResolverRef.current?.(null);
      shareRecipientResolverRef.current = null;
    },
    [],
  );

  const goCompressImages = async (files: File[] = []) => {
    if (files.length) await queueFilesForCompression(files);
    if (role === "owner") await handleTemporaryLeave();
    else requestExitRoom();
  };

  const sendImageToMessaging = async (
    image: CachedRoomImage | RoomImage,
    recipient: Extract<ShareRecipient, { kind: "messaging" }>,
  ) => {
    if (!roomId || !messagingService || !recipient.provider.recipientId || isSending) {
      return false;
    }
    if (
      image.type.toLowerCase() === "image/avif" ||
      /\.avif$/i.test(image.name)
    ) {
      const createdAt = Date.now();
      showErrorTip(labels.messagingAvifUnsupported);
      upsertActivity({
        id: `messaging-avif-unsupported-${image.id}-${createdAt}`,
        kind: "error",
        title: image.name,
        detail: labels.messagingAvifUnsupported,
        createdAt,
      });
      return false;
    }
    const delivery = beginImageDelivery(image, recipient);
    if (!delivery) return false;
    setIsSending(true);
    updateRoomImage(image.id, {
      transferStatus: "sending",
      progress: 0,
      shareStatus: "transferring",
    }, true);
    try {
      const file = new File([image.blob], image.name, { type: image.type });
      const messageId = await messagingService.upload(recipient.provider.id, file, {
        recipientId: recipient.provider.recipientId,
        fileName: image.name,
        onProgress: (progress) => updateRoomImage(image.id, { progress }, true),
        onRetry: (retry) => {
          const createdAt = Date.now();
          upsertActivity({
            id: `r2-upload-failed-${image.id}-${retry.failedAttempt}-${createdAt}`,
            kind: "error",
            title: image.name,
            detail: labels.r2UploadAttemptFailed(
              retry.failedAttempt,
              retry.maxAttempts,
              retry.error.message,
            ),
            createdAt,
          });
          upsertActivity({
            id: `r2-upload-retry-${image.id}-${retry.nextAttempt}-${createdAt}`,
            kind: "sending",
            title: image.name,
            detail: labels.r2UploadRetrying(retry.nextAttempt, retry.maxAttempts),
            createdAt: createdAt + 1,
          });
        },
      });
      updateRoomImage(image.id, {
        transferStatus: "sent" as const,
        progress: 1,
        shareStatus: "available" as const,
        updatedAt: Date.now(),
      }, true);
      const createdAt = Date.now();
      const cachedImage = {
        roomId,
        providerId: recipient.provider.id,
        messageId,
        fileName: image.name,
        mimeType: image.type,
        size: image.blob.size,
        createdAt,
        direction: "outgoing",
        blob: image.blob,
      } as const;
      const url = URL.createObjectURL(image.blob);
      objectUrlsRef.current.add(url);
      appendMessagingChatMessage({
        id: messageId,
        providerId: recipient.provider.id,
        direction: "outgoing",
        type: "image",
        fileName: image.name,
        mimeType: image.type,
        size: image.blob.size,
        blob: image.blob,
        url,
        createdAt,
        status: "sent",
      });
      await storeMessagingImage(cachedImage).catch((error) => {
        console.warn("Failed to cache sent Weixin image", error);
        upsertActivity({
          id: `messaging-image-cache-${messageId}`,
          kind: "error",
          title: image.name,
          detail: labels.cacheFailed,
          createdAt: Date.now(),
        });
      });
      upsertActivity({
        id: `messaging-image-${delivery.id}`,
        kind: "complete",
        title: image.name,
        detail: `${labels.messageSent} · ${recipient.provider.displayName}`,
        progress: 1,
        createdAt: Date.now(),
      });
      patchImageDelivery(delivery.id, {
        status: "delivered",
        transport: "messaging",
        deliveredAt: Date.now(),
      });
      showSuccessTip(labels.imageSentTip(image.name));
      return true;
    } catch (error) {
      updateRoomImage(image.id, {
        transferStatus: "failed",
        progress: 0,
        shareStatus: "failed",
      }, true);
      upsertActivity({
        id: `messaging-image-${delivery.id}`,
        kind: "error",
        title: image.name,
        detail: error instanceof Error ? error.message : labels.transferFailed,
        progress: 0,
        createdAt: Date.now(),
      });
      patchImageDelivery(delivery.id, {
        status: "failed",
        transport: "messaging",
        error: error instanceof Error ? error.message : labels.transferFailed,
      });
      throw error;
    } finally {
      setIsSending(false);
    }
  };

  const handleSendImage = async (image: RoomImage, requestedRecipient?: ShareRecipient) => {
    const recipient = requestedRecipient || await ensureShareRecipient(image);
    if (!recipient) return;
    if (recipient.kind === "messaging") {
      await sendImageToMessaging(image, recipient).catch(() => undefined);
      return;
    }
    const controlChannel = instructionChannelRef.current;
    const fileChannel = outgoingChannelRef.current;
    if (
      image.previewOnly ||
      image.placeholderOnly ||
      image.transferStatus === "sending" ||
      isSending ||
      connection !== "connected" ||
      controlChannel?.readyState !== "open"
    ) {
      return;
    }

    let preparedImage = image;
    if (!preparedImage.placeholder) {
      try {
        const placeholder = await generateSharePlaceholder(preparedImage.blob);
        preparedImage = { ...preparedImage, placeholder };
        updateRoomImage(preparedImage.id, { placeholder }, true);
      } catch (error) {
        upsertActivity({
          id: `transfer-${preparedImage.id}`,
          kind: "error",
          title: preparedImage.name,
          detail: error instanceof Error ? error.message : labels.previewFailed,
          createdAt: Date.now(),
        });
        return;
      }
    }

    const delivery = beginImageDelivery(preparedImage, recipient);
    if (!delivery) return;
    activeDeliveryIdsRef.current.set(preparedImage.id, delivery.id);

    const abortController = new AbortController();
    transferAbortControllersRef.current.set(image.id, abortController);
    setIsSending(true);
    updateRoomImage(
      image.id,
      {
        transferStatus: "sending",
        progress: 0,
        ...(image.operation === "original" ? {} : { shareStatus: "transferring" as const }),
      },
      true,
    );
    try {
      const file = new File([image.blob], image.name, { type: image.type });
      if (preparedImage.operation !== "original" && preparedImage.placeholder) {
        sendImagePlaceholder(
          controlChannel,
          createImageTransferMeta(
            file,
            image.id,
            transferChunkSizeRef.current,
            { ...preparedImage, shareStatus: "accepted" },
            delivery.id,
          ),
          preparedImage.placeholder,
        );
      }
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
      patchImageDelivery(delivery.id, { transport: preparation.mode });
      abortController.signal.throwIfAborted();
      let meta: ReturnType<typeof createImageTransferMeta>;
      if (preparation.mode === "r2") {
        meta = createImageTransferMeta(
          file,
          image.id,
          transferChunkSizeRef.current,
          preparedImage,
          delivery.id,
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
          (retry) => {
            const createdAt = Date.now();
            upsertActivity({
              id: `r2-upload-failed-${image.id}-${retry.failedAttempt}-${createdAt}`,
              kind: "error",
              title: image.name,
              detail: labels.r2UploadAttemptFailed(
                retry.failedAttempt,
                retry.maxAttempts,
                retry.error.message,
              ),
              createdAt,
            });
            upsertActivity({
              id: `r2-upload-retry-${image.id}-${retry.nextAttempt}-${createdAt}`,
              kind: "sending",
              title: image.name,
              detail: labels.r2UploadRetrying(retry.nextAttempt, retry.maxAttempts),
              createdAt: createdAt + 1,
            });
          },
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
          throw new Error(labels.imageFileChannelDisconnected);
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
          preparedImage,
          delivery.id,
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
      patchImageDelivery(delivery.id, {
        status: cancelled ? "cancelled" : "failed",
        error: cancelled
          ? labels.transferCancelled
          : error instanceof Error
            ? error.message
            : labels.transferFailed,
      });
      activeDeliveryIdsRef.current.delete(image.id);
    } finally {
      transferAbortControllersRef.current.delete(image.id);
      setIsSending(false);
    }
  };

  const handleRequestImageShare = async (
    image: CachedRoomImage | RoomImage,
    deferUntilAccepted = false,
    requestedRecipient?: ShareRecipient,
  ) => {
    const recipient = requestedRecipient || await ensureShareRecipient(image);
    if (!recipient) return false;
    if (recipient.kind === "messaging") {
      return await sendImageToMessaging(image, recipient) ? "messaging" : false;
    }
    const channel = instructionChannelRef.current;
    if (
      channel?.readyState !== "open" ||
      image.placeholderOnly ||
      image.previewOnly ||
      image.shareStatus === "awaiting-response" ||
      image.shareStatus === "transferring"
    ) {
      return false;
    }
    const placeholder = image.placeholder || (await generateSharePlaceholder(image.blob));
    if (!image.placeholder) updateRoomImage(image.id, { placeholder }, true);
    const delivery = beginImageDelivery(image, recipient, "pending");
    if (!delivery) return false;
    const requestId = crypto.randomUUID().replace(/-/g, "");
    outgoingShareRequestsRef.current.set(requestId, image.id);
    outgoingShareRecipientsRef.current.set(requestId, recipient);
    outgoingShareDeliveryIdsRef.current.set(requestId, delivery.id);
    const sent = sendImageWorkspaceMessage(channel, {
      type: "IMAGE_SHARE_REQUEST",
      payload: {
        requestId,
        sourceImageId: image.parentImageId || image.rootImageId,
        image: {
          imageId: image.id,
          rootImageId: image.rootImageId,
          parentImageId: image.parentImageId,
          ownerId: image.ownerId,
          width: image.width,
          height: image.height,
          source: image.source,
          operation: image.operation,
          version: image.version,
          shareStatus: "awaiting-response",
          workspaceLocation: "outbox",
          outboxOrigin: image.outboxOrigin || "direct",
          name: image.name,
          type: image.type,
          size: image.size,
          createdAt: image.createdAt,
          updatedAt: image.updatedAt ?? image.createdAt,
          likeCount: image.likeCount ?? 0,
        },
        placeholder,
      },
    });
    if (!sent) {
      outgoingShareRequestsRef.current.delete(requestId);
      outgoingShareRecipientsRef.current.delete(requestId);
      outgoingShareDeliveryIdsRef.current.delete(requestId);
      patchImageDelivery(delivery.id, {
        status: "failed",
        error: labels.receiveRequestFailed,
      });
      if (deferUntilAccepted) pendingShareImagesRef.current.delete(image.id);
      return false;
    }
    if (deferUntilAccepted) {
      const { url: _url, thumbnailUrl: _thumbnailUrl, ...cached } = image as RoomImage;
      pendingShareImagesRef.current.set(image.id, {
        ...cached,
        placeholder,
        shareStatus: "awaiting-response",
      });
    } else {
      updateRoomImage(image.id, { placeholder, shareStatus: "awaiting-response" }, true);
    }
    upsertActivity({
      id: `share-${requestId}`,
      kind: "sending",
      title: image.name,
      detail: labels.waitingPeerAcceptance,
      createdAt: Date.now(),
    });
    return "room";
  };

  React.useEffect(() => {
    if (!acceptedShareImage || isSending) return;
    const { image, recipient } = acceptedShareImage;
    setAcceptedShareImage(null);
    void handleSendImage(image, recipient);
  }, [acceptedShareImage, isSending]);

  const handleShareDecision = React.useCallback(
    (decision: "accept" | "reject") => {
      const request = incomingShareRequest;
      if (!request) return;
      if (decision === "accept" && roomId) {
        const descriptor = request.payload.image;
        const receivedAt = Date.now();
        const received: CachedRoomImage = {
          id: descriptor.imageId,
          rootImageId: descriptor.rootImageId,
          parentImageId: descriptor.parentImageId,
          ownerId: descriptor.ownerId,
          width: descriptor.width,
          height: descriptor.height,
          source: descriptor.source,
          operation: descriptor.operation,
          version: descriptor.version,
          shareStatus: "accepted",
          workspaceLocation: "outbox",
          outboxOrigin: "received",
          roomId,
          name: descriptor.name,
          type: descriptor.type,
          size: descriptor.size,
          blob: new Blob([], { type: descriptor.type }),
          direction: "received",
          transferStatus: "waiting",
          progress: 0,
          previewOnly: false,
          placeholderOnly: true,
          placeholder: request.payload.placeholder,
          thumbnail: incomingShareThumbnail || undefined,
          likeCount: descriptor.likeCount ?? 0,
          createdAt: descriptor.createdAt ?? receivedAt,
          updatedAt: receivedAt,
        };
        addRoomImage(received);
        void storeRoomImage(received).catch((error) => {
          console.warn("Failed to cache accepted image placeholder", error);
        });
      }
      sendImageWorkspaceMessage(instructionChannelRef.current, {
        type: "IMAGE_SHARE_RESPONSE",
        payload: {
          requestId: request.payload.requestId,
          imageId: request.payload.image.imageId,
          decision,
        },
      });
      incomingShareRequestRef.current = null;
      setIncomingShareThumbnail(null);
      setIncomingShareRequest(null);
    },
    [addRoomImage, incomingShareRequest, incomingShareThumbnail, roomId],
  );

  const handleCancelTransfer = (image: RoomImage) => {
    transferAbortControllersRef.current.get(image.id)?.abort();
    const deliveryId = activeDeliveryIdsRef.current.get(image.id);
    if (deliveryId) {
      patchImageDelivery(deliveryId, {
        status: "cancelled",
        error: labels.transferCancelled,
      });
      activeDeliveryIdsRef.current.delete(image.id);
    }
    const channel = instructionChannelRef.current;
    if (channel?.readyState === "open") sendImageCancel(channel, image.id);
  };

  const handleDeleteImage = async (image: RoomImage) => {
    const status = image.transferStatus || "waiting";
    if (
      image.outboxOrigin === "library" ||
      image.placeholderOnly ||
      status === "sending" ||
      status === "receiving" ||
      status === "awaiting-receipt" ||
      image.shareStatus === "awaiting-response" ||
      image.shareStatus === "transferring"
    ) {
      return;
    }
    for (const [requestId, imageId] of outgoingShareRequestsRef.current) {
      if (imageId === image.id) {
        outgoingShareRequestsRef.current.delete(requestId);
        outgoingShareRecipientsRef.current.delete(requestId);
        const deliveryId = outgoingShareDeliveryIdsRef.current.get(requestId);
        if (deliveryId) {
          patchImageDelivery(deliveryId, {
            status: "cancelled",
            error: labels.transferCancelled,
          });
        }
        outgoingShareDeliveryIdsRef.current.delete(requestId);
      }
    }
    deletedImageIdsRef.current.add(image.id);
    removeRoomImage(image.id);
    try {
      await Promise.all([
        deleteRoomImage(image.roomId, image.id),
        deleteReviewHistory(image.roomId, image.id),
        clearImageDeliveries(image.roomId, image.id),
      ]);
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
        roomExitHandledRef.current = true;
        await closeRealtimeRoom(roomId, sessionId);
        clearOwnedShareRoom(roomId);
      } else {
        await leaveRealtimeRoom(roomId, sessionId);
      }
      await stopMessagingForRoomExit();
      clearRoomPageState(roomId);
      roomExitHandledRef.current = true;
      setIsExitDialogOpen(false);
      if (embedded || exitRequestSourceRef.current === "history") {
        window.history.go(-2);
      } else {
        window.location.assign("/");
      }
    } catch (error) {
      roomExitHandledRef.current = false;
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

  const selectedRoomMember = selectedMessageTargetId?.startsWith("room:")
    ? members.find(
        (member) => member.clientId === selectedMessageTargetId.slice("room:".length),
      )
    : undefined;
  const canSendSelectedText = Boolean(
    selectedRoomMember && connection === "connected",
  );

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
    if (!text || !canSendSelectedText) return;
    const id = createPeerMessageId();
    if (connection !== "connected") return;
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

  const activeMessagingChatProvider = messagingChatProviderId
    ? messagingProviders.find(
        (provider) => provider.id === messagingChatProviderId,
      ) || null
    : null;

  const handleOpenMessagingChat = React.useCallback((providerId: string) => {
    messagingChatProviderIdRef.current = providerId;
    setMessagingUnreadCounts((current) => {
      if (!current[providerId]) return current;
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    setMessagingChatProviderId(providerId);
  }, []);

  const handleMessagingChatSend = async (textValue: string) => {
    const provider = activeMessagingChatProvider;
    const text = textValue.trim().slice(0, 2000);
    if (
      !provider ||
      !provider.recipientId ||
      provider.status !== "connected" ||
      !messagingService ||
      !text ||
      isMessagingChatSending
    ) {
      return false;
    }
    const id = createPeerMessageId();
    const activityId = `message-${provider.id}-${id}`;
    const outgoing: WeixinChatItem = {
      id,
      providerId: provider.id,
      direction: "outgoing",
      type: "text",
      text,
      createdAt: Date.now(),
      status: "sending",
    };
    appendMessagingChatMessage(outgoing);
    setIsMessagingChatSending(true);
    upsertActivity({
      id: activityId,
      kind: "message",
      title: text,
      detail: `${labels.messageSending} · ${provider.displayName}`,
      createdAt: outgoing.createdAt,
    });
    try {
      await messagingService.send(provider.id, {
        id,
        channel: provider.channel,
        senderId: roomId ? getShareRoomClientId(roomId) : "picbind-room",
        conversationId: provider.recipientId,
        type: "text",
        payload: { text },
        timestamp: outgoing.createdAt,
      });
      setMessagingChatMessages((current) => current.map((message) =>
        message.id === id ? { ...message, status: "sent" } : message,
      ));
      upsertActivity({
        id: activityId,
        kind: "complete",
        title: text,
        detail: `${labels.messageSent} · ${provider.displayName}`,
        createdAt: Date.now(),
      });
      return true;
    } catch (error) {
      setMessagingChatMessages((current) => current.map((message) =>
        message.id === id ? { ...message, status: "error" } : message,
      ));
      upsertActivity({
        id: activityId,
        kind: "error",
        title: text,
        detail: error instanceof Error ? error.message : labels.messagingConnectionFailed,
        createdAt: Date.now(),
      });
      return false;
    } finally {
      setIsMessagingChatSending(false);
    }
  };

  const handleMoveWeixinImageToLibrary = async (item: WeixinChatItem) => {
    if (!roomId || !item.blob || item.movedToLibrary) return false;
    try {
      const identity = await identifyImage(item.blob);
      const now = Date.now();
      const extensionByMime: Record<string, string> = {
        "image/avif": "avif",
        "image/gif": "gif",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const extension =
        extensionByMime[item.blob.type || item.mimeType || ""] || "jpg";
      const name = item.fileName || `wechat-image.${extension}`;
      const image: CachedRoomImage = {
        id: identity.imageId,
        rootImageId: identity.imageId,
        parentImageId: null,
        ownerId: getShareRoomClientId(roomId),
        width: identity.width,
        height: identity.height,
        source: "received",
        operation: "original",
        version: 1,
        shareStatus: "local",
        workspaceLocation: "library",
        outboxOrigin: "library",
        roomId,
        name,
        type: item.blob.type || item.mimeType || "image/jpeg",
        size: item.blob.size,
        blob: item.blob,
        direction: "sent",
        transferStatus: "waiting",
        progress: 0,
        previewOnly: false,
        placeholderOnly: false,
        likeCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await storeRoomImage(image);
      addRoomImage(image);
      setMessagingChatMessages((current) => current.map((message) =>
        message.id === item.id ? { ...message, movedToLibrary: true } : message,
      ));
      return true;
    } catch (error) {
      console.warn("Failed to move Weixin image to the workspace library", error);
      upsertActivity({
        id: `weixin-image-library-error-${item.id}-${Date.now()}`,
        kind: "error",
        title: item.fileName || labels.messagingImage,
        detail: labels.messagingImageMoveFailed,
        createdAt: Date.now(),
      });
      return false;
    }
  };

  const handleReviewImage = (imageId: string) => {
    const image = imagesRef.current.find((current) => current.id === imageId);
    if (!image || !canReviewRoomImage(image)) return;
    setPreviewImageId(null);
    setReviewWorkspaceFullscreen(false);
    setReviewImageId(imageId);
  };

  const handleCopy = async () => {
    if (!roomId) return;
    await navigator.clipboard.writeText(getRoomShareUrl(roomId));
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

  const handleClearOperationLogs = async () => {
    setOperationLogs([]);
    if (!roomId) return;
    try {
      await clearOperationLogs(roomId);
    } catch (error) {
      console.warn("Failed to clear room operation logs", error);
    }
  };

  const reviewFullscreenActive = Boolean(
    reviewImage && reviewWorkspaceFullscreen,
  );
  const roomHeaderContent = (
    <RoomHeader
      role={role}
      roomId={roomId}
      copied={copied}
      actionPending={isRoomActionPending}
      messagingAvailable={messagingProviders.length > 0}
      messagingConnected={messagingProviders.some(
        (provider) => provider.status === "connected",
      )}
      labels={labels}
      onCopy={handleCopy}
      onOpenMessaging={() => setIsMessagingServiceOpen(true)}
      onTemporaryLeave={handleTemporaryLeave}
      onExitRoom={requestExitRoom}
    />
  );
  const roomSidebarContent = (
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
      messagingProviders={messagingProviders}
      messagingUnreadCounts={messagingUnreadCounts}
      selectedMessageTargetId={selectedMessageTargetId}
      canSendText={canSendSelectedText}
      canSendReaction={Boolean(selectedRoomMember && connection === "connected")}
      activities={activities}
      kickingClientId={kickingClientId}
      textMessage={textMessage}
      pressedEmoji={pressedEmoji}
      labels={labels}
      onKick={handleKickMember}
      onSelectMessageTarget={setSelectedMessageTargetId}
      onOpenMessagingChat={handleOpenMessagingChat}
      onTextChange={setTextMessage}
      onTextSubmit={handleTextMessage}
      onEmoji={handleEmoji}
      onClearActivities={handleClearActivities}
    />
  );

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
      <WorkerVersionWarning />
      {topTip ? (
        <div
          className={`pointer-events-none fixed left-1/2 top-4 z-[200] flex max-w-[min(90vw,520px)] -translate-x-1/2 items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium shadow-lg ${
            topTip.tone === "error"
              ? "border-red-200 text-red-700"
              : "border-emerald-200 text-emerald-700"
          }`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              topTip.tone === "error" ? "bg-red-500" : "bg-emerald-500"
            }`}
            aria-hidden="true"
          />
          <span>{topTip.message}</span>
        </div>
      ) : null}
      {!embedded && isMinimized ? (
        <div className="min-h-screen bg-[#eef2f7]" aria-hidden="true" />
      ) : null}
      <main
        className={`${isMinimized ? "hidden" : "block"} h-screen overflow-hidden bg-[#eef2f7] text-slate-800`}
      >
      <div
        className={
          reviewFullscreenActive
            ? "flex h-full flex-col"
            : "grid h-full grid-rows-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_clamp(320px,24vw,420px)] lg:grid-rows-1"
        }
      >
        {reviewFullscreenActive ? roomHeaderContent : null}
        <div
          className={
            reviewFullscreenActive
              ? "relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_60px]"
              : "contents"
          }
        >
          <section className="flex min-h-0 min-w-0 flex-col">
            {!reviewFullscreenActive ? roomHeaderContent : null}
            {reviewImage ? (
              <ReviewWorkspace
                roomId={roomId ?? "unknown-room"}
                image={reviewImage}
                labels={labels}
                actorId={roomId ? getShareRoomClientId(roomId) : "unknown"}
                role={role}
                fullscreen={reviewFullscreenActive}
                shareRecipients={shareRecipients}
                subscribeMessages={subscribeReviewMessages}
                onSendMessage={sendReviewMessage}
                onReviewStatusChange={handleReviewStatusChange}
                onReviewEditingChange={handleReviewEditingChange}
                onFullscreenChange={setReviewWorkspaceFullscreen}
                onGenerateImage={handleCreateReviewImage}
                onResolveRejectedImage={handleResolveRejectedReviewImage}
                onBack={() => {
                  setReviewWorkspaceFullscreen(false);
                  setReviewImageId(null);
                }}
              />
            ) : (
              <GalleryWorkspace
                inputRef={inputRef}
                images={images}
                connection={connection}
                isSending={isSending}
                isDragging={isDragging}
                labels={imageWorkspaceLabels}
                shareRecipients={shareRecipients}
                onChooseImages={() => setIsSourceDialogOpen(true)}
                onFiles={handleLocalFiles}
                onDraggingChange={setIsDragging}
                onPreview={setPreviewImageId}
                onHydrate={hydrateRoomImage}
                onPlaceholderMeasured={handlePlaceholderMeasured}
                onReview={handleReviewImage}
                onSend={async (image) => {
                  if (image.operation === "original") await handleSendImage(image);
                  else await handleRequestImageShare(image);
                }}
                onCancelTransfer={handleCancelTransfer}
                onDelete={handleDeleteImage}
                onDeleteLocal={handleDeleteLocalImage}
                onArchiveToLibrary={handleArchiveToLibrary}
                onMoveToOutbox={handleMoveToOutbox}
                onMoveToLibrary={handleMoveToLibrary}
                onTogglePin={handleToggleImagePin}
                onLike={handleLikeImage}
                onWant={handleWantImage}
                reactionSignals={imageReactionSignals}
                onProcessResult={handleProcessedImageResult}
                onCompressionToOutbox={handleCompressedImageToOutbox}
                onResolveRejectedImage={handleResolveRejectedProcessedImage}
                compressionRequest={compressionRequest}
                onCompressionRequestConsumed={() => setCompressionRequest(null)}
                operationLogs={operationLogs}
                onClearOperationLogs={handleClearOperationLogs}
              />
            )}
          </section>
          {reviewFullscreenActive ? (
            <FullscreenSidebarRail
              connection={connection}
              messageTransportMode={messageTransportMode}
              memberCount={
                members.length +
                messagingProviders.filter(
                  (provider) => provider.status === "connected",
                ).length
              }
              activityCount={activities.length}
              labels={labels}
            >
              {roomSidebarContent}
            </FullscreenSidebarRail>
          ) : (
            roomSidebarContent
          )}
        </div>
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
        open={Boolean(pendingOutboxImage)}
        weakNetwork={isWeakNetwork}
        labels={labels}
        onCancel={() => setPendingOutboxImage(null)}
        onContinue={() => {
          const image = pendingOutboxImage;
          setPendingOutboxImage(null);
          if (image) void moveImageToOutbox(image);
        }}
        onCompress={() => {
          const image = pendingOutboxImage;
          setPendingOutboxImage(null);
          if (image) setCompressionRequest(image);
        }}
      />
      {previewImage ? (
        <RoomImagePreviewDialog
          labels={labels}
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
      <ImageShareRequestDialog
        request={incomingShareRequest}
        labels={labels}
        thumbnail={incomingShareThumbnail}
        onPlaceholderMeasured={handlePlaceholderMeasured}
        onDecision={handleShareDecision}
      />
      <ShareRecipientDialog
        open={isShareRecipientDialogOpen}
        recipients={shareRecipients}
        labels={labels}
        imageId={recipientDialogImageId}
        deliveries={imageDeliveries}
        onSelect={selectShareRecipient}
        onClose={closeShareRecipientDialog}
      />
      {messagingProviders.length > 0 ? (
        <MessagingServiceDialog
          open={isMessagingServiceOpen}
          service={messagingService}
          providers={messagingProviders}
          labels={labels}
          onClose={() => setIsMessagingServiceOpen(false)}
        />
      ) : null}
      {messagingProviders.length > 0 ? (
        <WeixinChatDialog
          open={Boolean(messagingChatProviderId)}
          provider={activeMessagingChatProvider}
          messages={messagingChatMessages}
          labels={labels}
          sending={isMessagingChatSending}
          onSend={handleMessagingChatSend}
          onMoveImage={handleMoveWeixinImageToLibrary}
          onLoadImage={loadMessagingImage}
          onClose={() => setMessagingChatProviderId(null)}
        />
      ) : null}
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
