"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  FiAlertCircle,
  FiArrowLeft,
  FiCheck,
  FiCheckCircle,
  FiCopy,
  FiDownload,
  FiImage,
  FiLoader,
  FiLogOut,
  FiMessageCircle,
  FiMinimize2,
  FiSend,
  FiTrash2,
  FiUploadCloud,
  FiUserX,
  FiUsers,
  FiWifi,
  FiX,
} from "react-icons/fi";
import RoomImagePreviewDialog from "@/components/room-image-preview-dialog";
import RoomImageMedia from "@/components/room-image-media";
import { getLang, type Lang } from "@/locales";
import {
  clearOwnedShareRoom,
  clearTemporaryShareRoom,
  consumeCreatedShareRoomPrompt,
  getShareRoomClientId,
  getShareRoomOwnerToken,
  markShareRoomTemporarilyAway,
} from "@/utils/share-room";
import {
  closeRealtimeRoom,
  getRealtimeIceServers,
  getRealtimeR2Download,
  getRealtimeRoomStatus,
  heartbeatRealtimeRoom,
  kickRealtimeRoomMember,
  leaveRealtimeRoom,
  leaveRealtimeRoomTemporarily,
  joinRealtimeRoom,
  publishRealtimeCandidate,
  publishRealtimeSignal,
  prepareRealtimeImageTransfer,
  confirmRealtimeR2Download,
  confirmRealtimeR2Upload,
  markRealtimeR2Shared,
  RealtimeRoomRequestError,
  type RoomRole,
  type RoomMemberPresence,
} from "@/utils/realtime-room";
import {
  RealtimeImageReceiver,
  IMAGE_CHUNK_SIZE,
  MAX_IMAGE_TRANSFER_SIZE,
  WEAK_NETWORK_CHUNK_SIZE,
  createImageTransferMeta,
  sendImageDelete,
  sendImagePlaceholder,
  sendImageReady,
  sendImageReceipt,
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
  parsePeerMessage,
  sendPeerMessage,
  TEST_EMOJIS,
} from "@/utils/realtime-peer-messages";
import { generateSharePlaceholder } from "@/utils/share-placeholder";
import {
  downloadFileFromR2,
  uploadFileToR2,
} from "@/utils/realtime-r2-transfer";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

type ConnectionState = "waiting" | "connecting" | "connected" | "error";

type ActivityItem = {
  id: string;
  kind:
    | "connection"
    | "message"
    | "sending"
    | "receiving"
    | "complete"
    | "error";
  title: string;
  detail?: string;
  progress?: number;
  createdAt: number;
};

type RoomImage = CachedRoomImage & {
  url: string;
};

async function readWebRtcLatency(
  peer: RTCPeerConnection,
): Promise<number | null> {
  const report = await peer.getStats();
  const entries = new Map<string, Record<string, unknown>>();
  report.forEach((value) => {
    entries.set(value.id, value as unknown as Record<string, unknown>);
  });
  const transport = [...entries.values()].find(
    (entry) => entry.type === "transport",
  );
  const selectedPairId = transport?.selectedCandidatePairId;
  const selectedPair =
    (typeof selectedPairId === "string" ? entries.get(selectedPairId) : null) ||
    [...entries.values()].find(
      (entry) =>
        entry.type === "candidate-pair" &&
        entry.state === "succeeded" &&
        entry.nominated === true,
    );
  if (!selectedPair) return null;

  const roundTripTime = Number(selectedPair.currentRoundTripTime);
  return Number.isFinite(roundTripTime) && roundTripTime >= 0
    ? Math.round(roundTripTime * 1000)
    : null;
}

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

