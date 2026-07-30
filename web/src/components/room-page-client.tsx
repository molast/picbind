"use client";

import dynamic from "next/dynamic";

const RoomPage = dynamic(
  () => import("@/utils/room-sdk").then((module) => module.ShareRoomPage),
  { ssr: false },
);

export default function RoomPageClient() {
  return <RoomPage />;
}
