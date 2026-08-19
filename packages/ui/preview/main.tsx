import React from "react";
import { createRoot } from "react-dom/client";
import {
  configureRoomSdk,
  CreateRoomButton,
  ShareRoomPage,
  type ShareRoom,
} from "../src";
import "../src/styles.css";

const apiBaseUrl =
  import.meta.env.VITE_ROOM_API_URL || "https://api.picbind.com";
configureRoomSdk({
  apiBaseUrl,
  roomUrl: import.meta.env.VITE_ROOM_APP_URL || window.location.origin,
});

function PreviewApp() {
  const roomId = new URLSearchParams(window.location.search).get("roomId");
  if (roomId) {
    return <ShareRoomPage />;
  }

  const openRoom = (room: ShareRoom) => {
    const url = new URL(window.location.href);
    url.searchParams.set("roomId", room.roomId);
    window.location.assign(url);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef2f7]">
      <div className="flex flex-col items-center gap-5 rounded-lg border border-slate-200 bg-white px-10 py-9 shadow-lg">
        <img
          src="/images/wordmark.png"
          alt="PicBind"
          width="178"
          height="38"
          className="h-10 w-auto object-contain"
        />
        <CreateRoomButton lang="en" onRoomCreated={openRoom} />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreviewApp />
  </React.StrictMode>,
);
