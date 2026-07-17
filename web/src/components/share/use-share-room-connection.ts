"use client";

import React from "react";
import { formatBytes } from "./share-room-formatters";
import type { ShareRoomLabels } from "./share-room-labels";
import type {
  ActivityItem,
  ConnectionState,
  MessageTransportMode,
  RoomDockNotification,
  RoomImage,
} from "./share-room-types";
import {
  clearTemporaryShareRoom,
  getShareRoomClientId,
  getShareRoomOwnerToken,
} from "@/utils/share-room";
import {
  getRealtimeIceServers,
  getRealtimeR2Download,
  getRealtimeRoomStatus,
  heartbeatRealtimeRoom,
  leaveRealtimeRoom,
  joinRealtimeRoom,
  publishRealtimeCandidate,
  publishRealtimeSignal,
  confirmRealtimeR2Download,
  RealtimeRoomRequestError,
  type RoomRole,
  type RoomMemberPresence,
} from "@/utils/realtime-room";
import {
  RealtimeImageReceiver,
  createImageTransferMeta,
  sendImagePlaceholder,
  sendImageReady,
  sendImageReceipt,
} from "@/utils/realtime-image-transfer";
import {
  deleteRoomImage,
  storeRoomImage,
  type CachedRoomImage,
} from "@/utils/realtime-image-store";
import {
  createPeerMessageId,
  parsePeerMessage,
  sendPeerMessage,
} from "@/utils/realtime-peer-messages";
import { generateSharePlaceholder } from "@/utils/share-placeholder";
import { downloadFileFromR2 } from "@/utils/realtime-r2-transfer";
import { clearRoomPageState } from "@/utils/realtime-room-page-store";
import {
  AdaptiveMessageChannel,
  WeakNetworkSocket,
  type RealtimeMessageChannel,
} from "@/utils/weak-network-socket";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

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
  if (Number.isFinite(roundTripTime) && roundTripTime >= 0) {
    return Math.round(roundTripTime * 1000);
  }
  const totalRoundTripTime = Number(selectedPair.totalRoundTripTime);
  const responsesReceived = Number(selectedPair.responsesReceived);
  return Number.isFinite(totalRoundTripTime) &&
    totalRoundTripTime >= 0 &&
    Number.isFinite(responsesReceived) &&
    responsesReceived > 0
    ? Math.round((totalRoundTripTime / responsesReceived) * 1000)
    : null;
}

type UseShareRoomConnectionOptions = {
  roomId: string | null;
  labels: ShareRoomLabels;
  controlChannelRef: React.MutableRefObject<RealtimeMessageChannel | null>;
  instructionChannelRef: React.MutableRefObject<RealtimeMessageChannel | null>;
  outgoingChannelRef: React.MutableRefObject<RTCDataChannel | null>;
  transferChunkSizeRef: React.MutableRefObject<number>;
  maxImageTransferSizeRef: React.MutableRefObject<number>;
  sessionIdRef: React.MutableRefObject<string | null>;
  deletedImageIdsRef: React.MutableRefObject<Set<string>>;
  imagesRef: React.MutableRefObject<RoomImage[]>;
  imageReadyWaitersRef: React.MutableRefObject<
    Map<string, { resolve(): void; timeoutId: number }>
  >;
  addRoomImage(image: CachedRoomImage): void;
  updateRoomImage(
    id: string,
    patch: Partial<Omit<RoomImage, "id" | "url">>,
    persist?: boolean,
  ): void;
  removeRoomImage(id: string): void;
  upsertActivity(activity: ActivityItem): void;
  showFloatingEmoji(id: string, emoji: string): void;
  onIncomingNotification?(notification: RoomDockNotification): void;
  onForcedNavigation(): void;
  onWeakNetworkChange(weakNetwork: boolean): void;
  onMessageTransportChange(mode: MessageTransportMode): void;
  setActivities: React.Dispatch<React.SetStateAction<ActivityItem[]>>;
  setConnection: React.Dispatch<React.SetStateAction<ConnectionState>>;
  setConnectionError: React.Dispatch<React.SetStateAction<string | null>>;
  setMembers: React.Dispatch<React.SetStateAction<RoomMemberPresence[]>>;
  setNetworkLatencyMs: React.Dispatch<React.SetStateAction<number | null>>;
  setPacketLossRate: React.Dispatch<React.SetStateAction<number | null>>;
  setMaxImageTransferSize: React.Dispatch<React.SetStateAction<number | null>>;
  setRole: React.Dispatch<React.SetStateAction<RoomRole | null>>;
};

