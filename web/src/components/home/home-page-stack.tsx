"use client";

import React from "react";
import dynamic from "next/dynamic";
import { FiLoader } from "react-icons/fi";
import HomeCompressLanding from "./home-compress-landing";
import type { Lang } from "@/locales";
import type { ShareRoom } from "@/utils/share-room";

const ShareRoomPage = dynamic(
  () => import("@/components/share/share-room-page"),
  {
    ssr: false,
    loading: () => (
      <main className="flex h-screen items-center justify-center bg-[#eef2f7] text-[#2f65cf]">
        <FiLoader className="h-8 w-8 animate-spin" aria-hidden="true" />
      </main>
    ),
  },
);

type RoomHistoryState = {
  picbindRoomId?: string;
  picbindHomeScrollY?: number;
  picbindRoomEntry?: "base" | "guard";
};

export default function HomePageStack({ initialLang }: { initialLang: Lang }) {
  const [activeRoomId, setActiveRoomId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as RoomHistoryState | null;
      setActiveRoomId(
        typeof state?.picbindRoomId === "string" ? state.picbindRoomId : null,
      );
      if (!state?.picbindRoomId && typeof state?.picbindHomeScrollY === "number") {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: state.picbindHomeScrollY, behavior: "instant" });
        });
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openRoom = React.useCallback((room: ShareRoom) => {
    const target = new URL(room.shareUrl);
    const homeState = {
      ...window.history.state,
      picbindHomeScrollY: window.scrollY,
    };
    window.history.replaceState(homeState, "", window.location.href);
    const roomState = {
      ...homeState,
      picbindRoomId: room.roomId,
      picbindRoomEntry: "base" as const,
    };
    window.history.pushState(
      roomState,
      "",
      `${target.pathname}${target.search}${target.hash}`,
    );
    window.history.pushState(
      { ...roomState, picbindRoomEntry: "guard" },
      "",
      `${target.pathname}${target.search}${target.hash}`,
    );
    setActiveRoomId(room.roomId);
  }, []);

  return (
    <>
      <div className={activeRoomId ? "hidden" : "block"}>
        <HomeCompressLanding
          initialLang={initialLang}
          onRoomCreated={openRoom}
        />
      </div>
      {activeRoomId ? <ShareRoomPage embedded /> : null}
    </>
  );
}
