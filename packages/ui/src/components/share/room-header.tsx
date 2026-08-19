import {
  FiCheck,
  FiCopy,
  FiLogOut,
  FiMessageCircle,
  FiMinimize2,
} from "react-icons/fi";
import type { RoomRole } from "../../utils/realtime-room";
import type { ShareRoomLabels } from "./share-room-labels";
import { ROOM_VERSION } from "../../version";

type RoomHeaderProps = {
  role: RoomRole | null;
  roomId: string | null;
  copied: boolean;
  actionPending: boolean;
  messagingAvailable: boolean;
  messagingConnected: boolean;
  labels: ShareRoomLabels;
  onCopy(): void | Promise<void>;
  onOpenMessaging(): void;
  onTemporaryLeave(): void | Promise<void>;
  onExitRoom(): void | Promise<void>;
};

export default function RoomHeader({
  role,
  roomId,
  copied,
  actionPending,
  messagingAvailable,
  messagingConnected,
  labels,
  onCopy,
  onOpenMessaging,
  onTemporaryLeave,
  onExitRoom,
}: RoomHeaderProps) {
  const wordmark = (
    <img
      src="/images/wordmark.png"
      alt="PicBind"
      width={178}
      height={38}
      className="h-9 w-auto object-contain"
    />
  );

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={() => void onTemporaryLeave()}
          disabled={actionPending || !role}
          className="shrink-0 disabled:opacity-50"
          aria-label={labels.temporaryLeave}
          title={labels.temporaryLeave}
        >
          {wordmark}
        </button>
        <span
          className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500"
          aria-label={`Room SDK version ${ROOM_VERSION}`}
          title={`Room SDK v${ROOM_VERSION}`}
        >
          v{ROOM_VERSION}
        </span>
        <div className="hidden h-7 w-px bg-slate-200 sm:block" />
        <div className="hidden min-w-0 sm:block">
          <div className="text-xs font-medium text-slate-500">{labels.room}</div>
          <div className="truncate font-mono text-sm font-semibold text-slate-800">
            {roomId || "..."}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {messagingAvailable ? (
          <button
            type="button"
            onClick={onOpenMessaging}
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-blue-50 hover:text-[#2f65cf]"
            aria-label={labels.messagingService}
            title={labels.messagingService}
          >
            <FiMessageCircle className="h-4 w-4" aria-hidden="true" />
            {messagingConnected ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-white bg-emerald-500" aria-hidden="true" />
            ) : null}
          </button>
        ) : null}
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
        <button
          type="button"
          onClick={() => void onTemporaryLeave()}
          disabled={actionPending || !role}
          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
          aria-label={labels.temporaryLeave}
          title={labels.temporaryLeave}
        >
          <FiMinimize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void onExitRoom()}
          disabled={actionPending || !role}
          className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          aria-label={role === "owner" ? labels.closeRoom : labels.leaveRoom}
          title={role === "owner" ? labels.closeRoom : labels.leaveRoom}
        >
          <FiLogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
