"use client";

import React from "react";

import { FiMessageCircle, FiSend, FiUser, FiX } from "react-icons/fi";
import type { RoomMemberPresence } from "../../../utils/realtime-room";
import type { MessagingProviderSnapshot } from "../../../messaging";
import type { ShareRoomLabels } from "../share-room-labels";
import type { ImageDelivery } from "../../../database/repositories/image-delivery-repository";

export type ShareRecipient =
  | { kind: "room"; id: string; member: RoomMemberPresence }
  | { kind: "messaging"; id: string; provider: MessagingProviderSnapshot };

export function getShareRecipientLabel(
  recipient: ShareRecipient,
  labels: ShareRoomLabels,
  index = 0,
) {
  return recipient.kind === "room"
    ? recipient.member.role === "owner"
      ? labels.owner
      : `${labels.guest} ${index + 1}`
    : `${labels.messagingBot} · ${recipient.provider.displayName}`;
}

type ShareRecipientDialogProps = {
  open: boolean;
  recipients: ShareRecipient[];
  labels: ShareRoomLabels;
  imageId: string | null;
  deliveries: ImageDelivery[];
  onSelect(recipient: ShareRecipient): void;
  onClose(): void;
};

export default function ShareRecipientDialog({
  open,
  recipients,
  labels,
  imageId,
  deliveries,
  onSelect,
  onClose,
}: ShareRecipientDialogProps) {
  const [resendRecipient, setResendRecipient] = React.useState<ShareRecipient | null>(null);
  React.useEffect(() => {
    if (!open) setResendRecipient(null);
  }, [open]);
  if (!open) return null;

  const latestFor = (recipientId: string) => deliveries
    .filter((delivery) => delivery.imageId === imageId && delivery.recipientId === recipientId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return (
    <div className="fixed inset-0 z-[126] flex items-center justify-center bg-slate-950/45 p-4">
      <section
        className="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={labels.selectShareRecipient}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {labels.selectShareRecipient}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {labels.selectShareRecipientHint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label={labels.cancel}
            title={labels.cancel}
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="max-h-72 space-y-1 overflow-y-auto p-2">
          {recipients.map((recipient, index) => {
            const delivery = latestFor(recipient.id);
            const sending = delivery?.status === "sending" || delivery?.status === "pending";
            const delivered = delivery?.status === "delivered";
            return (
            <button
              key={recipient.id}
              type="button"
              onClick={() => {
                if (sending) return;
                if (delivered) {
                  setResendRecipient(recipient);
                  return;
                }
                onSelect(recipient);
              }}
              disabled={sending}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                {recipient.kind === "room" ? (
                  <FiUser className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FiMessageCircle className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                {getShareRecipientLabel(recipient, labels, index)}
              </span>
              <span className={`shrink-0 text-[10px] font-semibold ${
                delivered ? "text-emerald-600" : delivery?.status === "failed" ? "text-red-600" : "text-slate-400"
              }`}>
                {delivery?.status === "pending"
                  ? labels.deliveryPending
                  : sending
                    ? labels.deliverySending
                  : delivered
                    ? labels.deliveryDelivered
                    : delivery?.status === "failed"
                      ? labels.deliveryFailed
                      : labels.deliveryNotSent}
              </span>
              {!sending ? <FiSend className="h-4 w-4 shrink-0 text-[#2f65cf]" aria-hidden="true" /> : null}
            </button>
            );
          })}
        </div>
        {resendRecipient ? (
          <footer className="border-t border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-800">
              {labels.confirmResend(getShareRecipientLabel(resendRecipient, labels))}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setResendRecipient(null)} className="h-8 rounded-md px-3 text-xs font-semibold text-slate-600 hover:bg-white">
                {labels.cancel}
              </button>
              <button type="button" onClick={() => onSelect(resendRecipient)} className="h-8 rounded-md bg-[#2f65cf] px-3 text-xs font-semibold text-white hover:bg-[#2457bd]">
                {labels.resend}
              </button>
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
