"use client";

import React from "react";
import { WorkspacePage } from "@picbind/ui/source";

export default function WorkspaceRoute() {
  const [shareToken, setShareToken] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    setShareToken(segments[0] === "workspace" && segments[1] ? decodeURIComponent(segments[1]) : null);
  }, []);
  if (shareToken === undefined) return <main className="min-h-screen bg-slate-50"/>;
  return <WorkspacePage shareToken={shareToken || undefined}/>;
}
