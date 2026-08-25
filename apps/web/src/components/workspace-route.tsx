"use client";

import React from "react";
import { defaultWorkspaceStyle, WorkspacePage, type WorkspaceIdentity } from "@picbind/ui/source";
import { useAuth } from "./auth/auth-provider";

export default function WorkspaceRoute() {
  const auth = useAuth();
  const [shareToken, setShareToken] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShareToken(params.get("share"));
  }, []);
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
  if (shareToken === undefined || (auth.checking && !shareToken && !initialWorkspace)) {
    return <main className="min-h-screen bg-slate-50"/>;
  }
  return <WorkspacePage
    shareToken={guestShareToken}
    initialWorkspace={initialWorkspace}
  />;
}
