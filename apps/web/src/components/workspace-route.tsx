"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isTauri } from "@tauri-apps/api/core";
import {
  defaultWorkspaceStyle,
  WorkspacePage,
  type WorkspaceIdentity,
} from "@picbind/ui/source";
import { useAuth } from "./auth/auth-provider";
import { RealtimeProviderRoot } from "@/realtime/realtime-provider-root";
import HomePageStack from "@/components/home/home-page-stack";
import {
  resolveGuestShareToken,
  selectOwnerWorkspace,
  workspaceEntryKey,
} from "./workspace-route-mode";

const PUBLIC_WORKSPACE_SITE_URL = process.env.NODE_ENV === "production"
  ? process.env.NEXT_PUBLIC_SITE_URL || "https://picbind.com"
  : undefined;

export default function WorkspaceRoute() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [desktop, setDesktop] = React.useState(false);

  const shareToken = searchParams.get("share");
  const workspaceMode = searchParams.get("mode");

  React.useEffect(() => {
    setDesktop(isTauri());
  }, []);
  const initialWorkspace = React.useMemo<WorkspaceIdentity | undefined>(() => {
    const workspace = selectOwnerWorkspace(auth.state.workspaces, shareToken);
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
  }, [auth.state.authenticated, auth.state.workspaces, shareToken]);
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
      key={workspaceEntryKey(
        shareToken,
        initialWorkspace?.shareToken,
        workspaceMode,
        initialWorkspace?.workspaceId,
      )}
      shareToken={guestShareToken}
      initialWorkspace={initialWorkspace}
      userDisplayName={auth.state.user?.name || auth.state.user?.email}
      publicSiteUrl={PUBLIC_WORKSPACE_SITE_URL}
      desktop={desktop}
      suspendedContent={<HomePageStack initialLang="en" />}
      onSuspend={() => router.push("/")}
      onExit={() => router.back()}
    />
  </RealtimeProviderRoot>;
}