function formatBytes(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function middleEllipsisFileName(name: string, maxLength = 28) {
  if (name.length <= maxLength) return name;
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  const availablePrefix = Math.max(6, maxLength - extension.length - 3);
  return `${name.slice(0, availablePrefix)}...${extension}`;
}

export default function ShareRoomPage() {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const activityListRef = React.useRef<HTMLDivElement | null>(null);
  const emojiScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const emojiSequenceRef = React.useRef(0);
  const outgoingChannelRef = React.useRef<RTCDataChannel | null>(null);
  const controlChannelRef = React.useRef<RTCDataChannel | null>(null);
  const transferChunkSizeRef = React.useRef(IMAGE_CHUNK_SIZE);
  const weakNetworkTransferRef = React.useRef(false);
  const sessionIdRef = React.useRef<string | null>(null);
  const objectUrlsRef = React.useRef(new Set<string>());
  const imageIdsRef = React.useRef(new Set<string>());
  const deletedImageIdsRef = React.useRef(new Set<string>());
  const imageReadyWaitersRef = React.useRef(
    new Map<string, { resolve(): void; timeoutId: number }>(),
  );
  const imagesRef = React.useRef<RoomImage[]>([]);
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
  const [members, setMembers] = React.useState<RoomMemberPresence[]>([]);
  const [activities, setActivities] = React.useState<ActivityItem[]>([]);
  const [images, setImages] = React.useState<RoomImage[]>([]);
  const [previewImageId, setPreviewImageId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [pressedEmoji, setPressedEmoji] = React.useState<string | null>(null);
  const [textMessage, setTextMessage] = React.useState("");
  const [floatingEmojis, setFloatingEmojis] = React.useState<
    Array<{
      id: string;
      emoji: string;
      startX: number;
      path: string;
      duration: number;
    }>
  >([]);
  const [isRoomActionPending, setIsRoomActionPending] = React.useState(false);
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

  React.useEffect(() => {
    if (networkLatencyMs === null) return;
    // Hysteresis prevents toggling the payload size on every small RTT change.
    if (!weakNetworkTransferRef.current && networkLatencyMs >= 250) {
      weakNetworkTransferRef.current = true;
      transferChunkSizeRef.current = WEAK_NETWORK_CHUNK_SIZE;
    } else if (weakNetworkTransferRef.current && networkLatencyMs <= 160) {
      weakNetworkTransferRef.current = false;
      transferChunkSizeRef.current = IMAGE_CHUNK_SIZE;
    }
  }, [networkLatencyMs]);

  const labels = React.useMemo(
    () =>
      lang === "zh"
      ? {
          back: "返回首页",
          room: "分享房间",
          copy: "复制房间链接",
          copied: "链接已复制",
          shareCreatedTitle: "分享房间已创建",
          shareLink: "分享链接",
          expires: "房间将在 30 分钟后过期",
          closeDialog: "关闭",
          invalid: "分享链接无效",
          workspace: "图片工作区",
          upload: "选择图片",
          uploading: "正在发送",
          drop: "拖入图片开始传输",
          dropHint: "支持常见图片格式，单张最大 50 MB",
          guestEmpty: "选择或拖入图片",
          cached: "图片保存在当前浏览器",
          sent: "已发送",
          received: "已接收",
          send: "发送图片",
          waitingToSend: "等待发送",
          waitingForSender: "等待对方发送",
          preparingPreview: "正在生成占位信息",
          previewFailed: "图片占位信息生成失败",
          previewOnly: "32×32 预览",
          download: "下载图片",
          deleteImage: "删除图片",
          participants: "匿名成员",
          owner: "匿名 Owner",
          guest: "匿名 Guest",
          you: "你",
          online: "在线",
          offline: "离线",
          kickMember: "移出房间",
          latency: "延迟",
          activity: "传输消息",
          noActivity: "暂无传输消息",
          testMessage: "发送文本消息",
          textPlaceholder: "输入消息",
          sendMessage: "发送",
          quickReactions: "快捷表情",
          messageSending: "等待对方确认",
          messageSent: "对方已接收",
          messageReceived: "收到普通消息",
          waiting: "等待另一位成员",
          connecting: "正在建立实时连接",
          connected: "实时通道已连接",
          failed: "连接失败",
          sending: "正在发送",
          receiving: "正在接收",
          complete: "传输完成",
          awaitingReceipt: "已发送，等待对方确认",
          cacheFailed: "本地缓存失败",
          transferFailed: "图片传输失败",
          imageOnly: "只能传输图片文件",
          tooLarge: "图片超过 50 MB",
          temporaryLeave: "临时离开",
          closeRoom: "退出并销毁房间",
          confirmClose: "退出后房间将立即销毁，所有成员都会被移出。确定继续吗？",
        }
      : {
          back: "Back to home",
          room: "Share room",
          copy: "Copy room link",
          copied: "Link copied",
          shareCreatedTitle: "Share room created",
          shareLink: "Share link",
          expires: "This room expires in 30 minutes",
          closeDialog: "Close",
          invalid: "Invalid share link",
          workspace: "Image workspace",
          upload: "Choose images",
          uploading: "Sending",
          drop: "Drop images to transfer",
          dropHint: "Common image formats, up to 50 MB each",
          guestEmpty: "Choose or drop images",
          cached: "Images are stored in this browser",
          sent: "Sent",
          received: "Received",
          send: "Send image",
          waitingToSend: "Waiting to send",
          waitingForSender: "Waiting for sender",
          preparingPreview: "Preparing placeholder",
          previewFailed: "Placeholder generation failed",
          previewOnly: "32×32 preview",
          download: "Download image",
          deleteImage: "Delete image",
          participants: "Anonymous members",
          owner: "Anonymous Owner",
          guest: "Anonymous Guest",
          you: "You",
          online: "Online",
          offline: "Offline",
          kickMember: "Remove from room",
          latency: "RTT",
          activity: "Transfer messages",
          noActivity: "No transfer messages yet",
          testMessage: "Send a text message",
          textPlaceholder: "Type a message",
          sendMessage: "Send",
          quickReactions: "Quick reactions",
          messageSending: "Waiting for peer confirmation",
          messageSent: "Received by peer",
          messageReceived: "Regular message received",
          waiting: "Waiting for another member",
          connecting: "Establishing realtime connection",
          connected: "Realtime channel connected",
          failed: "Connection failed",
          sending: "Sending",
          receiving: "Receiving",
          complete: "Transfer complete",
          awaitingReceipt: "Sent, waiting for receiver confirmation",
          cacheFailed: "Local cache failed",
          transferFailed: "Image transfer failed",
          imageOnly: "Only image files can be transferred",
          tooLarge: "Image exceeds 50 MB",
          temporaryLeave: "Leave temporarily",
          closeRoom: "Exit and close room",
          confirmClose:
            "Closing the room removes every member immediately. Continue?",
        },
    [lang],
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
  }, []);

  React.useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    const imageIds = imageIdsRef.current;
    const deletedImageIds = deletedImageIdsRef.current;
    setLang(getLang());
    setRoomId(readRoomId());
    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      imageIds.clear();
      deletedImageIds.clear();
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
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
      return;
    }
    let disposed = false;
    void listRoomImages(roomId)
      .then((cachedImages) => {
        if (!disposed) {
          cachedImages.forEach(addRoomImage);
        }
      })
      .catch((error) => {
        console.warn("Failed to load cached room images", error);
      });
    return () => {
      disposed = true;
    };
  }, [addRoomImage, roomId]);

  React.useEffect(() => {
    if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
      return;
    }

    let disposed = false;
    let pollTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let handshakeTimer: number | undefined;
    let statsTimer: number | undefined;
    let connectedRole: RoomRole | null = null;
    let connection: RTCPeerConnection | null = null;
    let controlChannel: RTCDataChannel | null = null;
    let fileChannel: RTCDataChannel | null = null;
    let iceServers: RTCIceServer[] = [];
    let currentPeerSessionId: string | null = null;
    let currentOfferSdp: string | null = null;
    const appliedRemoteCandidates = new Set<string>();
    let negotiating = false;
    let handshakeId = "";
    let handshakeAttempts = 0;
    let handshakeAcknowledged = false;
    let placeholdersPublished = false;
    const imageReadyWaiters = imageReadyWaitersRef.current;

    const redirectIfRoomClosed = (error: unknown) => {
      if (error instanceof RealtimeRoomRequestError && error.status === 404) {
        window.location.replace("/?roomClosed=1");
        return true;
      }
      if (
        error instanceof RealtimeRoomRequestError &&
        error.status === 403 &&
        /removed|revoked/i.test(error.message)
      ) {
        window.location.replace("/?roomKicked=1");
        return true;
      }
      return false;
    };

    const confirmReceipt = (id: string, attempt = 0) => {
      if (disposed) {
        return;
      }
      const channel = controlChannelRef.current;
      if (channel?.readyState === "open") {
        sendImageReceipt(channel, id);
        return;
      }
      if (attempt < 100) {
        window.setTimeout(() => confirmReceipt(id, attempt + 1), 100);
      }
    };

    const receiver = new RealtimeImageReceiver({
      async onPlaceholder(meta, placeholder) {
        if (deletedImageIdsRef.current.has(meta.id)) return;
        const current = imagesRef.current.find((image) => image.id === meta.id);
        if (current && !current.previewOnly && !current.placeholderOnly) {
          return;
        }
        const image: CachedRoomImage = {
          id: meta.id,
          roomId,
          name: meta.name,
          type: meta.type,
          size: meta.size,
          blob: new Blob([], { type: meta.type }),
          direction: "received",
          transferStatus: "waiting",
          progress: 0,
          previewOnly: false,
          placeholderOnly: true,
          placeholder,
          createdAt: current?.createdAt || Date.now(),
        };
        if (!disposed) addRoomImage(image);
        try {
          await storeRoomImage(image);
        } catch (error) {
          console.warn("Failed to cache image placeholder", error);
        }
      },
      async onPreview(meta, thumbnail) {
        const current = imagesRef.current.find((image) => image.id === meta.id);
        if (current && !current.previewOnly) {
          return;
        }
        const image: CachedRoomImage = {
          id: meta.id,
          roomId,
          name: meta.name,
          type: meta.type,
          size: meta.size,
          blob: thumbnail,
          direction: "received",
          transferStatus: "waiting",
          progress: 0,
          previewOnly: true,
          placeholderOnly: false,
          createdAt: current?.createdAt || Date.now(),
        };
        try {
          await storeRoomImage(image);
          if (!disposed) {
            addRoomImage(image);
          }
        } catch (error) {
          console.warn("Failed to cache image preview", error);
        }
      },
      onStart(meta) {
        updateRoomImage(
          meta.id,
          { transferStatus: "receiving", progress: 0 },
          true,
        );
        upsertActivity({
          id: `transfer-${meta.id}`,
          kind: "receiving",
          title: meta.name,
          detail: `${labels.receiving} · 0 B / ${formatBytes(meta.size)}`,
          progress: 0,
          createdAt: Date.now(),
        });
        const channel = controlChannelRef.current;
        if (channel?.readyState === "open") sendImageReady(channel, meta.id);
      },
      onProgress(progress) {
        updateRoomImage(progress.id, {
          transferStatus: "receiving",
          progress: progress.progress,
        });
        upsertActivity({
          id: `transfer-${progress.id}`,
          kind: "receiving",
          title: progress.name,
          detail: `${labels.receiving} · ${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.size)}`,
          progress: progress.progress,
          createdAt: Date.now(),
        });
      },
      async onComplete(meta, blob) {
        const current = imagesRef.current.find((image) => image.id === meta.id);
        const image: CachedRoomImage = {
          id: meta.id,
          roomId,
          name: meta.name,
          type: meta.type,
          size: meta.size,
          blob,
          direction: "received",
          transferStatus: "received",
          progress: 1,
          previewOnly: false,
          placeholderOnly: false,
          placeholder: current?.placeholder,
          createdAt: current?.createdAt || Date.now(),
        };
        try {
          await storeRoomImage(image);
          if (!disposed) {
            addRoomImage(image);
            upsertActivity({
              id: `transfer-${meta.id}`,
              kind: "complete",
              title: meta.name,
              detail: `${labels.complete} · ${formatBytes(meta.size)}`,
              progress: 1,
              createdAt: Date.now(),
            });
            confirmReceipt(meta.id);
          }
        } catch (error) {
          if (!disposed) {
            upsertActivity({
              id: `transfer-${meta.id}`,
              kind: "error",
              title: meta.name,
              detail: error instanceof Error ? error.message : labels.cacheFailed,
              createdAt: Date.now(),
            });
          }
        }
      },
      onError(meta, reason) {
        if (meta) {
          updateRoomImage(
            meta.id,
            { transferStatus: "failed" },
            true,
          );
        }
        upsertActivity({
          id: meta ? `transfer-${meta.id}` : `error-${Date.now()}`,
          kind: "error",
          title: meta?.name || labels.transferFailed,
          detail: reason,
          createdAt: Date.now(),
        });
      },
      onReceipt(id) {
        updateRoomImage(
          id,
          { transferStatus: "sent", progress: 1 },
          true,
        );
        setActivities((current) =>
          current.map((activity) =>
            activity.id === `transfer-${id}`
              ? {
                  ...activity,
                  kind: "complete",
                  detail: labels.complete,
                  progress: 1,
                  createdAt: Date.now(),
                }
              : activity,
          ),
        );
      },
      onReady(id) {
        imageReadyWaiters.get(id)?.resolve();
      },
      async onDelete(id) {
        deletedImageIdsRef.current.add(id);
        removeRoomImage(id);
        try {
          await deleteRoomImage(id);
        } catch (error) {
          console.warn("Failed to delete remote image placeholder", error);
        }
      },
      async onR2Available(meta, objectKey) {
        const sessionId = sessionIdRef.current;
        if (!sessionId || disposed) return;
        updateRoomImage(
          meta.id,
          { transferStatus: "receiving", progress: 0 },
          true,
        );
        upsertActivity({
          id: `transfer-${meta.id}`,
          kind: "receiving",
          title: meta.name,
          detail: `${labels.receiving} · 0 B / ${formatBytes(meta.size)}`,
          progress: 0,
          createdAt: Date.now(),
        });
        try {
          const download = await getRealtimeR2Download(
            roomId,
            sessionId,
            objectKey,
          );
          const blob = await downloadFileFromR2(
            download.downloadUrl,
            meta.type,
            meta.size,
            (progress) => {
              updateRoomImage(meta.id, {
                transferStatus: "receiving",
                progress: progress.progress,
              });
              upsertActivity({
                id: `transfer-${meta.id}`,
                kind: "receiving",
                title: meta.name,
                detail: `${labels.receiving} · ${formatBytes(progress.transferredBytes)} / ${formatBytes(meta.size)}`,
                progress: progress.progress,
                createdAt: Date.now(),
              });
            },
          );
          const current = imagesRef.current.find((image) => image.id === meta.id);
          const image: CachedRoomImage = {
            id: meta.id,
            roomId,
            name: meta.name,
            type: meta.type,
            size: meta.size,
            blob,
            direction: "received",
            transferStatus: "received",
            progress: 1,
            previewOnly: false,
            placeholderOnly: false,
            placeholder: current?.placeholder,
            createdAt: current?.createdAt || Date.now(),
          };
          await storeRoomImage(image);
          if (disposed) return;
          addRoomImage(image);
          upsertActivity({
            id: `transfer-${meta.id}`,
            kind: "complete",
            title: meta.name,
            detail: `${labels.complete} · ${formatBytes(meta.size)}`,
            progress: 1,
            createdAt: Date.now(),
          });
          confirmReceipt(meta.id);
          void (async () => {
            let lastError: unknown;
            for (const delayMs of [0, 500, 1_500]) {
              if (delayMs) {
                await new Promise((resolve) => window.setTimeout(resolve, delayMs));
              }
              try {
                await confirmRealtimeR2Download(roomId, sessionId, objectKey);
                return;
              } catch (error) {
                lastError = error;
              }
            }
            console.warn("Failed to record completed R2 download", lastError);
          })();
        } catch (error) {
          updateRoomImage(meta.id, { transferStatus: "failed" }, true);
          upsertActivity({
            id: `transfer-${meta.id}`,
            kind: "error",
            title: meta.name,
            detail:
              error instanceof Error ? error.message : labels.transferFailed,
            createdAt: Date.now(),
          });
        }
      },
    });

    const setConnectionActivity = (
      state: ConnectionState,
      detail?: string,
    ) => {
      const title =
        state === "connected"
          ? labels.connected
          : state === "connecting"
            ? labels.connecting
            : state === "error"
              ? labels.failed
              : labels.waiting;
      upsertActivity({
        id: "connection",
        kind: state === "error" ? "error" : "connection",
        title,
        detail,
        createdAt: Date.now(),
      });
    };

    const stopHandshake = () => {
      if (handshakeTimer) {
        window.clearInterval(handshakeTimer);
        handshakeTimer = undefined;
      }
    };

    const publishWaitingPlaceholders = async () => {
      const activeChannel = controlChannelRef.current;
      if (
        placeholdersPublished ||
        activeChannel?.readyState !== "open"
      ) {
        return;
      }
      placeholdersPublished = true;
      for (const image of imagesRef.current) {
        if (
          image.direction !== "sent" ||
          image.previewOnly ||
          image.placeholderOnly ||
          (image.transferStatus !== "waiting" &&
            image.transferStatus !== "failed")
        ) {
          continue;
        }
        try {
          const file = new File([image.blob], image.name, { type: image.type });
          const meta = createImageTransferMeta(
            file,
            image.id,
            transferChunkSizeRef.current,
          );
          const placeholder =
            image.placeholder || (await generateSharePlaceholder(file));
          if (!image.placeholder) {
            updateRoomImage(image.id, { placeholder }, true);
          }
          sendImagePlaceholder(activeChannel, meta, placeholder);
        } catch (error) {
          console.warn("Failed to publish queued image placeholder", error);
        }
      }
    };

    const sendHello = () => {
      if (handshakeAttempts >= 20) {
        const message = "P2P DataChannel handshake timed out";
        setConnection("error");
        setConnectionError(message);
        setConnectionActivity("error", message);
        closePeerConnection();
        return;
      }
      handshakeAttempts += 1;
      sendPeerMessage(controlChannelRef.current, {
        type: "HELLO",
        payload: { id: handshakeId },
      });
    };

    const startHandshake = () => {
      if (
        controlChannel?.readyState !== "open" ||
        handshakeAcknowledged ||
        handshakeTimer ||
        disposed
      ) {
        return;
      }
      setConnection("connecting");
      setConnectionActivity("connecting");
      handshakeAttempts = 0;
      sendHello();
      handshakeTimer = window.setInterval(sendHello, 500);
    };

    const sendWhenReady = (
      message:
        | { type: "HELLO_ACK"; payload: { replyTo: string } }
        | { type: "MESSAGE_ACK"; payload: { replyTo: string } },
      attempt = 0,
    ) => {
      if (disposed) {
        return;
      }
      if (sendPeerMessage(controlChannelRef.current, message)) {
        return;
      }
      if (attempt < 100) {
        window.setTimeout(() => sendWhenReady(message, attempt + 1), 100);
      }
    };

    const handleControlMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const peerMessage = parsePeerMessage(event.data);
      if (peerMessage?.type === "HELLO") {
        sendWhenReady({
          type: "HELLO_ACK",
          payload: { replyTo: peerMessage.payload.id },
        });
        startHandshake();
        return;
      }
      if (
        peerMessage?.type === "HELLO_ACK" &&
        peerMessage.payload.replyTo === handshakeId
      ) {
        handshakeAcknowledged = true;
        stopHandshake();
        setConnection("connected");
        setConnectionError(null);
        setConnectionActivity("connected");
        void publishWaitingPlaceholders();
        return;
      }
      if (peerMessage?.type === "EMOJI") {
        showFloatingEmoji(
          peerMessage.payload.id,
          peerMessage.payload.emoji,
        );
        sendWhenReady({
          type: "MESSAGE_ACK",
          payload: { replyTo: peerMessage.payload.id },
        });
        return;
      }
      if (peerMessage?.type === "TEXT") {
        upsertActivity({
          id: `message-${peerMessage.payload.id}`,
          kind: "message",
          title: peerMessage.payload.text,
          detail: `${labels.messageReceived} · ${
            connectedRole === "owner" ? labels.guest : labels.owner
          }`,
          createdAt: Date.now(),
        });
        sendWhenReady({
          type: "MESSAGE_ACK",
          payload: { replyTo: peerMessage.payload.id },
        });
        return;
      }
      if (peerMessage?.type === "MESSAGE_ACK") {
        setActivities((current) =>
          current.map((activity) =>
            activity.id === `message-${peerMessage.payload.replyTo}`
              ? {
                  ...activity,
                  kind: "complete",
                  detail: labels.messageSent,
                  createdAt: Date.now(),
                }
              : activity,
          ),
        );
        return;
      }
      receiver.handle(event.data);
    };

    const attachControlChannel = (nextChannel: RTCDataChannel) => {
      controlChannel = nextChannel;
      handshakeId = createPeerMessageId();
      handshakeAttempts = 0;
      handshakeAcknowledged = false;
      handshakeAttempts = 0;
      placeholdersPublished = false;
      controlChannel.onmessage = handleControlMessage;
      controlChannel.onopen = () => {
        controlChannelRef.current = controlChannel;
        startHandshake();
      };
      controlChannel.onclose = () => {
        stopHandshake();
        handshakeAcknowledged = false;
        placeholdersPublished = false;
        controlChannelRef.current = null;
        if (!disposed) {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      if (controlChannel.readyState === "open") {
        controlChannelRef.current = controlChannel;
        startHandshake();
      }
    };

    const attachFileChannel = (nextChannel: RTCDataChannel) => {
      fileChannel = nextChannel;
      fileChannel.binaryType = "arraybuffer";
      fileChannel.onmessage = (event) => receiver.handle(event.data);
      fileChannel.onopen = () => {
        outgoingChannelRef.current = fileChannel;
        if (handshakeAcknowledged) void publishWaitingPlaceholders();
      };
      fileChannel.onclose = () => {
        outgoingChannelRef.current = null;
        if (!disposed) {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      if (fileChannel.readyState === "open") {
        outgoingChannelRef.current = fileChannel;
      }
    };

    const closePeerConnection = () => {
      stopHandshake();
      for (const waiter of [...imageReadyWaiters.values()]) waiter.resolve();
      if (statsTimer) {
        window.clearInterval(statsTimer);
        statsTimer = undefined;
      }
      if (!disposed) setNetworkLatencyMs(null);
      if (controlChannel) {
        controlChannel.onclose = null;
        controlChannel.close();
      }
      if (fileChannel) {
        fileChannel.onclose = null;
        fileChannel.close();
      }
      if (connection) {
        connection.ondatachannel = null;
        connection.onconnectionstatechange = null;
        connection.onicecandidate = null;
        connection.close();
      }
      controlChannel = null;
      fileChannel = null;
      connection = null;
      outgoingChannelRef.current = null;
      controlChannelRef.current = null;
      currentPeerSessionId = null;
      currentOfferSdp = null;
      appliedRemoteCandidates.clear();
      handshakeAcknowledged = false;
      placeholdersPublished = false;
      negotiating = false;
    };

    const createPeerConnection = () => {
      const peer = new RTCPeerConnection({
        iceServers,
        bundlePolicy: "max-bundle",
      });
      peer.onconnectionstatechange = () => {
        if (disposed) {
          return;
        }
        if (peer.connectionState === "failed") {
          setConnection("error");
          setConnectionActivity("error", "P2P connection failed");
          closePeerConnection();
        } else if (peer.connectionState === "disconnected") {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      peer.ondatachannel = (event) => {
        if (event.channel.label === "picbind-control") attachControlChannel(event.channel);
        else if (event.channel.label === "picbind-files") attachFileChannel(event.channel);
      };
      connection = peer;
      const updateStats = () => {
        void readWebRtcLatency(peer)
          .then((latencyMs) => {
            if (!disposed && connection === peer) {
              setNetworkLatencyMs(latencyMs);
            }
          })
          .catch(() => undefined);
      };
      updateStats();
      statsTimer = window.setInterval(updateStats, 2000);
      return peer;
    };

    const configureCandidatePublishing = (
      peer: RTCPeerConnection,
      sessionId: string,
    ) => {
      const pending: RTCIceCandidateInit[] = [];
      let signalReady = false;
      const publish = (candidate: RTCIceCandidateInit) => {
        void publishRealtimeCandidate(roomId, sessionId, candidate).catch(
          (error) => {
            console.warn("Failed to publish ICE candidate", error);
          },
        );
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        const candidate = event.candidate.toJSON();
        if (signalReady) {
          publish(candidate);
        } else {
          pending.push(candidate);
        }
      };
      return () => {
        signalReady = true;
        pending.splice(0).forEach(publish);
      };
    };

    const addRemoteCandidates = async (
      candidates: RTCIceCandidateInit[] | undefined,
    ) => {
      if (!connection?.remoteDescription) {
        return;
      }
      for (const candidate of candidates || []) {
        const key = JSON.stringify([
          candidate.candidate,
          candidate.sdpMid,
          candidate.sdpMLineIndex,
          candidate.usernameFragment,
        ]);
        if (appliedRemoteCandidates.has(key)) {
          continue;
        }
        await connection.addIceCandidate(candidate);
        appliedRemoteCandidates.add(key);
      }
    };

    const ensureOwnerConnection = async (
      sessionId: string,
      status: Awaited<ReturnType<typeof getRealtimeRoomStatus>>,
    ) => {
      const peerSessionId = status.guestSessionId;
      if (!peerSessionId) {
        if (currentPeerSessionId) {
          closePeerConnection();
        }
        setConnection("waiting");
        setConnectionActivity("waiting");
        return;
      }

      if (currentPeerSessionId !== peerSessionId) {
        closePeerConnection();
      }
      if (!connection && !negotiating) {
        negotiating = true;
        setConnection("connecting");
        setConnectionActivity("connecting");
        currentPeerSessionId = peerSessionId;
        const peer = createPeerConnection();
        const enableCandidatePublishing = configureCandidatePublishing(
          peer,
          sessionId,
        );
        attachControlChannel(
          peer.createDataChannel("picbind-control", { ordered: true }),
        );
        attachFileChannel(
          peer.createDataChannel("picbind-files", { ordered: false }),
        );
        try {
          await peer.setLocalDescription(await peer.createOffer());
          const description = peer.localDescription;
          if (!description || peer.connectionState === "closed") {
            return;
          }
          await publishRealtimeSignal(
            roomId,
            sessionId,
            description.toJSON(),
          );
          enableCandidatePublishing();
        } catch (error) {
          if (connection === peer) {
            closePeerConnection();
          }
          const message =
            error instanceof Error ? error.message : "P2P offer failed";
          setConnection("error");
          setConnectionError(message);
          setConnectionActivity("error", message);
          throw error;
        } finally {
          negotiating = false;
        }
      }

      const signal = status.signal;
      if (
        connection &&
        signal?.ownerSessionId === sessionId &&
        signal.guestSessionId === peerSessionId &&
        signal.answer &&
        connection.signalingState === "have-local-offer"
      ) {
        await connection.setRemoteDescription(signal.answer);
      }
      await addRemoteCandidates(signal?.guestCandidates);
    };

    const ensureGuestConnection = async (
      sessionId: string,
      status: Awaited<ReturnType<typeof getRealtimeRoomStatus>>,
    ) => {
      const peerSessionId = status.ownerSessionId;
      const signal = status.signal;
      const offer =
        signal?.ownerSessionId === peerSessionId &&
        signal?.guestSessionId === sessionId
          ? signal.offer
          : undefined;
      if (!peerSessionId || !offer?.sdp) {
        if (!peerSessionId && currentPeerSessionId) {
          closePeerConnection();
        }
        setConnection("waiting");
        setConnectionActivity("waiting");
        return;
      }
      if (
        currentPeerSessionId === peerSessionId &&
        currentOfferSdp === offer.sdp
      ) {
        await addRemoteCandidates(signal?.ownerCandidates);
        return;
      }
      if (negotiating) {
        return;
      }
      closePeerConnection();
      negotiating = true;
      setConnection("connecting");
      setConnectionActivity("connecting");
      currentPeerSessionId = peerSessionId;
      currentOfferSdp = offer.sdp;
      const peer = createPeerConnection();
      const enableCandidatePublishing = configureCandidatePublishing(
        peer,
        sessionId,
      );
      try {
        await peer.setRemoteDescription(offer);
        await addRemoteCandidates(signal?.ownerCandidates);
        await peer.setLocalDescription(await peer.createAnswer());
        const description = peer.localDescription;
        if (!description || peer.connectionState === "closed") {
          return;
        }
        await publishRealtimeSignal(
          roomId,
          sessionId,
          description.toJSON(),
        );
        enableCandidatePublishing();
      } catch (error) {
        if (connection === peer) {
          closePeerConnection();
        }
        const message =
          error instanceof Error ? error.message : "P2P answer failed";
        setConnection("error");
        setConnectionError(message);
        setConnectionActivity("error", message);
        throw error;
      } finally {
        negotiating = false;
      }
    };

    const connect = async () => {
      try {
        setConnection("connecting");
        setConnectionActivity("connecting");
        const joined = await joinRealtimeRoom(
          roomId,
          getShareRoomOwnerToken(roomId),
          getShareRoomClientId(roomId),
        );
        if (disposed) {
          return;
        }
        sessionIdRef.current = joined.sessionId;
        connectedRole = joined.role;
        setRole(joined.role);
        if (joined.role === "owner") {
          clearTemporaryShareRoom(roomId);
        }
        setMembers((current) => {
          const clientId = getShareRoomClientId(roomId);
          const member = current.find((item) => item.clientId === clientId);
          if (member) {
            return current.map((item) =>
              item.clientId === clientId
                ? { ...item, role: joined.role, status: "online" }
                : item,
            );
          }
          return [...current, { clientId, role: joined.role, status: "online" }];
        });
        heartbeatTimer = window.setInterval(() => {
          void heartbeatRealtimeRoom(roomId, joined.sessionId).catch((error) => {
            if (redirectIfRoomClosed(error)) {
              return;
            }
            console.warn("Room heartbeat failed", error);
          });
        }, 15_000);

        const refreshStatus = async () => {
          const status = await getRealtimeRoomStatus(roomId, joined.sessionId);
          if (disposed) {
            return;
          }
          setMembers(status.members);
          if (joined.role === "owner") {
            await ensureOwnerConnection(joined.sessionId, status);
          } else {
            await ensureGuestConnection(joined.sessionId, status);
          }
        };

        const credentials = await getRealtimeIceServers(
          roomId,
          joined.sessionId,
        );
        iceServers = credentials.iceServers;
        await refreshStatus();
        const pollStatus = async () => {
          let nextDelay = 3000;
          try {
            await refreshStatus();
          } catch (error) {
            if (redirectIfRoomClosed(error)) {
              return;
            }
            if (
              error instanceof RealtimeRoomRequestError &&
              error.status === 429
            ) {
              nextDelay = 10_000;
            }
            console.warn("Failed to refresh room presence", error);
          } finally {
            if (!disposed) {
              pollTimer = window.setTimeout(pollStatus, nextDelay);
            }
          }
        };
        pollTimer = window.setTimeout(pollStatus, 3000);
      } catch (error) {
        if (!disposed) {
          if (redirectIfRoomClosed(error)) {
            return;
          }
          const message =
            error instanceof Error ? error.message : "Could not connect";
          setConnection("error");
          setConnectionError(message);
          setConnectionActivity("error", message);
        }
      }
    };

    void connect();
    const leaveGuest = () => {
      const sessionId = sessionIdRef.current;
      if (sessionId && connectedRole === "guest") {
        void leaveRealtimeRoom(roomId, sessionId, true).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", leaveGuest);
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", leaveGuest);
      leaveGuest();
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
      }
      if (handshakeTimer) {
        window.clearInterval(handshakeTimer);
      }
      if (statsTimer) {
        window.clearInterval(statsTimer);
      }
      closePeerConnection();
      sessionIdRef.current = null;
    };
  }, [
    addRoomImage,
    labels,
    removeRoomImage,
    roomId,
    showFloatingEmoji,
    updateRoomImage,
    upsertActivity,
  ]);

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

  const handleFiles = async (fileList: FileList | File[]) => {
    const channel = controlChannelRef.current;
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
        if (file.size > MAX_IMAGE_TRANSFER_SIZE) {
          upsertActivity({
            id: `error-${Date.now()}-${file.name}`,
            kind: "error",
            title: file.name,
            detail: labels.tooLarge,
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
        window.setTimeout(() => {
          void (async () => {
            try {
              const placeholder = await generateSharePlaceholder(file);
              if (
                deletedImageIdsRef.current.has(meta.id) ||
                !imagesRef.current.some((current) => current.id === meta.id)
              ) {
                return;
              }
              updateRoomImage(meta.id, { placeholder });
              const activeChannel = controlChannelRef.current;
              if (activeChannel?.readyState === "open") {
                sendImagePlaceholder(activeChannel, meta, placeholder);
              }
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
                    error instanceof Error
                      ? error.message
                      : labels.previewFailed,
                  createdAt: Date.now(),
                });
              }
            }
          })();
        }, 0);
      }
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleSendImage = async (image: RoomImage) => {
    const controlChannel = controlChannelRef.current;
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
      );
      let meta: ReturnType<typeof createImageTransferMeta>;
      if (preparation.mode === "r2") {
        meta = createImageTransferMeta(
          file,
          image.id,
          transferChunkSizeRef.current,
        );
        await uploadFileToR2(preparation.uploadUrl, file, (progress) => {
          updateSendingActivity({
            ...meta,
            transferredBytes: progress.transferredBytes,
            progress: progress.progress,
          });
        });
        const uploaded = await confirmRealtimeR2Upload(
          roomId!,
          sessionIdRef.current!,
          transferImage,
          preparation.objectKey,
        );
        await markRealtimeR2Shared(
          roomId!,
          sessionIdRef.current!,
          preparation.objectKey,
        );
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
      updateRoomImage(image.id, { transferStatus: "failed" }, true);
      upsertActivity({
        id: `transfer-${image.id}`,
        kind: "error",
        title: image.name,
        detail:
          error instanceof Error ? error.message : labels.transferFailed,
        createdAt: Date.now(),
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteImage = async (image: RoomImage) => {
    const status = image.transferStatus || "waiting";
    const channel = controlChannelRef.current;
    if (
      image.direction !== "sent" ||
      (status !== "waiting" && status !== "failed") ||
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

  const handleTemporaryLeave = async () => {
    const sessionId = sessionIdRef.current;
    if (!roomId || role !== "owner" || !sessionId || isRoomActionPending) {
      return;
    }
    setIsRoomActionPending(true);
    try {
      await leaveRealtimeRoomTemporarily(roomId, sessionId);
      markShareRoomTemporarilyAway(roomId);
      window.location.assign("/");
    } catch (error) {
      setIsRoomActionPending(false);
      upsertActivity({
        id: `error-${Date.now()}`,
        kind: "error",
        title: labels.temporaryLeave,
        detail: error instanceof Error ? error.message : labels.failed,
        createdAt: Date.now(),
      });
    }
  };

  const handleCloseRoom = async () => {
    const sessionId = sessionIdRef.current;
    if (
      !roomId ||
      role !== "owner" ||
      !sessionId ||
      isRoomActionPending ||
      !window.confirm(labels.confirmClose)
    ) {
      return;
    }
    setIsRoomActionPending(true);
    try {
      await closeRealtimeRoom(roomId, sessionId);
      clearOwnedShareRoom(roomId);
      window.location.assign("/");
    } catch (error) {
      setIsRoomActionPending(false);
      upsertActivity({
        id: `error-${Date.now()}`,
        kind: "error",
        title: labels.closeRoom,
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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
    <main className="h-screen overflow-hidden bg-[#eef2f7] text-slate-800">
      <div className="grid h-full grid-rows-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-4">
              {role === "owner" ? (
                <button
                  type="button"
                  onClick={() => void handleTemporaryLeave()}
                  disabled={isRoomActionPending}
                  className="shrink-0 disabled:opacity-50"
                  aria-label={labels.temporaryLeave}
                  title={labels.temporaryLeave}
                >
                  <Image
                    src="/images/wordmark.png"
                    alt="PicBind"
                    width={178}
                    height={38}
                    className="h-9 w-auto object-contain"
                    priority
                  />
                </button>
              ) : (
                <Link href="/" className="shrink-0">
                  <Image
                    src="/images/wordmark.png"
                    alt="PicBind"
                    width={178}
                    height={38}
                    className="h-9 w-auto object-contain"
                    priority
                  />
                </Link>
              )}
              <div className="hidden h-7 w-px bg-slate-200 sm:block" />
              <div className="hidden min-w-0 sm:block">
                <div className="text-xs font-medium text-slate-500">
                  {labels.room}
                </div>
                <div className="truncate font-mono text-sm font-semibold text-slate-800">
                  {roomId || "..."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label={copied ? labels.copied : labels.copy}
                title={copied ? labels.copied : labels.copy}
              >
                {copied ? (
                  <FiCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FiCopy className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              {role === "owner" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleTemporaryLeave()}
                    disabled={isRoomActionPending}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                    aria-label={labels.temporaryLeave}
                    title={labels.temporaryLeave}
                  >
                    <FiMinimize2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCloseRoom()}
                    disabled={isRoomActionPending}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    aria-label={labels.closeRoom}
                    title={labels.closeRoom}
                  >
                    <FiLogOut className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <Link
                  href="/"
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  aria-label={labels.back}
                  title={labels.back}
                >
                  <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  {labels.workspace}
                </h1>
                <p className="mt-1 text-sm text-slate-500">{labels.cached}</p>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isSending || connection !== "connected"}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? (
                  <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FiUploadCloud className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{isSending ? labels.uploading : labels.upload}</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) {
                    void handleFiles(event.target.files);
                  }
                }}
              />
            </div>

            <div
              className={`min-h-[260px] flex-1 rounded-lg border-2 border-dashed transition ${
                isDragging
                  ? "border-[#2f65cf] bg-blue-50"
                  : "border-slate-300 bg-white/70"
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (connection === "connected") setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                if (connection === "connected") {
                  void handleFiles(event.dataTransfer.files);
                }
              }}
            >
              {images.length ? (
                <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4 xl:grid-cols-4 2xl:grid-cols-5">
                  {images.map((image) => {
                    const status = image.transferStatus ||
                      (image.direction === "sent" ? "sent" : "received");
                    const progress = Math.round((image.progress || 0) * 100);
                    const statusLabel =
                      status === "waiting"
                        ? image.direction === "sent"
                          ? image.placeholder
                            ? labels.waitingToSend
                            : labels.preparingPreview
                          : labels.waitingForSender
                        : status === "sending"
                          ? `${labels.sending} ${progress}%`
                          : status === "receiving"
                            ? `${labels.receiving} ${progress}%`
                            : status === "awaiting-receipt"
                              ? labels.awaitingReceipt
                              : status === "failed"
                                ? labels.transferFailed
                                : status === "sent"
                                  ? labels.sent
                                  : labels.received;
                    const showProgress =
                      status === "sending" ||
                      status === "receiving" ||
                      status === "awaiting-receipt";
                    const canPreview =
                      !image.previewOnly &&
                      !image.placeholderOnly &&
                      (image.direction === "sent" ||
                        status === "sent" ||
                        status === "received");
                    const isLocalImage = image.direction === "sent";
                    const sendReady =
                      isLocalImage &&
                      Boolean(image.placeholder) &&
                      (status === "waiting" || status === "failed");
                    const sendComplete = isLocalImage && status === "sent";
                    const canDelete =
                      isLocalImage &&
                      (status === "waiting" || status === "failed");
                    const downloadReady =
                      status === "sent" || status === "received";
                    return (
                    <article
                      key={image.id}
                      className="relative overflow-hidden rounded-md border border-slate-200 bg-white"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (canPreview) setPreviewImageId(image.id);
                        }}
                        disabled={!canPreview}
                        className="block aspect-square w-full overflow-hidden bg-slate-100 disabled:cursor-default"
                        aria-label={`${image.name} preview`}
                      >
                        {image.placeholder && image.direction === "received" ? (
                          <RoomImageMedia
                            alt={image.name}
                            src={image.placeholderOnly ? undefined : image.url}
                            placeholder={image.placeholder}
                          />
                        ) : (
                          <>
                            {/* Blob URLs are local browser assets and cannot use the Next image optimizer. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image.url}
                              alt={image.name}
                              className={`h-full w-full transition duration-200 hover:scale-[1.02] ${
                                image.previewOnly
                                  ? "object-contain [image-rendering:auto]"
                                  : "object-cover"
                              }`}
                            />
                          </>
                        )}
                      </button>
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteImage(image)}
                          disabled={connection !== "connected"}
                          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-500 shadow-sm backdrop-blur transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45"
                          aria-label={labels.deleteImage}
                          title={labels.deleteImage}
                        >
                          <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      <div className="p-3">
                        <div
                          className="truncate text-sm font-semibold text-slate-800"
                          title={image.name}
                        >
                          {middleEllipsisFileName(image.name)}
                        </div>
                        <div className="mt-1 flex min-h-6 items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{formatBytes(image.size)}</span>
                          {isLocalImage ? (
                            <button
                              type="button"
                              onClick={() => void handleSendImage(image)}
                              disabled={
                                !sendReady ||
                                isSending ||
                                connection !== "connected"
                              }
                              className={`shrink-0 font-semibold transition ${
                                sendReady
                                  ? "text-[#2f65cf] hover:text-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
                                  : sendComplete
                                    ? "cursor-default text-emerald-600"
                                    : "cursor-default text-slate-400"
                              }`}
                            >
                              {sendReady
                                ? labels.send
                                : sendComplete
                                  ? labels.sent
                                  : statusLabel}
                            </button>
                          ) : (
                            <span className="shrink-0">{statusLabel}</span>
                          )}
                        </div>
                        {image.previewOnly ? (
                          <div className="mt-2 text-[11px] text-slate-400">
                            {labels.previewOnly}
                          </div>
                        ) : null}
                        {downloadReady ? (
                          <a
                            href={image.url}
                            download={image.name}
                            className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{labels.download}</span>
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="relative mt-3 flex h-9 w-full cursor-not-allowed items-center justify-center gap-2 overflow-hidden rounded-md border border-slate-200 text-xs font-semibold text-slate-400"
                          >
                            {showProgress ? (
                              <span
                                className="absolute inset-y-0 left-0 bg-blue-100/70 transition-[width] duration-150"
                                style={{ width: `${progress}%` }}
                              />
                            ) : null}
                            <FiDownload className="relative h-3.5 w-3.5" aria-hidden="true" />
                            <span className="relative">
                              {labels.download}
                              {showProgress ? ` · ${progress}%` : ""}
                            </span>
                          </button>
                        )}
                      </div>
                    </article>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={connection !== "connected"}
                  onClick={() => inputRef.current?.click()}
                  className="flex h-full min-h-[260px] w-full flex-col items-center justify-center px-6 text-center disabled:cursor-default"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
                    <FiImage className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <span className="mt-4 text-base font-semibold text-slate-800">
                    {labels.guestEmpty}
                  </span>
                  <span className="mt-1 text-sm text-slate-500">
                    {labels.dropHint}
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FiWifi className="h-4 w-4" aria-hidden="true" />
              <span>
                {connection === "connected"
                  ? labels.connected
                  : connection === "connecting"
                    ? labels.connecting
                    : connection === "error"
                      ? labels.failed
                      : labels.waiting}
              </span>
            </div>
            <div className="mt-2 text-[11px] font-medium text-slate-500">
              <span>
                {labels.latency}{" "}
                {networkLatencyMs != null
                  ? `${networkLatencyMs} ms`
                  : "--"}
              </span>
            </div>
            {connectionError ? (
              <p className="mt-2 text-xs text-red-600">{connectionError}</p>
            ) : null}
          </div>

          <div className="border-b border-slate-200 px-4 py-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
              <FiUsers className="h-4 w-4" aria-hidden="true" />
              <span>{labels.participants}</span>
            </div>
            <div className="space-y-2">
              {members.map((member, index) => {
                const online = member.status === "online";
                const isCurrentUser =
                  roomId !== null &&
                  member.clientId === getShareRoomClientId(roomId);
                const name =
                  member.role === "owner"
                    ? labels.owner
                    : `${labels.guest} ${
                        members
                          .slice(0, index + 1)
                          .filter((item) => item.role === "guest").length
                      }`;
                return (
                <div
                  key={member.clientId}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold uppercase text-slate-600">
                      {member.role === "owner" ? "O" : "G"}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-700">
                      {name}
                      {isCurrentUser ? (
                        <span className="ml-1 text-xs text-[#2f65cf]">
                          ({labels.you})
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {role === "owner" && member.role === "guest" ? (
                      <button
                        type="button"
                        onClick={() => void handleKickMember(member.clientId)}
                        disabled={kickingClientId !== null}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-45"
                        aria-label={labels.kickMember}
                        title={labels.kickMember}
                      >
                        {kickingClientId === member.clientId ? (
                          <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <FiUserX className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                    <span
                      className={`block h-2.5 w-2.5 rounded-full ring-2 ring-white ${online ? "bg-emerald-500" : "bg-slate-300"}`}
                      title={online ? labels.online : labels.offline}
                      role="img"
                      aria-label={online ? labels.online : labels.offline}
                    >
                      <span className="sr-only">
                        {online ? labels.online : labels.offline}
                      </span>
                    </span>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          <div className="min-w-0 overflow-hidden border-b border-slate-200 px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
              {labels.testMessage}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleTextMessage();
              }}
            >
              <input
                value={textMessage}
                onChange={(event) => setTextMessage(event.target.value)}
                maxLength={200}
                disabled={connection !== "connected"}
                placeholder={labels.textPlaceholder}
                className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <button
                type="submit"
                disabled={connection !== "connected" || !textMessage.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={labels.sendMessage}
                title={labels.sendMessage}
              >
                <FiSend className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
            <div className="mb-2 mt-3 text-[11px] font-semibold uppercase text-slate-400">
              {labels.quickReactions}
            </div>
            <div
              ref={emojiScrollerRef}
              className="grid w-full min-w-0 max-w-full grid-flow-col grid-rows-2 auto-cols-[2.5rem] gap-2 overflow-x-auto overscroll-x-contain pb-1"
            >
              {TEST_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleEmoji(emoji)}
                  disabled={connection !== "connected"}
                  className={`flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-xl transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 ${
                    pressedEmoji === emoji
                      ? "-translate-y-1 scale-125 border-blue-400 bg-blue-50 shadow-md"
                      : "scale-100"
                  }`}
                  aria-label={`${labels.quickReactions} ${emoji}`}
                  title={`${labels.quickReactions} ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase text-slate-500">
              {labels.activity}
            </div>
            <div
              ref={activityListRef}
              className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2"
            >
              {activities.length ? (
                activities.map((activity) => {
                  const Icon =
                    activity.kind === "sending"
                      ? FiUploadCloud
                      : activity.kind === "receiving"
                        ? FiDownload
                        : activity.kind === "message"
                          ? FiMessageCircle
                        : activity.kind === "complete"
                          ? FiCheckCircle
                          : activity.kind === "error"
                            ? FiAlertCircle
                            : FiWifi;
                  return (
                    <div
                      key={activity.id}
                      className={`relative min-h-[42px] overflow-hidden rounded-md px-2 py-1.5 ${
                        activity.kind === "error"
                          ? "bg-red-50"
                          : activity.kind === "complete"
                            ? "bg-emerald-50"
                            : "bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                            activity.kind === "error"
                              ? "bg-red-100 text-red-600"
                              : activity.kind === "complete"
                                ? "bg-emerald-100 text-emerald-600"
                                : "bg-blue-100 text-[#2f65cf]"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 leading-4">
                            <span
                              className="min-w-0 truncate text-xs font-semibold text-slate-800"
                              title={activity.title}
                            >
                              {middleEllipsisFileName(activity.title, 32)}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {formatTime(activity.createdAt)}
                            </span>
                          </div>
                          {activity.detail ? (
                            <p
                              className="truncate text-[11px] leading-4 text-slate-500"
                              title={activity.detail}
                            >
                              {activity.detail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {typeof activity.progress === "number" &&
                      activity.progress < 1 ? (
                        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-200">
                          <div
                            className="h-full bg-[#2f65cf] transition-[width] duration-150"
                            style={{
                              width: `${Math.round(activity.progress * 100)}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="flex h-full min-h-24 items-center justify-center text-center text-sm text-slate-400">
                  {labels.noActivity}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
      {isShareDialogOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="created-share-room-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsShareDialogOpen(false);
            }
          }}
        >
          <div className="w-full max-w-[460px] rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2
                id="created-share-room-title"
                className="text-lg font-semibold"
              >
                {labels.shareCreatedTitle}
              </h2>
              <button
                type="button"
                onClick={() => setIsShareDialogOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label={labels.closeDialog}
                title={labels.closeDialog}
              >
                <FiX className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {labels.room}
                </div>
                <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                  {roomId}
                </div>
              </div>
              <div>
                <label
                  htmlFor="created-share-room-link"
                  className="text-xs font-semibold uppercase text-slate-500"
                >
                  {labels.shareLink}
                </label>
                <div className="mt-1 flex min-w-0 gap-2">
                  <input
                    id="created-share-room-link"
                    readOnly
                    value={shareUrl}
                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#2f65cf] px-3 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
                  >
                    {copied ? (
                      <FiCheck className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <FiCopy className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{copied ? labels.copied : labels.copy}</span>
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-500">{labels.expires}</p>
            </div>
          </div>
        </div>
      ) : null}
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
      <div className="pointer-events-none fixed inset-0 z-[105] overflow-hidden" aria-hidden="true">
        {floatingEmojis.map((item) => (
          <span
            key={item.id}
            className="picbind-live-emoji-motion absolute top-[72%]"
            style={{
              left: `calc(50% + ${item.startX}px)`,
              offsetPath: item.path,
              animationDuration: `${item.duration}ms`,
            }}
          >
            <span
              className="picbind-live-emoji-visual block text-5xl"
              style={{ animationDuration: `${item.duration}ms` }}
            >
              {item.emoji}
            </span>
          </span>
        ))}
      </div>
      <style jsx global>{`
        .picbind-live-emoji-motion {
          offset-distance: 0%;
          offset-rotate: 0deg;
          animation-name: picbind-emoji-motion;
          animation-timing-function: cubic-bezier(0.18, 0.7, 0.22, 1);
          animation-fill-mode: forwards;
          will-change: offset-distance;
        }
        .picbind-live-emoji-visual {
          animation-name: picbind-emoji-visual;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
          will-change: transform, opacity, filter;
        }
        @keyframes picbind-emoji-motion {
          from { offset-distance: 0%; }
          to { offset-distance: 100%; }
        }
        @keyframes picbind-emoji-visual {
          0% { opacity: 0; filter: blur(1px); transform: scale(0.45) rotate(-6deg); }
          10% { opacity: 1; filter: blur(0); transform: scale(0.7) rotate(2deg); }
          55% { opacity: 0.95; filter: blur(0); transform: scale(1.35) rotate(-2deg); }
          78% { opacity: 0.72; filter: blur(1.5px); transform: scale(1.75) rotate(2deg); }
          100% { opacity: 0; filter: blur(9px); transform: scale(2.35) rotate(0deg); }
        }
      `}</style>
    </main>
  );
}
