import type { Metadata } from "next";
import WorkspaceRoute from "@/components/workspace-route";

export const metadata: Metadata = { title: "Image Workspace", robots: { index: false, follow: false } };
export default function Page() { return <WorkspaceRoute />; }
