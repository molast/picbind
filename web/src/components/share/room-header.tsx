import Image from "next/image";
import {
  FiArrowLeft,
  FiCheck,
  FiCopy,
  FiLogOut,
  FiMinimize2,
} from "react-icons/fi";
import type { RoomRole } from "@/utils/realtime-room";
import type { ShareRoomLabels } from "./share-room-labels";

type RoomHeaderProps = {
  role: RoomRole | null;
  roomId: string | null;
  copied: boolean;
  actionPending: boolean;
  labels: ShareRoomLabels;
  onCopy(): void | Promise<void>;
  onTemporaryLeave(): void | Promise<void>;
  onExitRoom(): void | Promise<void>;
};

export default function RoomHeader({
  role,
  roomId,
  copied,
  actionPending,
  labels,
  onCopy,
  onTemporaryLeave,
  onExitRoom,
}: RoomHeaderProps) {
  const wordmark = (
    <Image
      src="/images/wordmark.png"
      alt="PicBind"
      width={178}
      height={38}
      className="h-9 w-auto object-contain"
      priority
    />
  );

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        {role === "owner" ? (
          <button
            type="button"
            onClick={() => void onTemporaryLeave()}
            disabled={actionPending}
            className="shrink-0 disabled:opacity-50"
            aria-label={labels.temporaryLeave}
            title={labels.temporaryLeave}
          >
            {wordmark}
          </button>
        ) : (
          <button type="button" onClick={() => void onExitRoom()} className="shrink-0">
            {wordmark}
          </button>
        )}
        <div className="hidden h-7 w-px bg-slate-200 sm:block" />
        <div className="hidden min-w-0 sm:block">
          <div className="text-xs font-medium text-slate-500">{labels.room}</div>
          <div className="truncate font-mono text-sm font-semibold text-slate-800">
            {roomId || "..."}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void onCopy()}
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
              onClick={() => void onTemporaryLeave()}
              disabled={actionPending}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
              aria-label={labels.temporaryLeave}
              title={labels.temporaryLeave}
            >
              <FiMinimize2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void onExitRoom()}
              disabled={actionPending}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              aria-label={labels.closeRoom}
              title={labels.closeRoom}
            >
              <FiLogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void onExitRoom()}
            className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            aria-label={labels.back}
            title={labels.back}
          >
            <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
