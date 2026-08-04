"use client";

import React from "react";
import { FaWeixin } from "react-icons/fa";
import {
  FiCheck,
  FiImage,
  FiLoader,
  FiPlusSquare,
  FiSend,
  FiX,
} from "react-icons/fi";
import type { MessagingProviderSnapshot } from "../../messaging";
import type { ShareRoomLabels } from "./share-room-labels";
import { formatBytes, formatTime } from "./share-room-formatters";

export type WeixinChatItem = {
  id: string;
  providerId: string;
  direction: "incoming" | "outgoing";
  type: "text" | "image";
  text?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  blob?: Blob;
  movedToLibrary?: boolean;
  createdAt: number;
  status?: "sending" | "sent" | "error";
};

type WeixinChatDialogProps = {
  open: boolean;
  provider: MessagingProviderSnapshot | null;
  messages: WeixinChatItem[];
  labels: ShareRoomLabels;
  sending: boolean;
  onSend(text: string): Promise<boolean>;
  onMoveImage(item: WeixinChatItem): Promise<boolean>;
  onClose(): void;
};

export default function WeixinChatDialog({
  open,
  provider,
  messages,
  labels,
  sending,
  onSend,
  onMoveImage,
  onClose,
}: WeixinChatDialogProps) {
  const [draft, setDraft] = React.useState("");
  const [movingImageId, setMovingImageId] = React.useState<string | null>(null);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) setDraft("");
  }, [open]);

  React.useEffect(() => {
    if (!open || !messageListRef.current) return;
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, open]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);

  if (!open || !provider) return null;
  const providerMessages = messages.filter((message) => message.providerId === provider.id);
  const images = providerMessages.filter((message) => message.type === "image");
  const connected = provider.status === "connected";
  const submit = async () => {
    const text = draft.trim().slice(0, 2000);
    if (!text || sending || !provider.recipientId || !connected) return;
    if (await onSend(text)) setDraft("");
  };
  const moveImage = async (image: WeixinChatItem) => {
    if (!image.blob || image.movedToLibrary || movingImageId) return;
    setMovingImageId(image.id);
    try {
      await onMoveImage(image);
    } finally {
      setMovingImageId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/50 p-4">
      <section
        className="flex h-[min(76vh,680px)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={labels.messagingChat}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#e9f8ef] text-[#07c160]">
              <FaWeixin className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-900">{provider.displayName}</h2>
              <p className={`text-[11px] ${connected ? "text-emerald-600" : "text-slate-400"}`}>
                {connected ? labels.messagingConnected : labels.messagingDisconnected}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={labels.closeDialog}>
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r">
            <div ref={messageListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
              {providerMessages.length ? providerMessages.map((message) => (
                <div key={message.id} className={`flex ${message.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                    message.direction === "outgoing"
                      ? "bg-[#2f65cf] text-white"
                      : "border border-slate-200 bg-white text-slate-800"
                  }`}>
                    {message.type === "image" && message.url ? (
                      <img src={message.url} alt={message.fileName || labels.messagingImage} className="mb-1 max-h-44 w-auto rounded object-contain" />
                    ) : null}
                    {message.text ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p> : null}
                    <div className={`mt-1 flex items-center justify-end gap-1 text-[9px] ${message.direction === "outgoing" ? "text-blue-100" : "text-slate-400"}`}>
                      {message.status === "sending" ? <FiLoader className="h-2.5 w-2.5 animate-spin" aria-hidden="true" /> : null}
                      <span>{formatTime(message.createdAt)}</span>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">{labels.messagingNoMessages}</div>
              )}
            </div>
            <form className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                rows={2}
                maxLength={2000}
                disabled={!connected || !provider.recipientId || sending}
                placeholder={labels.textPlaceholder}
                className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:bg-slate-50"
              />
              <button type="submit" disabled={!connected || !draft.trim() || !provider.recipientId || sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40" aria-label={labels.sendMessage}>
                {sending ? <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FiSend className="h-4 w-4" aria-hidden="true" />}
              </button>
            </form>
          </div>

          <aside className="flex min-h-0 flex-col bg-white">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-3 text-xs font-semibold text-slate-600">
              <FiImage className="h-4 w-4" aria-hidden="true" />
              <span>{labels.messagingReceivedImages}</span>
              <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{images.length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {images.length ? images.map((image) => (
                <article
                  key={`image-${image.id}`}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5"
                >
                  {image.url ? <img
                    src={image.url}
                    alt={image.fileName || labels.messagingImage}
                    className="h-11 w-11 shrink-0 rounded bg-slate-50 object-cover"
                  /> : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-slate-50 text-slate-300">
                      <FiImage className="h-5 w-5" aria-hidden="true" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[11px] font-medium text-slate-700"
                      title={image.fileName || labels.messagingImage}
                    >
                      {image.fileName || labels.messagingImage}
                    </div>
                    <div className="text-[9px] text-slate-400">{typeof image.size === "number" ? formatBytes(image.size) : ""}</div>
                  </div>
                  <button
                    type="button"
                    disabled={!image.blob || image.movedToLibrary || Boolean(movingImageId)}
                    onClick={() => void moveImage(image)}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed ${image.movedToLibrary ? "bg-emerald-50 text-emerald-600" : "text-slate-500 hover:bg-slate-100 disabled:opacity-40"}`}
                    aria-label={image.movedToLibrary ? labels.messagingMovedToImageList : labels.messagingMoveToImageList}
                    title={image.movedToLibrary ? labels.messagingMovedToImageList : labels.messagingMoveToImageList}
                  >
                    {movingImageId === image.id
                      ? <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : image.movedToLibrary
                        ? <FiCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        : <FiPlusSquare className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                </article>
              )) : <div className="flex h-full min-h-28 items-center justify-center text-center text-xs text-slate-400">{labels.messagingNoImages}</div>}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
