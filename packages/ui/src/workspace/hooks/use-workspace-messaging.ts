import React from "react";
import {
  IlinkTauriTransport,
  MessagingService,
  WeixinIlinkProvider,
  type MessagingProviderSnapshot,
} from "../../messaging";
import type { ShareRoomLabels } from "../../locales";
import { useImageProcessing } from "../../image-processing";
import {
  listMessagingImageMetadata,
  readMessagingImage,
  storeMessagingImage,
} from "../../database/repositories/messaging-image-repository";
import type { WeixinChatItem } from "../dialogs/workspace-weixin-chat-dialog";
import { readWorkspaceImageSource } from "../repository";
import type {
  WorkspaceImage,
  WorkspaceMessagingCompressionMode,
  WorkspacePreparedMessagingImage,
} from "../types";

const MAX_MESSAGES = 300;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type PreparedMessagingFile = Omit<WorkspacePreparedMessagingImage, "providerId" | "previewUrl">;

async function waitForImageDecode(url: string) {
  const preview = new Image();
  preview.decoding = "async";
  preview.src = url;
  if (preview.decode) {
    await preview.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (preview.complete && preview.naturalWidth > 0) {
      resolve();
      return;
    }
    preview.onload = () => resolve();
    preview.onerror = () => reject(new Error("Compressed image preview could not be decoded"));
  });
}

function fileExtension(mimeType: string) {
  return ({
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/jxl": "jxl",
    "image/png": "png",
    "image/webp": "webp",
  } as Record<string, string>)[mimeType] || "jpg";
}

