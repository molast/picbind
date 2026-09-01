"use client";

import React from "react";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { FaWeixin } from "react-icons/fa";
import { FiCheck, FiChevronLeft, FiChevronRight, FiImage, FiLoader, FiPlusSquare, FiSend, FiSmile, FiX } from "react-icons/fi";
import type { MessagingProviderSnapshot } from "../../messaging";
import type { WorkspaceEditorLabels } from "../../locales";

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

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export function WorkspaceWeixinChatDialog({ open, provider, messages, labels, sending, sendingImage, canMoveImages, onSend, onOpenImagePicker, onMoveImage, onLoadImage, onClose }: {
  open: boolean;
  provider: MessagingProviderSnapshot | null;
  messages: WeixinChatItem[];
  labels: WorkspaceEditorLabels;
  sending: boolean;
  sendingImage: boolean;
  canMoveImages: boolean;
  onSend(text: string): Promise<boolean>;
  onOpenImagePicker(): void;
  onMoveImage(item: WeixinChatItem): Promise<boolean>;
  onLoadImage(item: WeixinChatItem): void;
  onClose(): void;
}) {
  const [draft, setDraft] = React.useState("");
  const [movingImageId, setMovingImageId] = React.useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = React.useState<string | null>(null);
  const [previewImageId, setPreviewImageId] = React.useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const imageItemRefs = React.useRef(new Map<string, HTMLElement>());

  React.useEffect(() => { if (!open) { setDraft(""); setEmojiOpen(false); } }, [open]);
  React.useEffect(() => {
    if (open && messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, open]);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && (previewImageId ? setPreviewImageId(null) : emojiOpen ? setEmojiOpen(false) : onClose());
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [emojiOpen, onClose, open, previewImageId]);

  if (!open || !provider) return null;
  const providerMessages = messages.filter((message) => message.providerId === provider.id);
  const images = providerMessages.filter((message) => message.type === "image");
  const previewImages = images.filter((image): image is WeixinChatItem & { url: string } => Boolean(image.url));
  const previewIndex = previewImages.findIndex((image) => image.id === previewImageId);
  const previewImage = previewIndex >= 0 ? previewImages[previewIndex] : null;
  const connected = provider.status === "connected";
  const busy = sending || sendingImage;
  const submit = async () => {
    const text = draft.trim().slice(0, 2000);
    if (!text || busy || !provider.recipientId || !connected) return;
    if (await onSend(text)) setDraft("");
  };
  const moveImage = async (image: WeixinChatItem) => {
    if (!canMoveImages || !image.blob || image.movedToLibrary || movingImageId) return;
    setMovingImageId(image.id);
    try { await onMoveImage(image); } finally { setMovingImageId(null); }
  };
  const focusImage = (imageId: string) => {
    setSelectedImageId(imageId);
    imageItemRefs.current.get(imageId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return <>
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/50 p-4">
      <section className="flex h-[min(76vh,680px)] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={labels.messagingChat}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#e9f8ef] text-[#07c160]"><FaWeixin className="h-5 w-5" /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold text-slate-900">{provider.displayName}</h2><p className={`text-[11px] ${connected ? "text-emerald-600" : "text-slate-400"}`}>{connected ? labels.messagingConnected : labels.messagingDisconnected}</p></div></div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={labels.closeDialog}><FiX className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r">
            <div ref={messageListRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
              {providerMessages.length ? providerMessages.map((message) => <div key={message.id} className={`flex ${message.direction === "outgoing" ? "justify-end" : "justify-start"}`}><div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${message.direction === "outgoing" ? "bg-[#2f65cf] text-white" : "border border-slate-200 bg-white text-slate-800"}`}>
                {message.type === "image" ? <button type="button" onClick={() => focusImage(message.id)} className={`flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left ${message.direction === "outgoing" ? "hover:bg-white/10" : "hover:bg-slate-50"}`}><FiImage className="h-4 w-4 shrink-0" /><span className="truncate text-xs font-medium">{message.fileName || labels.messagingImage}</span></button> : null}
                {message.text ? <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p> : null}
                <div className={`mt-1 flex items-center justify-end gap-1 text-[9px] ${message.direction === "outgoing" ? "text-blue-100" : "text-slate-400"}`}>{message.status === "sending" ? <FiLoader className="h-2.5 w-2.5 animate-spin" /> : null}<span>{formatTime(message.createdAt)}</span></div>
              </div></div>) : <div className="flex h-full items-center justify-center text-sm text-slate-400">{labels.messagingNoMessages}</div>}
            </div>
            <form className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <div className="relative min-w-0 flex-1">
                <textarea
                  value={draft}
                  onFocus={() => setEmojiOpen(false)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  rows={3}
                  maxLength={2000}
                  disabled={!connected || !provider.recipientId || busy}
                  placeholder={labels.textPlaceholder}
                  className="block min-h-[84px] w-full resize-none rounded-md border border-slate-200 px-3 pb-10 pt-2 text-sm outline-none focus:border-blue-400 disabled:bg-slate-50"
                />
                <div className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={!connected || !provider.recipientId || busy}
                    onClick={() => setEmojiOpen((value) => !value)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf] disabled:cursor-not-allowed disabled:opacity-40"
                    title={labels.messagingEmoji}
                    aria-label={labels.messagingEmoji}
                  ><FiSmile className="h-[17px] w-[17px]" /></button>
                  <button
                    type="button"
                    disabled={!connected || !provider.recipientId || busy}
                    onClick={() => { setEmojiOpen(false); onOpenImagePicker(); }}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#2f65cf] disabled:cursor-not-allowed disabled:opacity-40"
                    title={labels.messagingSendImage}
                    aria-label={labels.messagingSendImage}
                  ><FiImage className="h-[17px] w-[17px]" /></button>
                </div>
                {emojiOpen ? <div className="absolute bottom-10 left-1 z-10 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
                  <EmojiPicker
                    open
                    width={320}
                    height={420}
                    theme={Theme.LIGHT}
                    emojiStyle={EmojiStyle.NATIVE}
                    lazyLoadEmojis
                    searchPlaceHolder={labels.messagingEmojiSearch}
                    previewConfig={{ showPreview: false }}
                    onEmojiClick={(emoji) => setDraft((current) => `${current}${emoji.emoji}`)}
                  />
                </div> : null}
              </div>
              <button type="submit" disabled={!connected || !draft.trim() || !provider.recipientId || busy} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#2f65cf] text-white hover:bg-[#2457bd] disabled:cursor-not-allowed disabled:opacity-40" aria-label={labels.sendMessage}>{sending ? <FiLoader className="h-4 w-4 animate-spin" /> : <FiSend className="h-4 w-4" />}</button>
            </form>
          </div>
          <aside className="flex min-h-0 flex-col bg-white">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-3 text-xs font-semibold text-slate-600"><FiImage className="h-4 w-4" /><span>{labels.messagingImages}</span><span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{images.length}</span></div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {images.length ? images.map((image) => <article key={image.id} ref={(node) => { if (node) imageItemRefs.current.set(image.id, node); else imageItemRefs.current.delete(image.id); }} className={`flex min-w-0 items-center gap-1 rounded-md border bg-white p-1.5 ${selectedImageId === image.id ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                <button type="button" onClick={() => { focusImage(image.id); if (image.url) setPreviewImageId(image.id); }} disabled={!image.url} className="flex min-w-0 flex-1 items-center gap-2 rounded text-left disabled:cursor-wait"><LazyMessagingPreview image={image} alt={image.fileName || labels.messagingImage} onVisible={onLoadImage} /><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium text-slate-700" title={image.fileName}>{image.fileName || labels.messagingImage}</div><div className="text-[9px] text-slate-400">{typeof image.size === "number" ? formatBytes(image.size) : ""}</div></div></button>
                {image.direction === "incoming" && canMoveImages ? <button type="button" disabled={!image.blob || image.movedToLibrary || Boolean(movingImageId)} onClick={() => void moveImage(image)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed ${image.movedToLibrary ? "bg-emerald-50 text-emerald-600" : "text-slate-500 hover:bg-slate-100 disabled:opacity-40"}`} title={image.movedToLibrary ? labels.messagingMovedToImageList : labels.messagingMoveToImageList}>{movingImageId === image.id ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : image.movedToLibrary ? <FiCheck className="h-3.5 w-3.5" /> : <FiPlusSquare className="h-3.5 w-3.5" />}</button> : null}
              </article>) : <div className="flex h-full min-h-28 items-center justify-center text-center text-xs text-slate-400">{labels.messagingNoImages}</div>}
            </div>
          </aside>
        </div>
      </section>
    </div>
    {previewImage ? <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-5" role="dialog" aria-modal="true" aria-label={previewImage.fileName || labels.messagingImage}>
      <img src={previewImage.url} alt={previewImage.fileName || labels.messagingImage} className="max-h-full max-w-full object-contain" />
      <button type="button" onClick={() => setPreviewImageId(null)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-md bg-black/45 text-white hover:bg-black/65" aria-label={labels.closeDialog}><FiX /></button>
      {previewImages.length > 1 ? <><button type="button" onClick={() => setPreviewImageId(previewImages[(previewIndex - 1 + previewImages.length) % previewImages.length].id)} className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-md bg-black/45 text-white hover:bg-black/65" aria-label={labels.previousImage}><FiChevronLeft /></button><button type="button" onClick={() => setPreviewImageId(previewImages[(previewIndex + 1) % previewImages.length].id)} className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-md bg-black/45 text-white hover:bg-black/65" aria-label={labels.nextImage}><FiChevronRight /></button></> : null}
    </div> : null}
  </>;
}

function LazyMessagingPreview({ image, alt, onVisible }: { image: WeixinChatItem; alt: string; onVisible(item: WeixinChatItem): void }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (image.url || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      onVisible(image);
    }, { rootMargin: "100px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [image, onVisible]);
  return image.url ? <img src={image.url} alt={alt} className="h-11 w-11 shrink-0 rounded bg-slate-50 object-cover" /> : <span ref={ref} className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-slate-50 text-slate-300"><FiLoader className="h-4 w-4 animate-spin" /></span>;
}
