"use client";

import { FiMessageCircle, FiSend, FiUser, FiX } from "react-icons/fi";
import type { RoomMemberPresence } from "../../../utils/realtime-room";
import type { MessagingProviderSnapshot } from "../../../messaging";
import type { ShareRoomLabels } from "../share-room-labels";

export type ShareRecipient =
  | { kind: "room"; id: string; member: RoomMemberPresence }
  | { kind: "messaging"; id: string; provider: MessagingProviderSnapshot };

type ShareRecipientDialogProps = {
  open: boolean;
  recipients: ShareRecipient[];
  labels: ShareRoomLabels;
  onSelect(recipient: ShareRecipient): void;
  onClose(): void;
};

export default function ShareRecipientDialog({
  open,
  recipients,
  labels,
  onSelect,
  onClose,
}: ShareRecipientDialogProps) {
  if (!open) return null;

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
          {recipients.map((recipient, index) => (
            <button
              key={recipient.id}
              type="button"
              onClick={() => onSelect(recipient)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-blue-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                {recipient.kind === "room" ? (
                  <FiUser className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FiMessageCircle className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                {recipient.kind === "room"
                  ? recipient.member.role === "owner"
                    ? labels.owner
                    : `${labels.guest} ${index + 1}`
                  : `${labels.messagingBot} · ${recipient.provider.displayName}`}
              </span>
              <FiSend className="h-4 w-4 shrink-0 text-[#2f65cf]" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