export function useWorkspaceMessaging({
  desktop,
  workspaceId,
  canAddImages,
  labels,
  addFiles,
  onError,
}: {
  desktop: boolean;
  workspaceId?: string;
  canAddImages: boolean;
  labels: ShareRoomLabels;
  addFiles(files: File[]): Promise<void>;
  onError(message: string): void;
}) {
  const imageProcessing = useImageProcessing();
  const service = React.useMemo(() => desktop
    ? new MessagingService([new WeixinIlinkProvider(new IlinkTauriTransport())])
    : undefined, [desktop]);
  const [providers, setProviders] = React.useState<MessagingProviderSnapshot[]>([]);
  const [chatProviderId, setChatProviderId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<WeixinChatItem[]>([]);
  const [unreadCounts, setUnreadCounts] = React.useState<Record<string, number>>({});
  const [sending, setSending] = React.useState(false);
  const [sendingImage, setSendingImage] = React.useState(false);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const [quickSendPreparingImageId, setQuickSendPreparingImageId] = React.useState<string | null>(null);
  const [quickSendPreview, setQuickSendPreview] = React.useState<WorkspacePreparedMessagingImage | null>(null);
  const sendingRef = React.useRef(false);
  const quickSendPreparingRef = React.useRef(false);
  const quickSendPreviewRef = React.useRef<WorkspacePreparedMessagingImage | null>(null);
  const chatProviderIdRef = React.useRef<string | null>(null);
  const imageLoadsRef = React.useRef(new Set<string>());
  const objectUrlsRef = React.useRef(new Set<string>());

  const revokeUrl = React.useCallback((url?: string) => {
    if (!url || !objectUrlsRef.current.has(url)) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  }, []);
  const createUrl = React.useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  }, []);
  const clearQuickSendPreview = React.useCallback((releaseUrl: boolean) => {
    const current = quickSendPreviewRef.current;
    if (releaseUrl && current) revokeUrl(current.previewUrl);
    quickSendPreviewRef.current = null;
    setQuickSendPreview(null);
  }, [revokeUrl]);
  const appendMessage = React.useCallback((message: WeixinChatItem) => {
    setMessages((current) => {
      const all = [...current, message];
      all.slice(0, Math.max(0, all.length - MAX_MESSAGES)).forEach((item) => revokeUrl(item.url));
      return all.slice(-MAX_MESSAGES);
    });
  }, [revokeUrl]);

  React.useEffect(() => {
    chatProviderIdRef.current = chatProviderId;
  }, [chatProviderId]);

  React.useEffect(() => {
    if (!service) {
      setProviders([]);
      return;
    }
    const refresh = () => setProviders(service.getProviders());
    refresh();
    return service.subscribeStatus(refresh);
  }, [service]);

  React.useEffect(() => {
    if (!service || !workspaceId) return;
    const provider = service.getProvider("weixin-ilink");
    if (!(provider instanceof WeixinIlinkProvider)) return;
    let active = true;
    void provider.getGatewayStatus().then(async (snapshot) => {
      if (!active || !snapshot.configured) return;
      await service.startProvider(provider.id);
    }).catch((error) => {
      if (!active) return;
      console.warn("Failed to restore cached Weixin iLink connection", error);
      onError(error instanceof Error ? error.message : labels.messagingConnectionFailed);
    });
    return () => { active = false; };
  }, [labels.messagingConnectionFailed, onError, service, workspaceId]);

  React.useEffect(() => {
    setUnreadCounts({});
    imageLoadsRef.current.clear();
    chatProviderIdRef.current = null;
    setChatProviderId(null);
    clearQuickSendPreview(true);
    quickSendPreparingRef.current = false;
    setQuickSendPreparingImageId(null);
    setMessages((current) => {
      current.forEach((item) => revokeUrl(item.url));
      return [];
    });
    if (!workspaceId || !service) return;
    let active = true;
    void listMessagingImageMetadata(workspaceId).then((images) => {
      if (!active) return;
      setMessages(images.map((image): WeixinChatItem => ({
        id: image.messageId,
        providerId: image.providerId,
        direction: image.direction,
        type: "image",
        fileName: image.fileName,
        mimeType: image.mimeType,
        size: image.size,
        createdAt: image.createdAt,
        status: "sent",
      })).sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_MESSAGES));
    }).catch((error) => console.warn("Failed to restore cached Weixin images", error));
    return () => { active = false; };
  }, [clearQuickSendPreview, revokeUrl, service, workspaceId]);

  React.useEffect(() => {
    if (!service || !workspaceId) return;
    let active = true;
    const unsubscribe = service.subscribe((message) => {
      const provider = service.getProviders().find((candidate) => candidate.channel === message.channel);
      const providerId = provider?.id || message.channel;
      const item: WeixinChatItem = {
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
      appendMessage(item);
      if (chatProviderIdRef.current !== providerId) {
        setUnreadCounts((current) => ({ ...current, [providerId]: Math.min(999, (current[providerId] || 0) + 1) }));
      }
      const downloadReference = message.payload.downloadUrl || message.payload.fileId;
      if (message.type !== "image" || !downloadReference || !provider) return;
      void service.download(provider.id, downloadReference, message.payload.fileId).then(async (blob) => {
        const mimeType = blob.type && blob.type !== "application/octet-stream"
          ? blob.type
          : message.payload.mimeType || "image/jpeg";
        const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
        await storeMessagingImage({
          roomId: workspaceId,
          providerId,
          messageId: message.id,
          fileName: message.payload.fileName || labels.messagingImage,
          mimeType,
          size: typedBlob.size,
          createdAt: message.timestamp || Date.now(),
          direction: "incoming",
          blob: typedBlob,
        });
        if (!active) return;
        const url = createUrl(typedBlob);
        setMessages((current) => current.map((candidate) => candidate.id === message.id
          ? { ...candidate, blob: typedBlob, url, size: typedBlob.size, mimeType }
          : candidate));
      }).catch((error) => {
        console.warn("Failed to download Weixin image", error);
        if (active) setMessages((current) => current.map((candidate) => candidate.id === message.id ? { ...candidate, status: "error" } : candidate));
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [appendMessage, createUrl, labels.messagingImage, service, workspaceId]);

  React.useEffect(() => () => {
    if (service) void service.stopProvider("weixin-ilink").catch(() => undefined);
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, [service]);

  const openChat = React.useCallback((providerId = "weixin-ilink") => {
    chatProviderIdRef.current = providerId;
    setUnreadCounts((current) => {
      if (!current[providerId]) return current;
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    setChatProviderId(providerId);
  }, []);

  const sendText = React.useCallback(async (textValue: string) => {
    const provider = providers.find((candidate) => candidate.id === chatProviderIdRef.current);
    const text = textValue.trim().slice(0, 2000);
    if (!provider?.recipientId || provider.status !== "connected" || !service || !workspaceId || !text || sendingRef.current) return false;
    const messageId = `message_${crypto.randomUUID()}`;
    const createdAt = Date.now();
    sendingRef.current = true;
    appendMessage({ id: messageId, providerId: provider.id, direction: "outgoing", type: "text", text, createdAt, status: "sending" });
    setSending(true);
    try {
      await service.send(provider.id, {
        id: messageId,
        channel: provider.channel,
        senderId: workspaceId,
        conversationId: provider.recipientId,
        type: "text",
        payload: { text },
        timestamp: createdAt,
      });
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, status: "sent" } : message));
      return true;
    } catch (error) {
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, status: "error" } : message));
      onError(error instanceof Error ? error.message : labels.messagingConnectionFailed);
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [appendMessage, labels.messagingConnectionFailed, onError, providers, service, workspaceId]);

  const clearImageError = React.useCallback(() => setImageError(null), []);
  const reportImageError = React.useCallback((message: string) => {
    setImageError(message);
    onError(message);
  }, [onError]);

  const prepareMessagingFile = React.useCallback(async (
    image: WorkspaceImage,
    sendOriginal: boolean,
    compressionMode: WorkspaceMessagingCompressionMode,
  ): Promise<PreparedMessagingFile> => {
    const source = await readWorkspaceImageSource(image);
    if (!source) throw new Error(labels.messagingImageUnavailable);
    const sourceMimeType = (source.type || image.mimeType).toLowerCase();
    if (sendOriginal && (sourceMimeType === "image/avif" || /\.avif$/i.test(image.name))) {
      throw new Error(labels.messagingAvifUnsupported);
    }
    if (!sendOriginal && sourceMimeType === "image/gif") {
      throw new Error(labels.messagingGifOriginalRequired);
    }

    let blob = source;
    let name = image.name;
    let mimeType = sourceMimeType === "image/jpg" ? "image/jpeg" : sourceMimeType;
    let width = image.width;
    let height = image.height;
    let returnedOriginal = sendOriginal;
    if (!sendOriginal) {
      const standardFormat = mimeType === "image/jpeg"
        ? "jpeg" as const
        : mimeType === "image/png"
          ? "png" as const
          : "webp" as const;
      const compressionOptions = compressionMode === "fast"
        ? { format: "auto" as const, profile: "messaging-fast" as const }
        : { format: standardFormat, profile: "planner" as const };
      const compressed = await imageProcessing.compress({
        source: { kind: "blob", blob: source, name: image.name, mimeType },
        options: compressionOptions,
        destination: "memory",
      }, { requestId: `workspace-messaging-compress:${image.imageId}:${crypto.randomUUID()}` });
      if (compressed.artifact.kind !== "blob") throw new Error(labels.compressionFailed);
      blob = compressed.artifact.blob;
      name = compressed.name;
      mimeType = (blob.type || compressed.metadata.mimeType).toLowerCase();
      width = compressed.metadata.width;
      height = compressed.metadata.height;
      returnedOriginal = compressed.returnedOriginal;
    }
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) throw new Error(labels.messagingImageUnsupported);
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error(labels.messagingImageTooLarge);

    return {
      imageId: image.imageId,
      file: new File([blob], name, { type: mimeType }),
      originalSize: source.size,
      width,
      height,
      returnedOriginal,
    };
  }, [imageProcessing, labels.compressionFailed, labels.messagingAvifUnsupported, labels.messagingGifOriginalRequired, labels.messagingImageTooLarge, labels.messagingImageUnavailable, labels.messagingImageUnsupported]);

  const deliverMessagingFile = React.useCallback(async (
    provider: MessagingProviderSnapshot,
    prepared: PreparedMessagingFile,
    previewUrl?: string,
  ) => {
    if (!provider.recipientId || provider.status !== "connected" || !service || !workspaceId) {
      throw new Error(labels.messagingConnectionFailed);
    }
    const temporaryId = `image_${crypto.randomUUID()}`;
    const createdAt = Date.now();
    const url = previewUrl || createUrl(prepared.file);
    appendMessage({
      id: temporaryId,
      providerId: provider.id,
      direction: "outgoing",
      type: "image",
      fileName: prepared.file.name,
      mimeType: prepared.file.type,
      size: prepared.file.size,
      blob: prepared.file,
      url,
      createdAt,
      status: "sending",
    });
    try {
      const messageId = await service.upload(provider.id, prepared.file, {
        recipientId: provider.recipientId,
        fileName: prepared.file.name,
      });
      setMessages((current) => current.map((message) => message.id === temporaryId
        ? { ...message, id: messageId, status: "sent" }
        : message));
      await storeMessagingImage({
        roomId: workspaceId,
        providerId: provider.id,
        messageId,
        fileName: prepared.file.name,
        mimeType: prepared.file.type,
        size: prepared.file.size,
        createdAt,
        direction: "outgoing",
        blob: prepared.file,
      }).catch((error) => console.warn("Failed to cache sent Weixin image", error));
    } catch (error) {
      setMessages((current) => current.map((message) => message.id === temporaryId
        ? { ...message, status: "error" }
        : message));
      throw error;
    }
  }, [appendMessage, createUrl, labels.messagingConnectionFailed, service, workspaceId]);

  const sendImage = React.useCallback(async (
    image: WorkspaceImage,
    sendOriginal: boolean,
    compressionMode: WorkspaceMessagingCompressionMode,
  ) => {
    const provider = providers.find((candidate) => candidate.id === chatProviderIdRef.current);
    setImageError(null);
    if (!provider?.recipientId || provider.status !== "connected" || !service || !workspaceId || sendingRef.current || quickSendPreparingRef.current) {
      reportImageError(labels.messagingConnectionFailed);
      return false;
    }

    sendingRef.current = true;
    setSendingImage(true);
    try {
      const prepared = await prepareMessagingFile(image, sendOriginal, compressionMode);
      await deliverMessagingFile(provider, prepared);
      return true;
    } catch (error) {
      reportImageError(error instanceof Error ? error.message : labels.messagingConnectionFailed);
      return false;
    } finally {
      sendingRef.current = false;
      setSendingImage(false);
    }
  }, [deliverMessagingFile, labels.messagingConnectionFailed, prepareMessagingFile, providers, reportImageError, service, workspaceId]);

  const prepareQuickSend = React.useCallback(async (image: WorkspaceImage) => {
    const provider = providers.find((candidate) => candidate.id === "weixin-ilink"
      && candidate.status === "connected"
      && Boolean(candidate.recipientId));
    setImageError(null);
    if (image.shared || !provider || sendingRef.current || quickSendPreparingRef.current) {
      reportImageError(labels.messagingConnectionFailed);
      return false;
    }

    clearQuickSendPreview(true);
    quickSendPreparingRef.current = true;
    setQuickSendPreparingImageId(image.imageId);
    let previewUrl: string | undefined;
    try {
      const prepared = await prepareMessagingFile(image, false, "fast");
      previewUrl = createUrl(prepared.file);
      await waitForImageDecode(previewUrl);
      const preview: WorkspacePreparedMessagingImage = {
        ...prepared,
        providerId: provider.id,
        previewUrl,
      };
      quickSendPreviewRef.current = preview;
      setQuickSendPreview(preview);
      return true;
    } catch (error) {
      if (previewUrl) revokeUrl(previewUrl);
      reportImageError(error instanceof Error ? error.message : labels.messagingConnectionFailed);
      return false;
    } finally {
      quickSendPreparingRef.current = false;
      setQuickSendPreparingImageId(null);
    }
  }, [clearQuickSendPreview, createUrl, labels.messagingConnectionFailed, prepareMessagingFile, providers, reportImageError, revokeUrl]);

  const confirmQuickSend = React.useCallback(async () => {
    const preview = quickSendPreviewRef.current;
    const provider = preview
      ? providers.find((candidate) => candidate.id === preview.providerId)
      : undefined;
    setImageError(null);
    if (!preview || !provider?.recipientId || provider.status !== "connected" || sendingRef.current) {
      reportImageError(labels.messagingConnectionFailed);
      return false;
    }

    sendingRef.current = true;
    setSendingImage(true);
    try {
      await deliverMessagingFile(provider, preview, preview.previewUrl);
      clearQuickSendPreview(false);
      return true;
    } catch (error) {
      clearQuickSendPreview(false);
      reportImageError(error instanceof Error ? error.message : labels.messagingConnectionFailed);
      return false;
    } finally {
      sendingRef.current = false;
      setSendingImage(false);
    }
  }, [clearQuickSendPreview, deliverMessagingFile, labels.messagingConnectionFailed, providers, reportImageError]);

  const cancelQuickSend = React.useCallback(() => {
    if (sendingRef.current) return;
    clearQuickSendPreview(true);
    setImageError(null);
  }, [clearQuickSendPreview]);

  const loadImage = React.useCallback((item: WeixinChatItem) => {
    if (!workspaceId || item.type !== "image" || item.blob) return;
    const key = `${item.providerId}:${item.id}`;
    if (imageLoadsRef.current.has(key)) return;
    imageLoadsRef.current.add(key);
    void readMessagingImage(workspaceId, item.providerId, item.id).then((image) => {
      if (!image) return;
      const url = createUrl(image.blob);
      setMessages((current) => current.map((message) => {
        if (`${message.providerId}:${message.id}` !== key) return message;
        revokeUrl(message.url);
        return { ...message, blob: image.blob, url, size: image.size, mimeType: image.mimeType };
      }));
    }).catch((error) => console.warn("Failed to load cached Weixin image", error))
      .finally(() => imageLoadsRef.current.delete(key));
  }, [createUrl, revokeUrl, workspaceId]);

  const moveImageToLibrary = React.useCallback(async (item: WeixinChatItem) => {
    if (!canAddImages || !item.blob || item.movedToLibrary) return false;
    try {
      const mimeType = item.blob.type || item.mimeType || "image/jpeg";
      const name = item.fileName || `weixin-image.${fileExtension(mimeType)}`;
      await addFiles([new File([item.blob], name, { type: mimeType })]);
      setMessages((current) => current.map((message) => message.id === item.id ? { ...message, movedToLibrary: true } : message));
      return true;
    } catch (error) {
      console.warn("Failed to move Weixin image to the workspace library", error);
      onError(labels.messagingImageMoveFailed);
      return false;
    }
  }, [addFiles, canAddImages, labels.messagingImageMoveFailed, onError]);

  const activeProvider = chatProviderId
    ? providers.find((provider) => provider.id === chatProviderId) || null
    : null;
  const connectedProvider = providers.find((provider) => provider.id === "weixin-ilink"
    && provider.status === "connected"
    && Boolean(provider.recipientId)) || null;

  return {
    service,
    providers,
    activeProvider,
    connectedProvider,
    chatOpen: Boolean(chatProviderId),
    closeChat: () => setChatProviderId(null),
    openChat,
    messages,
    unreadCount: Object.values(unreadCounts).reduce((total, count) => total + count, 0),
    sending,
    sendingImage,
    quickSendPreparingImageId,
    quickSendPreview,
    imageError,
    clearImageError,
    sendText,
    sendImage,
    prepareQuickSend,
    confirmQuickSend,
    cancelQuickSend,
    loadImage,
    moveImageToLibrary,
  };
}
