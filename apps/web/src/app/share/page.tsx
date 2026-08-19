import type { Metadata } from "next";
import RoomPageClient from "@/components/room-page-client";

export const metadata: Metadata = {
  title: "Share room",
  robots: {
    index: false,
    follow: false,
  },
};

export default function Page() {
  return <RoomPageClient />;
}
