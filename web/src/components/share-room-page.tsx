"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { FiArrowLeft, FiCheck, FiCopy, FiLink, FiLoader } from "react-icons/fi";
import { getLang, type Lang } from "@/locales";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;

function readRoomId() {
  const roomIdFromQuery = new URLSearchParams(window.location.search).get(
    "roomId",
  );
  if (roomIdFromQuery !== null) {
    return roomIdFromQuery;
  }

  // Preserve compatibility with links generated before query-based share URLs.
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments[0] === "share" ? segments[1] || "" : "";
}

export default function ShareRoomPage() {
  const [lang, setLang] = React.useState<Lang>("en");
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    setLang(getLang());
    setRoomId(readRoomId());
  }, []);

  const labels =
    lang === "zh"
      ? {
          back: "返回首页",
          title: "图片分享房间",
          roomId: "房间 ID",
          waiting: "等待建立连接",
          expires: "房间将在创建 30 分钟后过期",
          copy: "复制链接",
          copied: "已复制",
          invalid: "分享链接无效",
        }
      : {
          back: "Back to home",
          title: "Image share room",
          roomId: "Room ID",
          waiting: "Waiting for connection",
          expires: "This room expires 30 minutes after creation",
          copy: "Copy link",
          copied: "Copied",
          invalid: "Invalid share link",
        };

  const validRoomId = Boolean(roomId && ROOM_ID_PATTERN.test(roomId));

  const handleCopy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#dce8f8] text-slate-800">
      <div className="absolute inset-0 bg-[url('/images/hero-background.avif')] bg-cover bg-center bg-no-repeat opacity-80" />
      <div className="absolute inset-0 bg-white/25" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex h-14 items-center justify-between">
          <Link href="/" className="inline-flex items-center">
            <Image
              src="/images/wordmark.png"
              alt="PicBind"
              width={178}
              height={38}
              className="h-10 w-auto object-contain"
              priority
            />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#415c8a] transition hover:text-[#2457bd]"
          >
            <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{labels.back}</span>
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <section className="w-full max-w-[520px] rounded-lg border border-white/70 bg-white/90 p-6 shadow-[0_24px_64px_rgba(48,76,126,0.18)] backdrop-blur-md sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#2f65cf] text-white">
              <FiLink className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold text-slate-900">
              {labels.title}
            </h1>

            {roomId === null ? (
              <div className="mt-8 flex h-24 items-center justify-center text-[#2f65cf]">
                <FiLoader className="h-6 w-6 animate-spin" aria-label="Loading" />
              </div>
            ) : validRoomId ? (
              <div className="mt-7">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {labels.roomId}
                </div>
                <div className="mt-2 break-all font-mono text-2xl font-semibold text-slate-900">
                  {roomId}
                </div>

                <div className="mt-7 flex items-center gap-3 border-y border-slate-200 py-4">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-sm font-medium text-slate-700">
                    {labels.waiting}
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">{labels.expires}</p>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[#2f65cf] px-4 text-sm font-semibold text-white transition hover:bg-[#2457bd]"
                  >
                    {copied ? (
                      <FiCheck className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <FiCopy className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{copied ? labels.copied : labels.copy}</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-7 rounded-md bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {labels.invalid}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
