"use client";

import type React from "react";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiDownload,
  FiLoader,
  FiMessageCircle,
  FiSend,
  FiUploadCloud,
  FiTrash2,
  FiUserX,
  FiUsers,
  FiWifi,
  FiXCircle,
} from "react-icons/fi";
import { TbDevicesShare, TbWorldShare } from "react-icons/tb";
import { RiRobot2Line } from "react-icons/ri";
import type { MessagingProviderSnapshot } from "../../messaging";
import { getShareRoomClientId } from "../../utils/share-room";
import { TEST_EMOJIS } from "../../utils/realtime-peer-messages";
import type { RoomMemberPresence, RoomRole } from "../../utils/realtime-room";
import { formatTime, middleEllipsisFileName } from "./share-room-formatters";
import type { ShareRoomLabels } from "./share-room-labels";
import type {
  ActivityItem,
  ConnectionState,
  MessageTransportMode,
} from "./share-room-types";

type RoomSidebarProps = {
  activityListRef: React.RefObject<HTMLDivElement>;
  emojiScrollerRef: React.RefObject<HTMLDivElement>;
  connection: ConnectionState;
  connectionError: string | null;
  networkLatencyMs: number | null;
  packetLossRate: number | null;
  messageTransportMode: MessageTransportMode;
  roomId: string | null;
  role: RoomRole | null;
  members: RoomMemberPresence[];
  messagingProviders: MessagingProviderSnapshot[];
  selectedMessageTargetId: string | null;
  canSendText: boolean;
  canSendReaction: boolean;
  activities: ActivityItem[];
  kickingClientId: string | null;
  textMessage: string;
  pressedEmoji: string | null;
  labels: ShareRoomLabels;
  onKick(clientId: string): void | Promise<void>;
  onSelectMessageTarget(targetId: string): void;
  onOpenMessagingChat(providerId: string): void;
  onTextChange(value: string): void;
  onTextSubmit(): void | Promise<void>;
  onEmoji(emoji: string): void;
  onClearActivities(): void;
};

