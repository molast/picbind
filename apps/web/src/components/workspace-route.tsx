"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { defaultWorkspaceStyle, WorkspacePage, type WorkspaceIdentity } from "@picbind/ui/source";
import { useAuth } from "./auth/auth-provider";

const PUBLIC_WORKSPACE_SITE_URL = process.env.NODE_ENV === "production"
  ? process.env.NEXT_PUBLIC_SITE_URL || "https://picbind.com"
  : undefined;

export default function WorkspaceRoute() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("share");
  const initialWorkspace = React.useMemo<WorkspaceIdentity | undefined>(() => {
    const workspace = auth.state.workspaces[0];
    if (!auth.state.authenticated || !workspace) return undefined;
    return {
      workspaceId: workspace.id,
      name: workspace.name,
      role: "owner",
      shareToken: workspace.shareId,
      ownerCapability: workspace.ownerCapability,
      createdAt: Date.parse(workspace.createdAt),
      updatedAt: Date.parse(workspace.updatedAt),
      style: defaultWorkspaceStyle(),
    };
  }, [auth.state.authenticated, auth.state.workspaces]);
  const guestShareToken = shareToken === initialWorkspace?.shareToken
    ? undefined
    : shareToken || undefined;
  if (auth.checking && !shareToken && !initialWorkspace) {
    return <main className="min-h-screen bg-slate-50"/>;
  }
  return <WorkspacePage
    shareToken={guestShareToken}
    initialWorkspace={initialWorkspace}
    publicSiteUrl={PUBLIC_WORKSPACE_SITE_URL}
  />;
}
