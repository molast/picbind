"use client";

import dynamic from "next/dynamic";
import RoomPageLoading from "./room-page-loading";

const RoomPage = dynamic(
  () => import("@/utils/room-sdk").then((module) => module.ShareRoomPage),
  {
    ssr: false,
    loading: RoomPageLoading,
  },
);

export default function RoomPageClient() {
  return <RoomPage />;
}
