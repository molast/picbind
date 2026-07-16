import type { Metadata } from "next";
import ShareRoomPage from "@/components/share/share-room-page";

export const metadata: Metadata = {
  title: "Share room",
  robots: {
    index: false,
    follow: false,
  },
};

export default function Page() {
  return <ShareRoomPage />;
}