export default function RoomSidebar({
  activityListRef,
  emojiScrollerRef,
  connection,
  connectionError,
  networkLatencyMs,
  packetLossRate,
  messageTransportMode,
  roomId,
  role,
  members,
  messagingProviders,
  selectedMessageTargetId,
  canSendText,
  canSendReaction,
  activities,
  kickingClientId,
  textMessage,
  pressedEmoji,
  labels,
  onKick,
  onSelectMessageTarget,
  onOpenMessagingChat,
  onTextChange,
  onTextSubmit,
  onEmoji,
  onClearActivities,
}: RoomSidebarProps) {
  const connectedBots = messagingProviders.filter(
    (provider) => provider.status === "connected",
  );

  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_minmax(0,1fr)] border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span
            className={
              messageTransportMode === "relay"
                ? "text-amber-600"
                : "text-emerald-600"
            }
            title={
              messageTransportMode === "relay"
                ? labels.relayMode
                : labels.p2pMode
            }
            role="img"
            aria-label={
              messageTransportMode === "relay"
                ? labels.relayMode
                : labels.p2pMode
            }
          >
            {messageTransportMode === "relay" ? (
              <TbWorldShare className="h-5 w-5" aria-hidden="true" />
            ) : (
              <TbDevicesShare className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
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
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                networkLatencyMs == null
                  ? "bg-slate-300"
                  : networkLatencyMs < 100
                    ? "bg-emerald-500"
                    : networkLatencyMs < 400
                      ? "bg-amber-400"
                      : "bg-red-500"
              }`}
              aria-hidden="true"
            />
            <span>
              {labels.latency} {networkLatencyMs != null ? `${networkLatencyMs} ms` : "--"}
            </span>
          </span>
          {messageTransportMode === "p2p" ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  packetLossRate == null
                    ? "bg-slate-300"
                    : packetLossRate < 1
                      ? "bg-emerald-500"
                      : packetLossRate < 5
                        ? "bg-amber-400"
                        : "bg-red-500"
                }`}
                aria-hidden="true"
              />
              <span>
                {labels.packetLoss}{" "}
                {packetLossRate != null ? `${packetLossRate.toFixed(1)}%` : "--"}
              </span>
            </span>
          ) : null}
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
              roomId !== null && member.clientId === getShareRoomClientId(roomId);
            const name =
              member.role === "owner"
                ? labels.owner
                : `${labels.guest} ${
                    members
                      .slice(0, index + 1)
                      .filter((item) => item.role === "guest").length
                  }`;
            const targetId = `room:${member.clientId}`;
            const selectable = online && !isCurrentUser;
            const selected = selectable && selectedMessageTargetId === targetId;
            return (
              <div
                key={member.clientId}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-pressed={selectable ? selected : undefined}
                onClick={selectable ? () => onSelectMessageTarget(targetId) : undefined}
                onKeyDown={selectable ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectMessageTarget(targetId);
                  }
                } : undefined}
                className={`flex items-center justify-between gap-3 rounded-md border px-2 py-1.5 transition ${
                  selected
                    ? "border-blue-300 bg-blue-50"
                    : "border-transparent"
                } ${selectable ? "cursor-pointer hover:bg-slate-50" : ""}`}
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
                      onClick={(event) => {
                        event.stopPropagation();
                        void onKick(member.clientId);
                      }}
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
                    className={`block h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                      online ? "bg-emerald-500" : "bg-slate-300"
                    }`}
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
          {connectedBots.map((provider) => (
            <div
              key={`messaging-${provider.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1.5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <RiRobot2Line className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate text-sm font-medium text-slate-700">
                  {provider.displayName}
                  <span className="ml-1 text-xs text-emerald-600">
                    ({labels.messagingBot})
                  </span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenMessagingChat(provider.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-[#07c160] transition hover:bg-emerald-50"
                  aria-label={labels.messagingOpenChat}
                  title={labels.messagingOpenChat}
                >
                  <FiMessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <span
                  className="block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
                  title={labels.online}
                  role="img"
                  aria-label={labels.online}
                />
              </div>
            </div>
          ))}
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
            void onTextSubmit();
          }}
        >
          <input
            value={textMessage}
            onChange={(event) => onTextChange(event.target.value)}
            maxLength={200}
            disabled={!canSendText}
            placeholder={labels.textPlaceholder}
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            type="submit"
            disabled={!canSendText || !textMessage.trim()}
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
              onClick={() => onEmoji(emoji)}
              disabled={!canSendReaction}
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
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-xs font-semibold uppercase text-slate-500">{labels.activity}</span>
          {activities.length ? <button type="button" onClick={onClearActivities} className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-slate-400 hover:bg-red-50 hover:text-red-600" title={labels.clearActivity}><FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />{labels.clearActivity}</button> : null}
        </div>
        <div
          ref={activityListRef}
          className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2"
        >
          {activities.length ? (
            activities.map((activity) => {
              const isTextMessage = activity.id.startsWith("message-");
              const Icon =
                activity.kind === "sending"
                  ? FiUploadCloud
                  : activity.kind === "receiving"
                    ? FiDownload
                    : activity.kind === "message"
                      ? FiMessageCircle
                      : activity.kind === "complete"
                        ? FiCheckCircle
                        : activity.kind === "cancelled"
                          ? FiXCircle
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
                  <div className="flex items-start gap-2">
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
                          className={`min-w-0 flex-1 text-xs font-semibold text-slate-800 ${
                            isTextMessage
                              ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                              : "truncate"
                          }`}
                          title={activity.title}
                        >
                          {isTextMessage
                            ? activity.title
                            : middleEllipsisFileName(activity.title, 32)}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {formatTime(activity.createdAt)}
                        </span>
                      </div>
                      {activity.detail ? (
                        <p
                          className={`text-[11px] leading-4 text-slate-500 ${
                            isTextMessage
                              ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                              : "truncate"
                          }`}
                          title={activity.detail}
                        >
                          {activity.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {typeof activity.progress === "number" && activity.progress < 1 ? (
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-200">
                      <div
                        className="h-full bg-[#2f65cf] transition-[width] duration-150"
                        style={{ width: `${Math.round(activity.progress * 100)}%` }}
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
  );
}