export function useShareRoomConnection({
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
  onIncomingNotification,
  onForcedNavigation,
  onWeakNetworkChange,
  onMessageTransportChange,
  setActivities,
  setConnection,
  setConnectionError,
  setMembers,
  setNetworkLatencyMs,
  setPacketLossRate,
  setMaxImageTransferSize,
  setRole,
}: UseShareRoomConnectionOptions) {
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
    let instructionChannel: RTCDataChannel | null = null;
    let fileChannel: RTCDataChannel | null = null;
    let probeChannel: RTCDataChannel | null = null;
    let probeTimer: number | undefined;
    const pendingProbes = new Map<string, number>();
    const probeResults: boolean[] = [];
    let socketRelay: WeakNetworkSocket | null = null;
    let adaptiveControl: AdaptiveMessageChannel | null = null;
    let adaptiveInstruction: AdaptiveMessageChannel | null = null;
    let iceServers: RTCIceServer[] = [];
    let currentPeerSessionId: string | null = null;
    let currentOfferSdp: string | null = null;
    const appliedRemoteCandidates = new Set<string>();
    let negotiating = false;
    let handshakeId = "";
    let handshakeAttempts = 0;
    let handshakeAcknowledged = false;
    let placeholdersPublished = false;
    let networkMonitorStartedAt = 0;
    let networkCheckInFlight = false;
    const imageReadyWaiters = imageReadyWaitersRef.current;

    const forceRoomNavigation = (reason: "closed" | "kicked") => {
      clearRoomPageState(roomId);
      onForcedNavigation();
      window.location.replace(
        reason === "closed" ? "/?roomClosed=1" : "/?roomKicked=1",
      );
    };

    const redirectIfRoomClosed = (error: unknown) => {
      if (error instanceof RealtimeRoomRequestError && error.status === 404) {
        forceRoomNavigation("closed");
        return true;
      }
      if (
        error instanceof RealtimeRoomRequestError &&
        error.status === 403 &&
        /removed|revoked/i.test(error.message)
      ) {
        forceRoomNavigation("kicked");
        return true;
      }
      return false;
    };

    const confirmReceipt = (id: string, attempt = 0) => {
      if (disposed) {
        return;
      }
      const channel = instructionChannelRef.current;
      if (channel?.readyState === "open") {
        sendImageReceipt(channel, id);
        return;
      }
      if (attempt < 100) {
        window.setTimeout(() => confirmReceipt(id, attempt + 1), 100);
      }
    };

    const notifiedIncomingImages = new Set<string>();
    const notifyIncomingImage = (id: string, name: string) => {
      if (notifiedIncomingImages.has(id)) return;
      notifiedIncomingImages.add(id);
      onIncomingNotification?.({
        id: `image-${id}`,
        kind: "image",
        label: name,
        createdAt: Date.now(),
      });
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
        notifyIncomingImage(meta.id, meta.name);
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
        notifyIncomingImage(meta.id, meta.name);
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
        notifyIncomingImage(meta.id, meta.name);
        updateRoomImage(
          meta.id,
          { transferStatus: "receiving", progress: 0, transferMode: "p2p" },
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
        const channel = instructionChannelRef.current;
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
          transferMode: current?.transferMode || "p2p",
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
      onCancel(id) {
        updateRoomImage(
          id,
          { transferStatus: "cancelled", progress: 0 },
          true,
        );
        const image = imagesRef.current.find((current) => current.id === id);
        upsertActivity({
          id: `transfer-${id}`,
          kind: "cancelled",
          title: image?.name || labels.transferCancelled,
          detail: labels.transferCancelled,
          progress: 0,
          createdAt: Date.now(),
        });
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
          { transferStatus: "receiving", progress: 0, transferMode: "r2" },
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
            transferMode: "r2",
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
    }, () => maxImageTransferSizeRef.current);

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
      const activeChannel = instructionChannelRef.current;
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
            image.transferStatus !== "failed" &&
            image.transferStatus !== "cancelled")
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
        socketRelay?.markUnavailable();
        setConnection("error");
        setConnectionError(message);
        setConnectionActivity("error", message);
        closePeerConnection();
        return;
      }
      handshakeAttempts += 1;
      sendPeerMessage(instructionChannelRef.current, {
        type: "HELLO",
        payload: { id: handshakeId },
      });
    };

    const startHandshake = () => {
      if (
        instructionChannel?.readyState !== "open" ||
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
      if (sendPeerMessage(instructionChannelRef.current, message)) {
        return;
      }
      if (attempt < 100) {
        window.setTimeout(() => sendWhenReady(message, attempt + 1), 100);
      }
    };

    const handleControlMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const peerMessage = parsePeerMessage(event.data);
      if (peerMessage?.type === "EMOJI") {
        onIncomingNotification?.({
          id: `emoji-${peerMessage.payload.id}`,
          kind: "emoji",
          label: peerMessage.payload.emoji,
          createdAt: Date.now(),
        });
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
        onIncomingNotification?.({
          id: `text-${peerMessage.payload.id}`,
          kind: "text",
          label: peerMessage.payload.text,
          createdAt: Date.now(),
        });
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
    };

    const handleInstructionMessage = (event: MessageEvent) => {
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
      adaptiveControl?.setDataChannel(nextChannel);
      controlChannel.onmessage = handleControlMessage;
      controlChannel.onopen = () => {
        controlChannelRef.current = adaptiveControl;
        startHandshake();
      };
      controlChannel.onclose = () => {
        stopHandshake();
        handshakeAcknowledged = false;
        placeholdersPublished = false;
        adaptiveControl?.setDataChannel(null);
        if (!disposed && !socketRelay?.canRelay) {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      if (controlChannel.readyState === "open") {
        controlChannelRef.current = adaptiveControl;
        startHandshake();
      }
    };

    const attachInstructionChannel = (nextChannel: RTCDataChannel) => {
      instructionChannel = nextChannel;
      adaptiveInstruction?.setDataChannel(nextChannel);
      handshakeId = createPeerMessageId();
      handshakeAttempts = 0;
      handshakeAcknowledged = false;
      placeholdersPublished = false;
      instructionChannel.onmessage = handleInstructionMessage;
      instructionChannel.onopen = () => {
        instructionChannelRef.current = adaptiveInstruction;
        startHandshake();
      };
      instructionChannel.onclose = () => {
        stopHandshake();
        handshakeAcknowledged = false;
        placeholdersPublished = false;
        adaptiveInstruction?.setDataChannel(null);
        if (!disposed && !socketRelay?.canRelay) {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      if (instructionChannel.readyState === "open") {
        instructionChannelRef.current = adaptiveInstruction;
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
        if (!disposed && !socketRelay?.canRelay) {
          setConnection("waiting");
          setConnectionActivity("waiting");
        }
      };
      if (fileChannel.readyState === "open") {
        outgoingChannelRef.current = fileChannel;
      }
    };

    const resetProbeStats = () => {
      pendingProbes.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pendingProbes.clear();
      probeResults.length = 0;
      setPacketLossRate(null);
    };

    const recordProbeResult = (received: boolean) => {
      probeResults.push(received);
      if (probeResults.length > 20) probeResults.shift();
      const lost = probeResults.filter((result) => !result).length;
      setPacketLossRate((lost / probeResults.length) * 100);
    };

    const attachProbeChannel = (nextChannel: RTCDataChannel) => {
      probeChannel = nextChannel;
      const sendProbe = () => {
        if (probeChannel?.readyState !== "open" || socketRelay?.canRelay) return;
        const id = crypto.randomUUID().replace(/-/g, "");
        probeChannel.send(JSON.stringify({ type: "PING", id }));
        const timeoutId = window.setTimeout(() => {
          if (!pendingProbes.delete(id)) return;
          recordProbeResult(false);
        }, 3000);
        pendingProbes.set(id, timeoutId);
      };
      const startProbes = () => {
        resetProbeStats();
        if (probeTimer) window.clearInterval(probeTimer);
        sendProbe();
        probeTimer = window.setInterval(sendProbe, 1000);
      };
      probeChannel.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let message: { type?: unknown; id?: unknown };
        try {
          message = JSON.parse(event.data) as typeof message;
        } catch {
          return;
        }
        if (message.type === "PING" && typeof message.id === "string") {
          if (probeChannel?.readyState === "open") {
            probeChannel.send(JSON.stringify({ type: "PONG", id: message.id }));
          }
          return;
        }
        if (message.type === "PONG" && typeof message.id === "string") {
          const timeoutId = pendingProbes.get(message.id);
          if (timeoutId === undefined) return;
          window.clearTimeout(timeoutId);
          pendingProbes.delete(message.id);
          recordProbeResult(true);
        }
      };
      probeChannel.onopen = startProbes;
      probeChannel.onclose = () => {
        if (probeTimer) window.clearInterval(probeTimer);
        probeTimer = undefined;
        resetProbeStats();
      };
      if (probeChannel.readyState === "open") startProbes();
    };

    const closePeerConnection = () => {
      stopHandshake();
      for (const waiter of [...imageReadyWaiters.values()]) waiter.resolve();
      if (!disposed) setNetworkLatencyMs(null);
      if (controlChannel) {
        controlChannel.onclose = null;
        controlChannel.close();
      }
      if (instructionChannel) {
        instructionChannel.onclose = null;
        instructionChannel.close();
      }
      if (fileChannel) {
        fileChannel.onclose = null;
        fileChannel.close();
      }
      if (probeChannel) {
        probeChannel.onclose = null;
        probeChannel.close();
      }
      if (probeTimer) {
        window.clearInterval(probeTimer);
        probeTimer = undefined;
      }
      resetProbeStats();
      if (connection) {
        connection.ondatachannel = null;
        connection.onconnectionstatechange = null;
        connection.onicecandidate = null;
        connection.close();
      }
      controlChannel = null;
      instructionChannel = null;
      fileChannel = null;
      probeChannel = null;
      connection = null;
      outgoingChannelRef.current = null;
      adaptiveControl?.setDataChannel(null);
      adaptiveInstruction?.setDataChannel(null);
      currentPeerSessionId = null;
      currentOfferSdp = null;
      appliedRemoteCandidates.clear();
      handshakeAcknowledged = false;
      placeholdersPublished = false;
      negotiating = false;
    };

    const monitorNetwork = async () => {
      if (disposed || networkCheckInFlight || !socketRelay) return;
      const peer = connection;
      const graceExpired =
        networkMonitorStartedAt > 0 &&
        Date.now() - networkMonitorStartedAt >= 10_000;
      if (!peer) {
        if (graceExpired) socketRelay.markUnavailable();
        return;
      }
      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "disconnected" ||
        peer.connectionState === "closed"
      ) {
        setNetworkLatencyMs(null);
        socketRelay.markUnavailable();
        return;
      }
      if (peer.connectionState !== "connected" && !graceExpired) return;

      networkCheckInFlight = true;
      try {
        const latencyMs = await readWebRtcLatency(peer);
        if (disposed || connection !== peer) return;
        if (!socketRelay.canRelay) setNetworkLatencyMs(latencyMs);
        socketRelay.updateRtt(latencyMs);
      } catch {
        if (!disposed && connection === peer) {
          setNetworkLatencyMs(null);
          socketRelay.markUnavailable();
        }
      } finally {
        networkCheckInFlight = false;
      }
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
          socketRelay?.markUnavailable();
          if (socketRelay?.canRelay) {
            setConnection("connected");
            setConnectionError(null);
            setConnectionActivity("connected");
          } else {
            setConnection("error");
            setConnectionActivity("error", "P2P connection failed");
          }
          closePeerConnection();
        } else if (peer.connectionState === "disconnected") {
          socketRelay?.markUnavailable();
          if (!socketRelay?.canRelay) {
            setConnection("waiting");
            setConnectionActivity("waiting");
          }
        }
      };
      peer.ondatachannel = (event) => {
        if (event.channel.label === "picbind-messages") attachControlChannel(event.channel);
        else if (event.channel.label === "picbind-instructions") {
          attachInstructionChannel(event.channel);
        }
        else if (event.channel.label === "picbind-files") attachFileChannel(event.channel);
        else if (event.channel.label === "picbind-network-probe") {
          attachProbeChannel(event.channel);
        }
      };
      connection = peer;
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
      socketRelay?.markPeerAvailable();

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
          peer.createDataChannel("picbind-messages", { ordered: true }),
        );
        attachInstructionChannel(
          peer.createDataChannel("picbind-instructions", { ordered: true }),
        );
        attachFileChannel(
          peer.createDataChannel("picbind-files", { ordered: false }),
        );
        attachProbeChannel(
          peer.createDataChannel("picbind-network-probe", {
            ordered: false,
            maxRetransmits: 0,
          }),
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
      if (peerSessionId) socketRelay?.markPeerAvailable();
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
        const initialStatus = await getRealtimeRoomStatus(roomId);
        if (disposed) return;
        setMembers(initialStatus.members);
        const joined = await joinRealtimeRoom(
          roomId,
          getShareRoomOwnerToken(roomId),
          getShareRoomClientId(roomId),
        );
        if (disposed) {
          return;
        }
        sessionIdRef.current = joined.sessionId;
        maxImageTransferSizeRef.current = joined.maxImageTransferSize;
        setMaxImageTransferSize(joined.maxImageTransferSize);
        connectedRole = joined.role;
        setRole(joined.role);
        socketRelay = new WeakNetworkSocket({
          roomId,
          sessionId: joined.sessionId,
          onMessage(channel, payload) {
            const event = new MessageEvent("message", { data: payload });
            if (channel === "control") handleControlMessage(event);
            else handleInstructionMessage(event);
          },
          onRoomClosed() {
            forceRoomNavigation("closed");
          },
          onRoomKicked() {
            forceRoomNavigation("kicked");
          },
          onWeakNetworkChange,
          onSocketLatencyChange(latencyMs) {
            if (!disposed && socketRelay?.canRelay) {
              setNetworkLatencyMs(latencyMs);
            }
          },
          onRelayReadyChange(ready) {
            if (disposed) return;
            onMessageTransportChange(ready ? "relay" : "p2p");
            if (ready) {
              resetProbeStats();
              stopHandshake();
              handshakeAcknowledged = true;
              setConnection("connected");
              setConnectionError(null);
              setConnectionActivity("connected");
              void publishWaitingPlaceholders();
            } else if (
              controlChannel?.readyState !== "open" ||
              instructionChannel?.readyState !== "open"
            ) {
              setConnection("waiting");
              setConnectionActivity("waiting");
            }
            if (!ready) setNetworkLatencyMs(null);
          },
        });
        adaptiveControl = new AdaptiveMessageChannel("control", socketRelay);
        adaptiveInstruction = new AdaptiveMessageChannel(
          "instruction",
          socketRelay,
        );
        controlChannelRef.current = adaptiveControl;
        instructionChannelRef.current = adaptiveInstruction;
        networkMonitorStartedAt = Date.now();
        void monitorNetwork();
        statsTimer = window.setInterval(() => void monitorNetwork(), 2000);
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
      socketRelay?.disconnect();
      socketRelay = null;
      adaptiveControl = null;
      adaptiveInstruction = null;
      controlChannelRef.current = null;
      instructionChannelRef.current = null;
      onMessageTransportChange("p2p");
      sessionIdRef.current = null;
    };
  }, [
    addRoomImage,
    controlChannelRef,
    instructionChannelRef,
    deletedImageIdsRef,
    imageReadyWaitersRef,
    imagesRef,
    maxImageTransferSizeRef,
    labels,
    outgoingChannelRef,
    onIncomingNotification,
    onForcedNavigation,
    onWeakNetworkChange,
    onMessageTransportChange,
    removeRoomImage,
    roomId,
    sessionIdRef,
    setActivities,
    setConnection,
    setConnectionError,
    setMembers,
    setMaxImageTransferSize,
    setNetworkLatencyMs,
    setPacketLossRate,
    setRole,
    showFloatingEmoji,
    transferChunkSizeRef,
    updateRoomImage,
    upsertActivity,
  ]);

}
