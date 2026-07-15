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
  FiUploadCloud,
  FiUsers,
  FiWifi,
} from "react-icons/fi";
import RoomImagePreviewDialog from "@/components/room-image-preview-dialog";
import { getLang, type Lang } from "@/locales";
import {
  clearOwnedShareRoom,
  clearTemporaryShareRoom,
  getShareRoomClientId,
  getShareRoomOwnerToken,
  markShareRoomTemporarilyAway,
} from "@/utils/share-room";
import {
  closeRealtimeRoom,
  getRealtimeIceServers,
  getRealtimeRoomStatus,
  heartbeatRealtimeRoom,
  leaveRealtimeRoom,
  leaveRealtimeRoomTemporarily,
  joinRealtimeRoom,
  publishRealtimeSignal,
  RealtimeRoomRequestError,
  type RoomRole,
  type RoomMemberPresence,
} from "@/utils/realtime-room";
import { waitForIceGatheringComplete } from "@/utils/realtime-p2p";
import {
  RealtimeImageReceiver,
  MAX_IMAGE_TRANSFER_SIZE,
  createImageTransferMeta,
  sendImageReceipt,
  sendImageFile,
  sendImagePreview,
  type TransferProgress,
} from "@/utils/realtime-image-transfer";
import {
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
import { generateShareThumbnail } from "@/utils/share-thumbnail";

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

export default function ShareRoomPage() {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const outgoingChannelRef = React.useRef<RTCDataChannel | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const objectUrlsRef = React.useRef(new Set<string>());
  const imageIdsRef = React.useRef(new Set<string>());
  const imagesRef = React.useRef<RoomImage[]>([]);
  const [lang, setLang] = React.useState<Lang>("en");
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [role, setRole] = React.useState<RoomRole | null>(null);
  const [connection, setConnection] =
    React.useState<ConnectionState>("waiting");
  const [connectionError, setConnectionError] = React.useState<string | null>(
    null,
  );
  const [members, setMembers] = React.useState<RoomMemberPresence[]>([]);
  const [activities, setActivities] = React.useState<ActivityItem[]>([]);
  const [images, setImages] = React.useState<RoomImage[]>([]);
  const [previewImageId, setPreviewImageId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [pressedEmoji, setPressedEmoji] = React.useState<string | null>(null);
  const [isRoomActionPending, setIsRoomActionPending] = React.useState(false);

  const labels = React.useMemo(
    () =>
      lang === "zh"
      ? {
          back: "返回首页",
          room: "分享房间",
          copy: "复制房间链接",
          copied: "链接已复制",
          invalid: "分享链接无效",
          workspace: "图片工作区",
          upload: "选择图片",
          uploading: "正在发送",
          drop: "拖入图片开始传输",
          dropHint: "支持常见图片格式，单张最大 50 MB",
          guestEmpty: "等待 Owner 发送图片",
          cached: "图片保存在当前浏览器",
          sent: "已发送",
          received: "已接收",
          send: "发送图片",
          waitingToSend: "等待发送",
          waitingForSender: "等待对方发送",
          preparingPreview: "正在生成预览",
          previewFailed: "缩略图生成失败",
          previewOnly: "32×32 预览",
          download: "下载图片",
          participants: "匿名成员",
          owner: "匿名 Owner",
          guest: "匿名 Guest",
          you: "你",
          online: "在线",
          offline: "离线",
          activity: "传输消息",
          noActivity: "暂无传输消息",
          testMessage: "测试消息",
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
          invalid: "Invalid share link",
          workspace: "Image workspace",
          upload: "Choose images",
          uploading: "Sending",
          drop: "Drop images to transfer",
          dropHint: "Common image formats, up to 50 MB each",
          guestEmpty: "Waiting for the Owner to send images",
          cached: "Images are stored in this browser",
          sent: "Sent",
          received: "Received",
          send: "Send image",
          waitingToSend: "Waiting to send",
          waitingForSender: "Waiting for sender",
          preparingPreview: "Preparing preview",
          previewFailed: "Thumbnail generation failed",
          previewOnly: "32×32 preview",
          download: "Download image",
          participants: "Anonymous members",
          owner: "Anonymous Owner",
          guest: "Anonymous Guest",
          you: "You",
          online: "Online",
          offline: "Offline",
          activity: "Transfer messages",
          noActivity: "No transfer messages yet",
          testMessage: "Test message",
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
  const previewImage = images.find((image) => image.id === previewImageId) || null;

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

  React.useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    const imageIds = imageIdsRef.current;
    setLang(getLang());
    setRoomId(readRoomId());
    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      imageIds.clear();
      imagesRef.current = [];
    };
  }, []);

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
    let connectedRole: RoomRole | null = null;
    let connection: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    let iceServers: RTCIceServer[] = [];
    let currentPeerSessionId: string | null = null;
    let currentOfferSdp: string | null = null;
    let negotiating = false;
    let handshakeId = "";
    let handshakeAcknowledged = false;
    let previewsPublished = false;

    const redirectIfRoomClosed = (error: unknown) => {
      if (error instanceof RealtimeRoomRequestError && error.status === 404) {
        window.location.replace("/?roomClosed=1");
        return true;
      }
      return false;
    };

    const confirmReceipt = (id: string, attempt = 0) => {
      if (disposed) {
        return;
      }
      const channel = outgoingChannelRef.current;
      if (channel?.readyState === "open") {
        sendImageReceipt(channel, id);
        return;
      }
      if (attempt < 100) {
        window.setTimeout(() => confirmReceipt(id, attempt + 1), 100);
      }
    };

    const receiver = new RealtimeImageReceiver({
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
          createdAt: Date.now(),
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

    const publishWaitingPreviews = async () => {
      const activeChannel = outgoingChannelRef.current;
      if (
        previewsPublished ||
        connectedRole !== "owner" ||
        activeChannel?.readyState !== "open"
      ) {
        return;
      }
      previewsPublished = true;
      for (const image of imagesRef.current) {
        if (
          image.direction !== "sent" ||
          image.previewOnly ||
          (image.transferStatus !== "waiting" &&
            image.transferStatus !== "failed")
        ) {
          continue;
        }
        try {
          const file = new File([image.blob], image.name, { type: image.type });
          const meta = createImageTransferMeta(file, image.id);
          sendImagePreview(
            activeChannel,
            meta,
            await generateShareThumbnail(file),
          );
        } catch (error) {
          console.warn("Failed to publish queued image preview", error);
        }
      }
    };

    const sendHello = () => {
      sendPeerMessage(outgoingChannelRef.current, {
        type: "HELLO",
        payload: { id: handshakeId },
      });
    };

    const startHandshake = () => {
      if (
        channel?.readyState !== "open" ||
        handshakeAcknowledged ||
        handshakeTimer ||
        disposed
      ) {
        return;
      }
      setConnection("connecting");
      setConnectionActivity("connecting");
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
      if (sendPeerMessage(outgoingChannelRef.current, message)) {
        return;
      }
      if (attempt < 100) {
        window.setTimeout(() => sendWhenReady(message, attempt + 1), 100);
      }
    };

    const handleChannelMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        if (event.data instanceof ArrayBuffer) {
          receiver.handle(event.data);
        }
        return;
      }
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
        void publishWaitingPreviews();
        return;
      }
      if (peerMessage?.type === "EMOJI") {
        upsertActivity({
          id: `message-${peerMessage.payload.id}`,
          kind: "message",
          title: peerMessage.payload.emoji,
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

    const attachChannel = (nextChannel: RTCDataChannel) => {
      channel = nextChannel;
      channel.binaryType = "arraybuffer";
      handshakeId = createPeerMessageId();
      handshakeAcknowledged = false;
      previewsPublished = false;
      channel.onmessage = handleChannelMessage;
      channel.onopen = () => {
        outgoingChannelRef.current = channel;
        startHandshake();
      };
      channel.onclose = () => {
        stopHandshake();
        handshakeAcknowledged = false;
        previewsPublished = false;
        outgoingChannelRef.current = null;
        if (!disposed) {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      if (channel.readyState === "open") {
        outgoingChannelRef.current = channel;
        startHandshake();
      }
    };

    const closePeerConnection = () => {
      stopHandshake();
      if (channel) {
        channel.onclose = null;
        channel.close();
      }
      if (connection) {
        connection.ondatachannel = null;
        connection.onconnectionstatechange = null;
        connection.close();
      }
      channel = null;
      connection = null;
      outgoingChannelRef.current = null;
      currentPeerSessionId = null;
      currentOfferSdp = null;
      handshakeAcknowledged = false;
      previewsPublished = false;
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
      peer.ondatachannel = (event) => attachChannel(event.channel);
      connection = peer;
      return peer;
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
        attachChannel(
          peer.createDataChannel("picbind-files", { ordered: true }),
        );
        try {
          await peer.setLocalDescription(await peer.createOffer());
          await waitForIceGatheringComplete(peer);
          const description = peer.localDescription;
          if (!description || peer.connectionState === "closed") {
            return;
          }
          await publishRealtimeSignal(
            roomId,
            sessionId,
            description.toJSON(),
          );
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
      try {
        await peer.setRemoteDescription(offer);
        await peer.setLocalDescription(await peer.createAnswer());
        await waitForIceGatheringComplete(peer);
        const description = peer.localDescription;
        if (!description || peer.connectionState === "closed") {
          return;
        }
        await publishRealtimeSignal(
          roomId,
          sessionId,
          description.toJSON(),
        );
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
        pollTimer = window.setInterval(() => {
          void refreshStatus().catch((error) => {
            if (redirectIfRoomClosed(error)) {
              return;
            }
            console.warn("Failed to refresh room presence", error);
          });
        }, 1000);
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
        window.clearInterval(pollTimer);
      }
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
      }
      if (handshakeTimer) {
        window.clearInterval(handshakeTimer);
      }
      closePeerConnection();
      sessionIdRef.current = null;
    };
  }, [addRoomImage, labels, roomId, updateRoomImage, upsertActivity]);

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
    if (role !== "owner") {
      return;
    }
    const channel = outgoingChannelRef.current;
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

        try {
          const meta = createImageTransferMeta(file);
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
            createdAt: Date.now(),
          };
          await storeRoomImage(image);
          addRoomImage(image);
          const thumbnail = await generateShareThumbnail(file);
          sendImagePreview(channel, meta, thumbnail);
        } catch (error) {
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
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleSendImage = async (image: RoomImage) => {
    const channel = outgoingChannelRef.current;
    if (
      role !== "owner" ||
      image.direction !== "sent" ||
      image.previewOnly ||
      image.transferStatus === "sending" ||
      isSending ||
      connection !== "connected" ||
      channel?.readyState !== "open"
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
      const meta = await sendImageFile(
        channel,
        file,
        updateSendingActivity,
        image.id,
      );
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
    const sent = sendPeerMessage(outgoingChannelRef.current, {
      type: "EMOJI",
      payload: { id, emoji, sentAt: Date.now() },
    });
    if (!sent) {
      return;
    }
    setPressedEmoji(emoji);
    window.setTimeout(() => {
      setPressedEmoji((current) => (current === emoji ? null : current));
    }, 280);
    upsertActivity({
      id: `message-${id}`,
      kind: "message",
      title: emoji,
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
              {role === "owner" ? (
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
              ) : null}
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
                if (role === "owner") setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                if (role === "owner") {
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
                          ? labels.waitingToSend
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
                    return (
                    <article
                      key={image.id}
                      className="overflow-hidden rounded-md border border-slate-200 bg-white"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewImageId(image.id)}
                        className="block aspect-square w-full overflow-hidden bg-slate-100"
                        aria-label={`${image.name} preview`}
                      >
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
                      </button>
                      <div className="p-3">
                        <div className="truncate text-sm font-semibold text-slate-800">
                          {image.name}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{formatBytes(image.size)}</span>
                          <span>{statusLabel}</span>
                        </div>
                        {image.previewOnly ? (
                          <div className="mt-2 text-[11px] text-slate-400">
                            {labels.previewOnly}
                          </div>
                        ) : null}
                        {image.direction === "sent" &&
                        (status === "waiting" || status === "failed") ? (
                          <button
                            type="button"
                            onClick={() => void handleSendImage(image)}
                            disabled={isSending || connection !== "connected"}
                            className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-semibold text-white transition hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <FiSend className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{labels.send}</span>
                          </button>
                        ) : showProgress ? (
                          <div className="mt-3 rounded-md border border-slate-200 px-3 py-2.5">
                            <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500">
                              <span className="truncate">{statusLabel}</span>
                              <span>{progress}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-[#2f65cf] transition-[width] duration-150"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        ) : status === "waiting" ? (
                          <div className="mt-3 flex h-9 items-center justify-center rounded-md border border-slate-200 text-xs font-semibold text-slate-500">
                            {labels.waitingForSender}
                          </div>
                        ) : (
                          <a
                            href={image.url}
                            download={image.name}
                            className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-slate-200 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{labels.download}</span>
                          </a>
                        )}
                      </div>
                    </article>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={role !== "owner" || connection !== "connected"}
                  onClick={() => inputRef.current?.click()}
                  className="flex h-full min-h-[260px] w-full flex-col items-center justify-center px-6 text-center disabled:cursor-default"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
                    <FiImage className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <span className="mt-4 text-base font-semibold text-slate-800">
                    {role === "owner" ? labels.drop : labels.guestEmpty}
                  </span>
                  {role === "owner" ? (
                    <span className="mt-1 text-sm text-slate-500">
                      {labels.dropHint}
                    </span>
                  ) : null}
                </button>
              )}
            </div>
          </div>
        </section>

        <aside className="grid min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
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
                  <div className="flex min-w-0 items-center gap-2.5">
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
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <span
                      className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`}
                    />
                    {online ? labels.online : labels.offline}
                  </span>
                </div>
                );
              })}
            </div>
          </div>

          <div className="border-b border-slate-200 px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
              {labels.testMessage}
            </div>
            <div className="flex items-center gap-2">
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
                  aria-label={`${labels.testMessage} ${emoji}`}
                  title={`${labels.testMessage} ${emoji}`}
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
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                      className={`rounded-md px-3 py-3 ${
                        activity.kind === "error"
                          ? "bg-red-50"
                          : activity.kind === "complete"
                            ? "bg-emerald-50"
                            : "bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <Icon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            activity.kind === "error"
                              ? "text-red-600"
                              : activity.kind === "complete"
                                ? "text-emerald-600"
                                : "text-[#2f65cf]"
                          }`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-slate-800">
                              {activity.title}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400">
                              {formatTime(activity.createdAt)}
                            </span>
                          </div>
                          {activity.detail ? (
                            <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                              {activity.detail}
                            </p>
                          ) : null}
                          {typeof activity.progress === "number" &&
                          activity.progress < 1 ? (
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-[#2f65cf] transition-[width] duration-150"
                                style={{
                                  width: `${Math.round(activity.progress * 100)}%`,
                                }}
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>
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
      {previewImage ? (
        <RoomImagePreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreviewImageId(null);
          }}
          src={previewImage.url}
          name={previewImage.name}
        />
      ) : null}
    </main>
  );
}
