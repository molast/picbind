"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { isTauri } from "@tauri-apps/api/core";
import { defaultWorkspaceStyle, WorkspacePage, type WorkspaceIdentity } from "@picbind/ui/source";
import { useAuth } from "./auth/auth-provider";
import { RealtimeProviderRoot } from "@/realtime/realtime-provider-root";
import { resolveGuestShareToken } from "./workspace-route-mode";

const PUBLIC_WORKSPACE_SITE_URL = process.env.NODE_ENV === "production"
  ? process.env.NEXT_PUBLIC_SITE_URL || "https://picbind.com"
  : undefined;

export default function WorkspaceRoute() {
  const auth = useAuth();
  const searchParams = useSearchParams();
  const [desktop, setDesktop] = React.useState(false);

  React.useEffect(() => {
    setDesktop(isTauri());
  }, []);
  const shareToken = searchParams.get("share");
  const workspaceMode = searchParams.get("mode");
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
  const guestShareToken = resolveGuestShareToken(
    shareToken,
    initialWorkspace?.shareToken,
    workspaceMode,
  );
  if (auth.checking) {
    return <main className="min-h-screen bg-slate-50"/>;
  }
  return <RealtimeProviderRoot>
    <WorkspacePage
      shareToken={guestShareToken}
      initialWorkspace={initialWorkspace}
      userDisplayName={auth.state.user?.name || auth.state.user?.email}
      publicSiteUrl={PUBLIC_WORKSPACE_SITE_URL}
      desktop={desktop}
    />
  </RealtimeProviderRoot>;
}
