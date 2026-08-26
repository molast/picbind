import type { Metadata } from "next";
import { Suspense } from "react";
import WorkspaceRoute from "@/components/workspace-route";

export const metadata: Metadata = { title: "Image Workspace", robots: { index: false, follow: false } };
export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50" />}>
      <WorkspaceRoute />
    </Suspense>
  );
}
