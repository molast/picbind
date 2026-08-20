"use client";

import React from "react";
import { WorkspacePage } from "@picbind/ui/source";

export default function WorkspaceRoute() {
  const [shareToken, setShareToken] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    setShareToken(new URLSearchParams(window.location.search).get("share"));
  }, []);
  if (shareToken === undefined) return <main className="min-h-screen bg-slate-50"/>;
  return <WorkspacePage shareToken={shareToken || undefined}/>;
}
